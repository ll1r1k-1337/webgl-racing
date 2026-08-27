import * as THREE from 'three';
import { Track, testTrack, mapJsonToTrackData } from './track.js';
import { CarPhysics, createCarMesh, getCarColor } from './car.js';

// ---- CRT post-processing shader ----
const CRT_VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;
const CRT_FS = `
  precision mediump float;
  uniform sampler2D tDiffuse;
  uniform float time;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv;
    vec2 c = uv - .5;
    float d = dot(c, c);
    uv += c * d * .08;
    vec4 col = texture2D(tDiffuse, uv);
    float sl = sin(uv.y * 240.0 * 3.14159) * .06 + .94;
    col.rgb *= sl;
    col.r = texture2D(tDiffuse, uv + vec2(.001, 0.0)).r * .3 + col.r * .7;
    col.b = texture2D(tDiffuse, uv - vec2(.001, 0.0)).b * .3 + col.b * .7;
    float v = 1.0 - d * 1.2;
    col.rgb *= v;
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

  camera.position.set(
    start.x - Math.sin(start.angle) * 8, 3.5,
    start.z - Math.cos(start.angle) * 8
  );
  camera.lookAt(start.x, 0.5, start.z);

  setupInput();
  window.addEventListener('resize', onResize);
  onResize();

  _initialized = true;
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

  // Detect lap completion
  if (playerPhysics.lapCount > _prevLapCount) {
    _prevLapCount = playerPhysics.lapCount;
    if (_lapCallback) _lapCallback(playerPhysics.lapCount);
  }
  if (playerPhysics.finished && _finishCallback) {
    _finishCallback(playerPhysics.totalTime);
    _finishCallback = null; // fire once
  }

  updateRemoteMeshes();
  updateHUD(st);
}

function updateRemoteMeshes() {
  for (const [id, rc] of remoteCars) {
    if (rc.mesh) {
      rc.mesh.position.x += (rc.targetX - rc.mesh.position.x) * .15;
      rc.mesh.position.z += (rc.targetZ - rc.mesh.position.z) * .15;
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

  let pos = 1;
  for (const [, rc] of remoteCars) {
    if (!rc.fading && rc.lapCount > playerPhysics.lapCount) pos++;
    else if (!rc.fading && rc.lapCount === playerPhysics.lapCount && rc.trackT > (playerPhysics._prevT || 0)) pos++;
  }

  hudEl.innerHTML =
    `<div>LAP ${lap}/${track.data.laps}</div>` +
    `<div>POS ${pos}/${remoteCars.size + 1}</div>` +
    `<div>SPD ${spd} KM/H</div>` +
    `<div>TIME ${ltStr}</div>` +
    `<div>BEST ${blStr}</div>` +
    (playerPhysics.finished ? `<div class="finish">FINISH! ${formatTime(playerPhysics.totalTime)}</div>` : '') +
    (st.drift > .3 ? '<div class="drift">DRIFT!</div>' : '');
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

// ---- Synthwave sky ----
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
  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(30, 16),
    new THREE.MeshBasicMaterial({ color: 0xff4400, side: THREE.DoubleSide })
  );
  sun.position.set(0, 40, -350); sun.lookAt(0, 40, 0);
  const sg = new THREE.Group();
  sg.add(m); sg.add(sun);
  return sg;
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
  const mesh = createCarMesh(colorArr || getCarColor(remoteCars.size + 1));
  scene.add(mesh);
  remoteCars.set(id, {
    mesh, targetX: 0, targetZ: 0, targetAngle: 0,
    fadeAlpha: 1, fading: false, lapCount: 0, trackT: 0
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
export { track, playerPhysics, mapJsonToTrackData };
