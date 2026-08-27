import * as THREE from 'three';

const CAR_COLORS = [
  [0.12, 0.35, 0.95], // blue
  [0.95, 0.15, 0.15], // red
  [0.15, 0.9, 0.25],  // green
  [0.95, 0.85, 0.1],  // yellow
  [0.95, 0.1, 0.85],  // magenta
  [0.1, 0.95, 0.9],   // cyan
];

export function getCarColor(idx) {
  return CAR_COLORS[idx % CAR_COLORS.length];
}

// Low-poly box-car mesh (all procedural, no textures)
export function createCarMesh(rgb) {
  const g = new THREE.Group();
  const [R, G, B] = rgb;
  const body = new THREE.Color(R, G, B);
  const dark = new THREE.Color(R * .6, G * .6, B * .6);

  // Main body
  const b = box(.85*2, .4, 1.9*2, body); b.position.y = .25; g.add(b);
  // Cabin
  const cab = box(1.2, .45, 1.4, dark); cab.position.set(0, .67, .05); g.add(cab);
  // Windshield
  const ws = box(1.15, .4, .02, new THREE.Color(.1,.15,.3));
  ws.position.set(0, .67, -.68); g.add(ws);
  // Rear window
  const rw = box(1.15, .35, .02, new THREE.Color(.08,.12,.25));
  rw.position.set(0, .65, .72); g.add(rw);

  // Wheels
  const wc = new THREE.Color(.06,.06,.06);
  for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const w = box(.26, .28, .55, wc);
    w.position.set(sx * .72, .16, sz * 1.15); g.add(w);
  }

  // Headlights
  const hlc = new THREE.Color(1, .95, .5);
  const hl1 = box(.22, .12, .04, hlc); hl1.position.set(.48, .38, -1.95); g.add(hl1);
  const hl2 = box(.22, .12, .04, hlc); hl2.position.set(-.48, .38, -1.95); g.add(hl2);
  // Taillights
  const tlc = new THREE.Color(.9, .05, .05);
  const tl1 = box(.22, .12, .04, tlc); tl1.position.set(.48, .38, 1.95); g.add(tl1);
  const tl2 = box(.22, .12, .04, tlc); tl2.position.set(-.48, .38, 1.95); g.add(tl2);

  // Bumpers
  const bc = dark.clone();
  const fb = box(1.5, .2, .14, bc); fb.position.set(0, .2, -1.98); g.add(fb);
  const rb = box(1.5, .2, .14, bc); rb.position.set(0, .2, 1.98); g.add(rb);

  // Spoiler (every other car)
  if (Math.round(R * 100) % 2 === 0) {
    const sp = box(1.1, .04, .3, dark); sp.position.set(0, .76, 1.6); g.add(sp);
    const s1 = box(.06, .3, .06, dark); s1.position.set(.4, .6, 1.6); g.add(s1);
    const s2 = box(.06, .3, .06, dark); s2.position.set(-.4, .6, 1.6); g.add(s2);
  }

  // Exhaust pipes
  const ec = new THREE.Color(.2,.2,.2);
  const e1 = box(.08, .06, .06, ec); e1.position.set(-.3, .06, 2.04); g.add(e1);
  const e2 = box(.08, .06, .06, ec); e2.position.set(.3, .06, 2.04); g.add(e2);

  return g;
}

function box(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshBasicMaterial({ color })
  );
}

// ---- Arcade physics ----
export class CarPhysics {
  constructor() {
    this.x = 0; this.z = 0; this.angle = 0;
    this.speed = 0; this.lateralV = 0;
    this.steer = 0; this.drift = 0;
    this.maxSpeed = 55; this.accel = 28;
    this.brake = 45; this.friction = .6;
    this.turnRate = 2.0; this.driftFactor = .92;
    this.lapCount = 0; this.lapTime = 0;
    this.bestLap = Infinity;
    this.totalTime = 0;
    this._prevT = 0; this._crossedStart = false;
    this._finished = false;
  }

  get finished() { return this._finished; }
  set finished(v) { this._finished = v; }

  update(dt, input, track) {
    if (this._finished) return;
    if (dt > .1) dt = .1;

    // Acceleration / braking
    if (input.up) this.speed += this.accel * dt;
    if (input.down) this.speed -= this.brake * dt;
    if (!input.up && !input.down) this.speed -= this.speed * this.friction * dt;
    this.speed = Math.max(0, Math.min(this.maxSpeed, this.speed));

    // Steering (speed-dependent)
    const sf = Math.min(1, this.speed / 15);
    const drift = input.space;

    if (input.left) this.steer = -1;
    else if (input.right) this.steer = 1;
    else this.steer = 0;

    let turnMul = this.turnRate * sf;
    if (drift && this.speed > 5) {
      turnMul *= 1.4;
      this.drift += (1 - this.drift) * 3 * dt;
      this.speed *= (1 - .15 * dt);
    } else {
      this.drift *= (1 - 4 * dt);
    }
    this.angle += this.steer * turnMul * dt;

    // Movement
    const dx = Math.sin(this.angle) * this.speed * dt;
    const dz = Math.cos(this.angle) * this.speed * dt;
    this.x += dx; this.z += dz;

    // Track wall collision
    if (track) {
      const w = track.wallHit(this.x, this.z, 0.9);
      if (w.hit) {
        this.x += w.pushX; this.z += w.pushZ;
        // Reflect speed along wall normal
        const dot = dx * w.nx + dz * w.nz;
        this.speed *= Math.max(.3, 1 - Math.abs(dot) * .15);
      }

      // Lap detection
      const proj = track.project(this.x, this.z);
      const t = proj.trackT;
      if (this._prevT > .9 && t < .1) {
        if (this._crossedStart) {
          this.lapCount++;
          if (this.lapTime < this.bestLap && this.lapTime > 1) this.bestLap = this.lapTime;
          if (this.lapCount >= track.data.laps) this._finished = true;
          this.lapTime = 0;
        }
        this._crossedStart = true;
      }
      this._prevT = t;
    }

    this.lapTime += dt;
    this.totalTime += dt;
  }

  getState() {
    return { x: this.x, z: this.z, angle: this.angle, speed: this.speed, drift: this.drift };
  }

  setState(s) {
    this.x = s.x; this.z = s.z; this.angle = s.angle;
    if (s.speed !== undefined) this.speed = s.speed;
  }
}
