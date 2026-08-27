import * as THREE from 'three';
import { Track, testTrack, mapJsonToTrackData } from './track.js';
import { CarPhysics, createCarMesh, getCarColor } from './car.js';
import { createMinimap, initMinimapTrack, updateMinimap, destroyMinimap } from './minimap.js';
import { ParticleSystem } from './particles.js';
import {
  initAudio, resumeAudio, destroyAudio,
  startEngine, updateEngine, stopEngine,
  startDrift, updateDrift, stopDrift,
  startMusic, stopMusic,
  playCountdownBeep, playLapChime, playWallHit, playFinish,
  setMuted, isMuted, setMusicMuted, isMusicMuted,
  setMusicVolume, setSfxVolume,
} from './audio.js';

// ---- CRT + bloom post-processing shader ----
const CRT_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;
const CRT_FS = `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform float time;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    // Barrel distortion
    vec2 c = uv - .5;
    float d = dot(c, c);
    uv += c * d * .08;
    vec4 col = texture2D(tDiffuse, uv);

    // Bloom: sample surrounding pixels and add glow
    vec2 px = vec2(1.0/384.0, 1.0/216.0);
    vec4 bloom = vec4(0.0);
    for (float i = -2.0; i <= 2.0; i += 1.0) {
      for (float j = -2.0; j <= 2.0; j += 1.0) {
        vec4 s = texture2D(tDiffuse, uv + vec2(i, j) * px * 2.0);
        float lum = dot(s.rgb, vec3(0.2126, 0.7152, 0.0722));
        if (lum > 0.5) bloom += s * 0.04;
      }
    }
    col.rgb += bloom.rgb;

    // Chromatic aberration
    col.r = texture2D(tDiffuse, uv + vec2(.0012, 0.0)).r * .3 + col.r * .7;
    col.b = texture2D(tDiffuse, uv - vec2(.0012, 0.0)).b * .3 + col.b * .7;

    // Scanlines
    float sl = sin(uv.y * 240.0 * 3.14159) * .05 + .95;
    col.rgb *= sl;

    // Vignette
    float v = 1.0 - d * 1.2;
    col.rgb *= v;

    // Slight flicker
    col.rgb *= 0.98 + 0.02 * sin(time * 8.0);

    gl_FragColor = col;
  }
`;

// ---- Main game state ----
let renderer, scene, camera;
let rtTarget;
let crtQuad, crtMaterial, crtScene, crtCam;
let track, playerPhysics, playerMesh;
let clock;
const remoteCars = new Map();
const RES_W = 384, RES_H = 216;
let hudEl;
let crtEnabled = true;
let animFrameId = null;
let _canvas = null;
let _lapCallback = null;
let _finishCallback = null;
let _prevLapCount = 0;
let _initialized = false;
let _playerColor = [0, 1, 1];
let _localPlayerId = null;
let _playerInfoMap = {};   // {id: {name, color}}
let _leaderboardEl = null;
let _particles = null;
let _prevWallHit = false;

export function initGame(canvas, hud, trackData, spawnIndex, playerColor) {
  destroyGame();
  hudEl = hud;
  _canvas = canvas;
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.autoClear = false;

  rtTarget = new THREE.WebGLRenderTarget(RES_W, RES_H, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter
  });

  crtMaterial = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rtTarget.texture }, time: { value: 0 } },
    vertexShader: CRT_VS, fragmentShader: CRT_FS, depthTest: false, depthWrite: false
  });
  crtQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), crtMaterial);
  crtScene = new THREE.Scene();
  crtScene.add(crtQuad);
  crtCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  scene = new THREE.Scene();
  scene.background = null;

  camera = new THREE.PerspectiveCamera(60, RES_W / RES_H, 0.5, 500);

  // Track — use provided trackData or fallback to testTrack
  const td = trackData || testTrack;
  track = new Track(td);
  scene.add(track.createMeshes());
  scene.add(createNeonEdgeGlow(track));
  scene.add(createGrid());
  scene.add(createSky());

  // Player car
  playerPhysics = new CarPhysics();
  const si = spawnIndex || 0;
  let start;
  if (td.spawnPositions && td.spawnPositions[si]) {
    const sp = td.spawnPositions[si];
    const dir = sp.direction || { x: 0, z: -1 };
    start = { x: sp.x, z: sp.z, angle: Math.atan2(dir.x, dir.z) };
  } else {
    start = track.getStartPosition();
  }
  playerPhysics.x = start.x;
  playerPhysics.z = start.z;
  playerPhysics.angle = start.angle;
  _prevLapCount = 0;

  const pColor = playerColor || getCarColor(si);
  playerMesh = createCarMesh(pColor);
  playerMesh.position.set(start.x, 0, start.z);
  playerMesh.rotation.y = start.angle + Math.PI;
  scene.add(playerMesh);
  _playerColor = pColor;

  // Particles
  _particles = new ParticleSystem(scene);

  // Minimap
  createMinimap();
  initMinimapTrack(track);

  camera.position.set(
    start.x - Math.sin(start.angle) * 8, 3.5,
    start.z - Math.cos(start.angle) * 8
  );
  camera.lookAt(start.x, 0.5, start.z);

  // Audio
  initAudio();
  resumeAudio();
  startEngine();
  startDrift();
  startMusic();

  setupInput();
  window.addEventListener('resize', onResize);
  onResize();

  _initialized = true;
  _prevWallHit = false;
  function loop() {
    animFrameId = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), .1);
    update(dt);
    render();
  }
  animFrameId = requestAnimationFrame(loop);
}

export function destroyGame() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  remoteCars.clear();
  destroyMinimap();
  if (_particles) { _particles.destroy(); _particles = null; }
  stopEngine();
  stopDrift();
  stopMusic();
  if (renderer) {
    renderer.dispose();
    if (rtTarget) rtTarget.dispose();
  }
  window.removeEventListener('resize', onResize);
  window.removeEventListener('keydown', _keyDown);
  window.removeEventListener('keyup', _keyUp);
  scene = null; renderer = null; camera = null; track = null;
  playerPhysics = null; playerMesh = null;
  _initialized = false;
  _leaderboardEl = null;
  _localPlayerId = null;
  _playerInfoMap = {};
}

export function setLapCallback(fn) { _lapCallback = fn; }
export function setFinishCallback(fn) { _finishCallback = fn; }

function onResize() {
  if (!renderer) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// ---- Input ----
const keys = {};
let _keyDown, _keyUp;
function setupInput() {
  _keyDown = (e) => {
    keys[e.code] = true;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  };
  _keyUp = (e) => { keys[e.code] = false; };
  window.addEventListener('keydown', _keyDown);
  window.addEventListener('keyup', _keyUp);
}

function getInput() {
  return {
    up: !!(keys.ArrowUp || keys.KeyW),
    down: !!(keys.ArrowDown || keys.KeyS),
    left: !!(keys.ArrowLeft || keys.KeyA),
    right: !!(keys.ArrowRight || keys.KeyD),
    space: !!keys.Space
  };
}

// ---- Update ----
function update(dt) {
  if (playerPhysics.finished) {
    updateRemoteMeshes();
    if (_particles) _particles.update(dt);
    return;
  }

  playerPhysics.update(dt, getInput(), track);

  const st = playerPhysics.getState();
  playerMesh.position.set(st.x, 0, st.z);
  playerMesh.rotation.y = st.angle + Math.PI;
  playerMesh.rotation.z = playerPhysics.steer * st.drift * .15;

  // Chase camera
  const behindX = st.x - Math.sin(st.angle) * 8;
  const behindZ = st.z - Math.cos(st.angle) * 8;
  const targetX = st.x + Math.sin(st.angle) * 12;
  const targetZ = st.z + Math.cos(st.angle) * 12;
  camera.position.lerp(new THREE.Vector3(behindX, 3.5, behindZ), .08);
  camera.lookAt(targetX, 0.5, targetZ);

  // Audio updates
  updateEngine(st.speed, playerPhysics.maxSpeed);
  updateDrift(st.drift);

  // Particles: drift sparks + exhaust
  if (_particles) {
    if (st.drift > 0.3) {
      _particles.emitDriftSparks(st.x, st.z, st.angle, st.speed, st.drift);
    }
    _particles.emitExhaust(st.x, st.z, st.angle, st.speed);
  }

  // Wall hit detection for SFX and particles
  if (track) {
    const w = track.wallHit(st.x, st.z, 0.9);
    if (w.hit && !_prevWallHit) {
      playWallHit();
      if (_particles) _particles.emitWallSparks(st.x, st.z, w.nx, w.nz);
    }
    _prevWallHit = w.hit;
  }

  // Detect lap completion
  if (playerPhysics.lapCount > _prevLapCount) {
    _prevLapCount = playerPhysics.lapCount;
    playLapChime();
    if (_lapCallback) _lapCallback(playerPhysics.lapCount);
  }
  if (playerPhysics.finished && _finishCallback) {
    playFinish();
    _finishCallback(playerPhysics.totalTime);
    _finishCallback = null; // fire once
  }

  updateRemoteMeshes();
  updateHUD(st);

  // Update particles
  if (_particles) _particles.update(dt);

  // Update minimap with all car positions
  const others = [];
  for (const [id, rc] of remoteCars) {
    if (!rc.fading) {
      others.push({ x: rc.targetX, z: rc.targetZ, color: rc.color || [0.6, 0.6, 0.6] });
    }
  }
  updateMinimap({ x: st.x, z: st.z }, _playerColor, others);
}

function clampToTrack(x, z) {
  if (!track) return { x, z };
  const p = track.project(x, z);
  const edge = track.halfW - 0.9;   // same car half-width as wallHit
  if (Math.abs(p.lateral) <= edge) return { x, z };
  // Push back inside the wall, same logic as wallHit
  const sign = p.lateral > 0 ? 1 : -1;
  const pen = Math.abs(p.lateral) - edge;
  return { x: x - sign * p.nx * pen, z: z - sign * p.nz * pen };
}

function updateRemoteMeshes() {
  for (const [id, rc] of remoteCars) {
    if (rc.mesh) {
      // Clamp network target to track bounds before interpolating
      const clamped = clampToTrack(rc.targetX, rc.targetZ);

      rc.mesh.position.x += (clamped.x - rc.mesh.position.x) * .15;
      rc.mesh.position.z += (clamped.z - rc.mesh.position.z) * .15;

      // Also clamp the interpolated position so diagonal lerps can't cut walls
      const lerpClamped = clampToTrack(rc.mesh.position.x, rc.mesh.position.z);
      rc.mesh.position.x = lerpClamped.x;
      rc.mesh.position.z = lerpClamped.z;

      let da = rc.targetAngle - rc.mesh.rotation.y;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      rc.mesh.rotation.y += da * .15;
      if (rc.fading) {
        rc.fadeAlpha -= .02;
        if (rc.fadeAlpha <= 0) {
          scene.remove(rc.mesh);
          remoteCars.delete(id);
        }
      }
    }
  }
}

function updateHUD(st) {
  if (!hudEl) return;
  if (!track) return;
  const spd = (st.speed * 6) | 0;
  const lap = Math.min(playerPhysics.lapCount + 1, track.data.laps);
  const ltStr = formatTime(playerPhysics.lapTime);
  const blStr = playerPhysics.bestLap < Infinity ? formatTime(playerPhysics.bestLap) : '--:--.---';

  hudEl.innerHTML =
    `<div>LAP ${lap}/${track.data.laps}</div>` +
    `<div>SPD ${spd} KM/H</div>` +
    `<div>TIME ${ltStr}</div>` +
    `<div>BEST ${blStr}</div>` +
    (playerPhysics.finished ? `<div class="finish">FINISH! ${formatTime(playerPhysics.totalTime)}</div>` : '') +
    (st.drift > .3 ? '<div class="drift">DRIFT!</div>' : '');

  updateLeaderboard();
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s * 1000) % 1000);
  return `${m}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

// ---- Render ----
function render() {
  if (!renderer) return;
  crtMaterial.uniforms.time.value = clock.elapsedTime;

  renderer.setRenderTarget(rtTarget);
  renderer.clear();
  renderer.render(scene, camera);

  renderer.setRenderTarget(null);
  renderer.clear();
  if (crtEnabled) {
    renderer.render(crtScene, crtCam);
  } else {
    renderer.render(scene, camera);
  }
}

// ---- Ground grid (synthwave) ----
function createGrid() {
  const size = 500, div = 80;
  const pos = [], col = [];
  const half = size / 2, step = size / div;
  const gc = [.08, .02, .15];
  const lc = [.4, .0, .6];

  pos.push(-half, -.01, -half, half, -.01, -half, half, -.01, half);
  pos.push(-half, -.01, -half, half, -.01, half, -half, -.01, half);
  for (let i = 0; i < 6; i++) col.push(gc[0], gc[1], gc[2]);

  const lw = .15;
  for (let i = 0; i <= div; i++) {
    const p = -half + i * step;
    pos.push(p - lw, .001, -half, p + lw, .001, -half, p + lw, .001, half);
    pos.push(p - lw, .001, -half, p + lw, .001, half, p - lw, .001, half);
    pos.push(-half, .001, p - lw, half, .001, p - lw, half, .001, p + lw);
    pos.push(-half, .001, p - lw, half, .001, p + lw, -half, .001, p + lw);
    const f = Math.max(.3, 1 - Math.abs(i / div - .5) * 1.5);
    for (let k = 0; k < 12; k++) col.push(lc[0] * f, lc[1] * f, lc[2] * f);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

// ---- Synthwave sky with stars ----
function createSky() {
  const g = new THREE.SphereGeometry(400, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const colors = [];
  const pa = g.getAttribute('position');
  for (let i = 0; i < pa.count; i++) {
    const y = pa.getY(i) / 400;
    colors.push(.15 + (1 - y) * .7, (1 - y) * .15, .3 + y * .4);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));

  // Sun with gradient rings
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide })
  );
  sun.position.set(0, 40, -350); sun.lookAt(0, 40, 0);

  // Sun glow ring
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(30, 50, 32),
    new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  );
  glow.position.set(0, 40, -349); glow.lookAt(0, 40, 0);

  // Stars scattered across the upper sky
  const starPos = [], starCol = [];
  for (let i = 0; i < 300; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.35 + Math.PI * 0.1; // upper portion
    const r = 395;
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);
    const sz = 0.3 + Math.random() * 0.7;
    // Small quad for each star
    const dx = sz * 0.5, dy = sz * 0.5;
    starPos.push(x - dx, y - dy, z, x + dx, y - dy, z, x + dx, y + dy, z);
    starPos.push(x - dx, y - dy, z, x + dx, y + dy, z, x - dx, y + dy, z);
    const bright = 0.5 + Math.random() * 0.5;
    const tint = Math.random();
    for (let k = 0; k < 6; k++) {
      starCol.push(
        bright * (0.8 + tint * 0.2),
        bright * (0.8 + (1 - tint) * 0.1),
        bright
      );
    }
  }
  const sg2 = new THREE.BufferGeometry();
  sg2.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  sg2.setAttribute('color', new THREE.Float32BufferAttribute(starCol, 3));
  const stars = new THREE.Mesh(sg2, new THREE.MeshBasicMaterial({ vertexColors: true }));

  const sg = new THREE.Group();
  sg.add(m); sg.add(sun); sg.add(glow); sg.add(stars);
  return sg;
}

// ---- Neon edge glow strips along track walls ----
function createNeonEdgeGlow(track) {
  const grp = new THREE.Group();
  const h = 0.15; // thin glow strip height
  const yOff = track.data.wallHeight + 0.02; // sit just above wall top

  for (const [edges, color] of [[track.edgeL, [0, 1, 1]], [track.edgeR, [1, 0, 1]]]) {
    const pos = [], col = [];
    for (let i = 0; i < track.samples; i++) {
      const j = i + 1;
      const e0 = edges[i], e1 = edges[j];
      // Pulsing color based on position
      const pulse = 0.6 + 0.4 * Math.sin(i * 0.1);
      const c = [color[0] * pulse, color[1] * pulse, color[2] * pulse];
      pos.push(e0.x, yOff, e0.z, e1.x, yOff, e1.z, e1.x, yOff + h, e1.z);
      pos.push(e0.x, yOff, e0.z, e1.x, yOff + h, e1.z, e0.x, yOff + h, e0.z);
      for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));
  }
  return grp;
}

// ---- Multiplayer API ----
export function getPlayerState() {
  if (!playerPhysics) return { x: 0, z: 0, angle: 0, speed: 0, lap: 0, finished: false, trackT: 0 };
  const s = playerPhysics.getState();
  return {
    x: s.x, z: s.z, angle: s.angle, speed: s.speed,
    lap: playerPhysics.lapCount, finished: playerPhysics.finished,
    trackT: playerPhysics._prevT || 0
  };
}

export function spawnRemoteCar(id, colorArr) {
  if (!scene) return;
  if (remoteCars.has(id)) return;
  const c = colorArr || getCarColor(remoteCars.size + 1);
  const mesh = createCarMesh(c);
  scene.add(mesh);
  remoteCars.set(id, {
    mesh, targetX: 0, targetZ: 0, targetAngle: 0,
    fadeAlpha: 1, fading: false, lapCount: 0, trackT: 0,
    color: c
  });
}

export function updateRemoteCar(id, state) {
  const rc = remoteCars.get(id);
  if (!rc) return;
  rc.targetX = state.x;
  rc.targetZ = state.z;
  rc.targetAngle = (state.ry !== undefined ? state.ry : (state.angle || 0)) + Math.PI;
  if (state.lap !== undefined) rc.lapCount = state.lap;
  if (state.trackT !== undefined) rc.trackT = state.trackT;
}

export function removeRemoteCar(id) {
  const rc = remoteCars.get(id);
  if (!rc) return;
  rc.fading = true;
}

export function toggleCRT() { crtEnabled = !crtEnabled; return crtEnabled; }

// ---- Audio public re-exports for UI ----
export { setMuted, isMuted, setMusicMuted, isMusicMuted, setMusicVolume, setSfxVolume };
export { initAudio, resumeAudio, destroyAudio };
export { playCountdownBeep };

// ---- Live Leaderboard ----
export function setLeaderboardEl(el) { _leaderboardEl = el; }
export function setLocalPlayerId(id) { _localPlayerId = id; }
export function setPlayerInfoMap(map) { _playerInfoMap = map; }

function updateLeaderboard() {
  if (!_leaderboardEl || !track) return;

  // Build entries: local player + all non-fading remotes
  const entries = [];

  // Local player
  const localLap = playerPhysics ? playerPhysics.lapCount : 0;
  const localT = playerPhysics ? (playerPhysics._prevT || 0) : 0;
  const localFinished = playerPhysics ? playerPhysics.finished : false;
  const localInfo = _playerInfoMap[_localPlayerId] || {};
  entries.push({
    id: _localPlayerId || '__local',
    name: localInfo.name || 'YOU',
    color: localInfo.color,
    lap: localLap,
    trackT: localT,
    finished: localFinished,
    isLocal: true
  });

  // Remote players
  for (const [id, rc] of remoteCars) {
    if (rc.fading) continue;
    const info = _playerInfoMap[id] || {};
    entries.push({
      id,
      name: info.name || 'PLAYER',
      color: info.color,
      lap: rc.lapCount || 0,
      trackT: rc.trackT || 0,
      finished: rc.finished || false,
      isLocal: false
    });
  }

  // Sort: finished first (by finish order — higher lap + trackT is better),
  // then by lap desc, then trackT desc
  entries.sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.lap !== b.lap) return b.lap - a.lap;
    return b.trackT - a.trackT;
  });

  // Render
  let html = '';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const c = e.color
      ? `rgb(${(e.color[0]*255)|0},${(e.color[1]*255)|0},${(e.color[2]*255)|0})`
      : '#0ff';
    const cls = e.isLocal ? ' lb-local' : '';
    html += `<div class="lb-row${cls}">` +
      `<span class="lb-pos">${i + 1}</span>` +
      `<span class="lb-dot" style="background:${c}"></span>` +
      `<span class="lb-name">${e.name}</span>` +
      `</div>`;
  }
  _leaderboardEl.innerHTML = html;
}

export { track, playerPhysics, mapJsonToTrackData };
