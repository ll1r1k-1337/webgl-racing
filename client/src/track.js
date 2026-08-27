import * as THREE from 'three';

// ---- Track data format ----
// { name, controlPoints: [x,z][], width, wallHeight, laps, props: {type,x,z,...}[] }

export const testTrack = {
  name: "Neon Circuit",
  controlPoints: [
    [0, 0], [60, 5], [110, -10], [140, -50],
    [145, -100], [120, -145], [70, -170],
    [10, -175], [-30, -150], [-55, -110],
    [-65, -60], [-50, -20], [-20, -5]
  ],
  width: 14,
  wallHeight: 1.2,
  laps: 3,
  props: [
    { type: 'tree', x: 170, z: -50 }, { type: 'tree', x: 165, z: -90 },
    { type: 'tree', x: 150, z: -130 }, { type: 'tree', x: -85, z: -110 },
    { type: 'tree', x: -85, z: -60 }, { type: 'tree', x: -75, z: -30 },
    { type: 'tree', x: 30, z: -200 }, { type: 'tree', x: -10, z: -200 },
    { type: 'tree', x: 80, z: 30 }, { type: 'tree', x: 120, z: 20 },
    { type: 'building', x: 30, z: 30, w: 8, h: 12, d: 8 },
    { type: 'building', x: 70, z: 35, w: 6, h: 8, d: 6 },
    { type: 'building', x: -40, z: 20, w: 10, h: 15, d: 10 },
    { type: 'building', x: 50, z: -200, w: 12, h: 10, d: 8 },
    { type: 'building', x: -90, z: -140, w: 7, h: 18, d: 7 },
    { type: 'building', x: 170, z: -20, w: 9, h: 14, d: 9 },
  ]
};

// Convert JSON map file format (MAPS.md schema) to Track constructor data
export function mapJsonToTrackData(json) {
  return {
    name: json.name,
    controlPoints: json.centerline.map(p => [p.x, p.z]),
    width: json.trackWidth * 2,         // JSON trackWidth is half-width
    wallHeight: (json.walls && json.walls[0]) ? json.walls[0].height : 1.5,
    laps: json.laps,
    spawnPositions: json.spawnPositions || [],
    props: (json.props || []).map(p => {
      const r = { type: p.type, x: p.position.x, z: p.position.z };
      if (p.scale) { r.w = p.scale.x; r.h = p.scale.y; r.d = p.scale.z; }
      if (p.color) r.color = p.color;
      return r;
    }),
  };
}

export class Track {
  constructor(trackData, sampleCount = 400) {
    this.data = trackData;
    this.samples = sampleCount;
    this.halfW = trackData.width / 2;

    const pts = trackData.controlPoints.map(p => new THREE.Vector3(p[0], 0, p[1]));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
    this.length = this.curve.getLength();

    this.pts = []; this.tans = []; this.norms = [];
    this.edgeL = []; this.edgeR = [];
    for (let i = 0; i <= sampleCount; i++) {
      const t = i / sampleCount;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t).normalize();
      const n = new THREE.Vector3(-tan.z, 0, tan.x);
      this.pts.push(p); this.tans.push(tan); this.norms.push(n);
      this.edgeL.push(p.clone().addScaledVector(n, -this.halfW));
      this.edgeR.push(p.clone().addScaledVector(n, this.halfW));
    }
    this._hint = 0;
  }

  // Start position and heading for car placement
  getStartPosition() {
    const p = this.pts[0], t = this.tans[0], n = this.norms[0];
    // Place car 3 units behind start line, offset to right lane
    return {
      x: p.x - t.x * 3 + n.x * 2,
      z: p.z - t.z * 3 + n.z * 2,
      angle: Math.atan2(t.x, t.z) // heading angle (0 = +Z)
    };
  }

  // Find nearest segment index to (x,z)
  nearest(x, z) {
    const n = this.samples;
    let best = Infinity, idx = this._hint;
    const scan = (a, b) => {
      for (let i = a; i <= b; i++) {
        const ii = ((i % n) + n) % n;
        const p = this.pts[ii];
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) { best = d; idx = ii; }
      }
    };
    scan(this._hint - 40, this._hint + 40);
    if (best > this.halfW * this.halfW * 9) scan(0, n - 1);
    this._hint = idx;
    return idx;
  }

  // Track-relative position: lateral offset, trackT parameter
  project(x, z) {
    const i = this.nearest(x, z);
    const c = this.pts[i], nm = this.norms[i], tn = this.tans[i];
    const dx = x - c.x, dz = z - c.z;
    return {
      lateral: dx * nm.x + dz * nm.z,
      forward: dx * tn.x + dz * tn.z,
      segIdx: i, trackT: i / this.samples,
      cx: c.x, cz: c.z, nx: nm.x, nz: nm.z, tx: tn.x, tz: tn.z
    };
  }

  // Wall collision → { hit, pushX, pushZ, nx, nz }
  wallHit(x, z, carHW = 0.9) {
    const p = this.project(x, z);
    const edge = this.halfW - carHW;
    if (Math.abs(p.lateral) <= edge) return { hit: false };
    const sign = p.lateral > 0 ? 1 : -1;
    const pen = Math.abs(p.lateral) - edge;
    return {
      hit: true, penetration: pen,
      pushX: -sign * p.nx * pen, pushZ: -sign * p.nz * pen,
      nx: -sign * p.nx, nz: -sign * p.nz
    };
  }

  // ---- 3D meshes ----
  createMeshes() {
    const g = new THREE.Group();
    g.add(this._road());
    g.add(this._walls());
    g.add(this._markings());
    g.add(this._startLine());
    g.add(this._props());
    return g;
  }

  _road() {
    const pos = [], col = [];
    for (let i = 0; i < this.samples; i++) {
      const j = i + 1;
      const l0 = this.edgeL[i], r0 = this.edgeR[i];
      const l1 = this.edgeL[j], r1 = this.edgeR[j];
      pos.push(l0.x,.01,l0.z, r0.x,.01,r0.z, r1.x,.01,r1.z);
      pos.push(l0.x,.01,l0.z, r1.x,.01,r1.z, l1.x,.01,l1.z);
      const v = .12 + Math.sin(i * .3) * .015;
      for (let k = 0; k < 6; k++) col.push(v, v, v + .01);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  _walls() {
    const grp = new THREE.Group();
    const h = this.data.wallHeight;
    const cA = [1, 0, .5], cB = [0, .8, 1]; // hot pink / cyan

    for (const [side, edges] of [['L', this.edgeL], ['R', this.edgeR]]) {
      const pos = [], col = [];
      for (let i = 0; i < this.samples; i++) {
        const j = i + 1;
        const e0 = edges[i], e1 = edges[j];
        const c = (Math.floor(i / 6) & 1) ? cA : cB;
        // face
        pos.push(e0.x,0,e0.z, e1.x,0,e1.z, e1.x,h,e1.z);
        pos.push(e0.x,0,e0.z, e1.x,h,e1.z, e0.x,h,e0.z);
        for (let k = 0; k < 6; k++) col.push(c[0], c[1], c[2]);
        // top cap
        const nm = this.norms[i], d = side === 'L' ? .3 : -.3;
        pos.push(e0.x,h,e0.z, e1.x,h,e1.z, e1.x+nm.x*d,h,e1.z+nm.z*d);
        pos.push(e0.x,h,e0.z, e1.x+nm.x*d,h,e1.z+nm.z*d, e0.x+nm.x*d,h,e0.z+nm.z*d);
        for (let k = 0; k < 6; k++) col.push(c[0]*.6, c[1]*.6, c[2]*.6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));
    }
    return grp;
  }

  _markings() {
    const pos = [], col = [], dash = 4;
    for (let i = 0; i < this.samples; i++) {
      if (Math.floor(i / dash) & 1) continue;
      const j = i + 1;
      const c0 = this.pts[i], c1 = this.pts[j];
      const n0 = this.norms[i], n1 = this.norms[j];
      const w = .12;
      pos.push(
        c0.x-n0.x*w,.025,c0.z-n0.z*w, c0.x+n0.x*w,.025,c0.z+n0.z*w, c1.x+n1.x*w,.025,c1.z+n1.z*w,
        c0.x-n0.x*w,.025,c0.z-n0.z*w, c1.x+n1.x*w,.025,c1.z+n1.z*w, c1.x-n1.x*w,.025,c1.z-n1.z*w
      );
      for (let k = 0; k < 6; k++) col.push(.85,.85,.7);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  _startLine() {
    const p = this.pts[0], n = this.norms[0], t = this.tans[0];
    const pos = [], col = [], sq = 8, sz = (this.halfW * 2) / sq;
    for (let i = 0; i < sq; i++) for (let j = 0; j < 2; j++) {
      const w = ((i + j) & 1) ? .95 : .1;
      const o0 = -this.halfW + i * sz, o1 = o0 + sz;
      const f0 = j, f1 = f0 + 1;
      const vx = (oi, fi) => p.x + n.x * oi + t.x * fi;
      const vz = (oi, fi) => p.z + n.z * oi + t.z * fi;
      pos.push(vx(o0,f0),.03,vz(o0,f0), vx(o1,f0),.03,vz(o1,f0), vx(o1,f1),.03,vz(o1,f1));
      pos.push(vx(o0,f0),.03,vz(o0,f0), vx(o1,f1),.03,vz(o1,f1), vx(o0,f1),.03,vz(o0,f1));
      for (let k = 0; k < 6; k++) col.push(w, w, w);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true }));
  }

  _props() {
    const g = new THREE.Group();
    const hash = (x, z) => ((x * 73856093) ^ (z * 19349663)) >>> 0;
    for (const pr of this.data.props) {
      if (pr.type === 'tree') {
        const trunk = new THREE.Mesh(
          new THREE.BoxGeometry(.5, 3, .5),
          new THREE.MeshBasicMaterial({ color: 0x4a2800 })
        );
        trunk.position.set(pr.x, 1.5, pr.z);
        g.add(trunk);
        const crown = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 3.5, 2.5),
          new THREE.MeshBasicMaterial({ color: 0x00aa44 })
        );
        crown.position.set(pr.x, 4.75, pr.z);
        g.add(crown);
      } else if (pr.type === 'building') {
        const w = pr.w || 8, h = pr.h || 10, d = pr.d || 8;
        const bCols = [0x1a0533, 0x0a0a2e, 0x1a1a3e, 0x2a0a3e];
        const bc = bCols[hash(pr.x | 0, pr.z | 0) % bCols.length];
        const bld = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: bc })
        );
        bld.position.set(pr.x, h / 2, pr.z); g.add(bld);
        // neon trim
        const trim = new THREE.Mesh(
          new THREE.BoxGeometry(w + .2, .3, d + .2),
          new THREE.MeshBasicMaterial({ color: 0xff00ff })
        );
        trim.position.set(pr.x, h, pr.z); g.add(trim);
        // windows (emissive strips)
        for (let wy = 2; wy < h - 1; wy += 2.5) {
          const wc = hash(pr.x | 0, wy | 0) % 3 === 0 ? 0x00ffff : 0xffff00;
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(w * .7, .8, d + .02),
            new THREE.MeshBasicMaterial({ color: wc, transparent: true, opacity: .3 })
          );
          win.position.set(pr.x, wy, pr.z); g.add(win);
        }
      } else if (pr.type === 'neon_sign') {
        const w = pr.w || 4, h = pr.h || 2, d = pr.d || 0.5;
        const c = pr.color ? new THREE.Color(pr.color[0], pr.color[1], pr.color[2]) : new THREE.Color(0xff00ff);
        const sign = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshBasicMaterial({ color: c })
        );
        sign.position.set(pr.x, pr.y || h / 2, pr.z);
        g.add(sign);
      } else if (pr.type === 'light_pole') {
        const w = pr.w || 0.3, h = pr.h || 6, d = pr.d || 0.3;
        const pole = new THREE.Mesh(
          new THREE.BoxGeometry(w, h, d),
          new THREE.MeshBasicMaterial({ color: 0x555555 })
        );
        pole.position.set(pr.x, h / 2, pr.z); g.add(pole);
        // Glowing top
        const lamp = new THREE.Mesh(
          new THREE.BoxGeometry(1, .3, 1),
          new THREE.MeshBasicMaterial({ color: 0x00ffff })
        );
        lamp.position.set(pr.x, h + .15, pr.z); g.add(lamp);
      }
    }
    return g;
  }
}
