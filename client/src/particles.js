// Particle system for drift sparks and exhaust smoke
import * as THREE from 'three';

const MAX_PARTICLES = 200;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this.sparkGeo = new THREE.BufferGeometry();
    this.sparkPositions = new Float32Array(MAX_PARTICLES * 3);
    this.sparkColors = new Float32Array(MAX_PARTICLES * 3);
    this.sparkSizes = new Float32Array(MAX_PARTICLES);
    this.activeCount = 0;

    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkColors, 3));
    this.sparkGeo.setAttribute('size', new THREE.BufferAttribute(this.sparkSizes, 1));

    // Custom shader for point sprites with glow
    this.sparkMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (200.0 / -mvPos.z);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          float a = 1.0 - d * 2.0;
          gl_FragColor = vec4(vColor * (1.0 + a), a);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.sparkMesh = new THREE.Points(this.sparkGeo, this.sparkMaterial);
    this.sparkMesh.frustumCulled = false;
    scene.add(this.sparkMesh);
  }

  // Spawn drift sparks behind the car
  emitDriftSparks(x, z, angle, speed, driftAmount) {
    if (driftAmount < 0.3 || speed < 5) return;
    const count = Math.min(3, Math.floor(driftAmount * 3));
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      // Sparks come from rear wheels
      const side = (i % 2 === 0) ? 0.7 : -0.7;
      const rearX = x - Math.sin(angle) * 1.8 + Math.cos(angle) * side;
      const rearZ = z - Math.cos(angle) * 1.8 - Math.sin(angle) * side;
      this.particles.push({
        x: rearX + (Math.random() - 0.5) * 0.3,
        y: 0.1 + Math.random() * 0.3,
        z: rearZ + (Math.random() - 0.5) * 0.3,
        vx: (Math.random() - 0.5) * 2 - Math.sin(angle) * speed * 0.02,
        vy: Math.random() * 3 + 1,
        vz: (Math.random() - 0.5) * 2 - Math.cos(angle) * speed * 0.02,
        life: 0.3 + Math.random() * 0.4,
        maxLife: 0.3 + Math.random() * 0.4,
        type: 'spark',
        r: 1.0, g: 0.6 + Math.random() * 0.4, b: 0.1 * Math.random(),
        size: 2 + Math.random() * 3,
      });
    }
  }

  // Spawn exhaust puffs behind the car
  emitExhaust(x, z, angle, speed) {
    if (speed < 3) return;
    if (Math.random() > 0.3) return; // throttle rate
    // Exhaust pipes at rear center
    const rearX = x - Math.sin(angle) * 2.1;
    const rearZ = z - Math.cos(angle) * 2.1;
    for (const off of [-0.3, 0.3]) {
      if (this.particles.length >= MAX_PARTICLES) break;
      const ox = rearX + Math.cos(angle) * off;
      const oz = rearZ - Math.sin(angle) * off;
      this.particles.push({
        x: ox, y: 0.1, z: oz,
        vx: -Math.sin(angle) * speed * 0.01 + (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random() * 0.5,
        vz: -Math.cos(angle) * speed * 0.01 + (Math.random() - 0.5) * 0.5,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.4 + Math.random() * 0.3,
        type: 'exhaust',
        r: 0.3, g: 0.15, b: 0.4,
        size: 3 + Math.random() * 2,
      });
    }
  }

  // Emit wall impact sparks
  emitWallSparks(x, z, nx, nz) {
    for (let i = 0; i < 8; i++) {
      if (this.particles.length >= MAX_PARTICLES) break;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.5,
        y: 0.2 + Math.random() * 0.5,
        z: z + (Math.random() - 0.5) * 0.5,
        vx: nx * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 4,
        vz: nz * (2 + Math.random() * 4) + (Math.random() - 0.5) * 3,
        life: 0.3 + Math.random() * 0.3,
        maxLife: 0.3 + Math.random() * 0.3,
        type: 'spark',
        r: 1.0, g: 0.8, b: 0.2,
        size: 2 + Math.random() * 3,
      });
    }
  }

  update(dt) {
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= 6 * dt; // gravity
      if (p.y < 0) { p.y = 0; p.vy *= -0.3; }
    }

    // Write to buffers
    this.activeCount = Math.min(this.particles.length, MAX_PARTICLES);
    for (let i = 0; i < this.activeCount; i++) {
      const p = this.particles[i];
      const fade = p.life / p.maxLife;
      this.sparkPositions[i * 3] = p.x;
      this.sparkPositions[i * 3 + 1] = p.y;
      this.sparkPositions[i * 3 + 2] = p.z;
      this.sparkColors[i * 3] = p.r * fade;
      this.sparkColors[i * 3 + 1] = p.g * fade;
      this.sparkColors[i * 3 + 2] = p.b * fade;
      this.sparkSizes[i] = p.size * fade;
    }
    // Zero out remaining
    for (let i = this.activeCount; i < MAX_PARTICLES; i++) {
      this.sparkSizes[i] = 0;
    }

    this.sparkGeo.attributes.position.needsUpdate = true;
    this.sparkGeo.attributes.color.needsUpdate = true;
    this.sparkGeo.attributes.size.needsUpdate = true;
    this.sparkGeo.setDrawRange(0, this.activeCount);
  }

  destroy() {
    if (this.sparkMesh && this.scene) {
      this.scene.remove(this.sparkMesh);
    }
    this.sparkGeo.dispose();
    this.sparkMaterial.dispose();
    this.particles = [];
  }
}
