import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  LineBasicMaterial,
  LineSegments,
  Points,
  ShaderMaterial,
  type Texture,
  Vector3,
} from 'three';

/**
 * Pooled particle system (one draw call). All bursts reuse the same buffers,
 * so effects never allocate inside the render loop.
 */
export class Particles {
  readonly points: Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly alpha: Float32Array;
  private readonly drag: Float32Array;
  private readonly gravity: Float32Array;
  private cursor = 0;
  private readonly geo: BufferGeometry;
  private readonly tmpColor = new Color();

  constructor(max: number, texture: Texture) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.geo = new BufferGeometry();
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new BufferAttribute(this.size, 1));
    this.geo.setAttribute('alpha', new BufferAttribute(this.alpha, 1));
    const mat = new ShaderMaterial({
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute float alpha; attribute vec3 color;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color; vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(0.1, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec3 vColor; varying float vAlpha;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewportHeight(px: number): void {
    (this.points.material as ShaderMaterial).uniforms.uScale.value = px * 0.9;
  }

  emit(
    at: Vector3,
    count: number,
    color: number,
    speed: number,
    opts: { life?: number; size?: number; drag?: number; gravity?: number; spread?: Vector3; dir?: Vector3 } = {},
  ): void {
    const life = opts.life ?? 1;
    const size = opts.size ?? 0.35;
    this.tmpColor.set(color);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const i3 = i * 3;
      // Random direction on a sphere.
      const u = Math.random() * 2 - 1;
      const th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      let vx = r * Math.cos(th);
      let vy = u;
      let vz = r * Math.sin(th);
      if (opts.dir) {
        vx = vx * 0.35 + opts.dir.x;
        vy = vy * 0.35 + opts.dir.y;
        vz = vz * 0.35 + opts.dir.z;
      }
      const sp = speed * (0.4 + Math.random() * 0.6);
      this.pos[i3] = at.x + (opts.spread ? (Math.random() - 0.5) * opts.spread.x : 0);
      this.pos[i3 + 1] = at.y + (opts.spread ? (Math.random() - 0.5) * opts.spread.y : 0);
      this.pos[i3 + 2] = at.z + (opts.spread ? (Math.random() - 0.5) * opts.spread.z : 0);
      this.vel[i3] = vx * sp;
      this.vel[i3 + 1] = vy * sp;
      this.vel[i3 + 2] = vz * sp;
      const tint = 0.75 + Math.random() * 0.25;
      this.col[i3] = this.tmpColor.r * tint;
      this.col[i3 + 1] = this.tmpColor.g * tint;
      this.col[i3 + 2] = this.tmpColor.b * tint;
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.life[i] = life * (0.6 + Math.random() * 0.4);
      this.maxLife[i] = this.life[i];
      this.drag[i] = opts.drag ?? 1.5;
      this.gravity[i] = opts.gravity ?? 0;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const i3 = i * 3;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i3] *= k;
      this.vel[i3 + 1] = this.vel[i3 + 1] * k - this.gravity[i] * dt;
      this.vel[i3 + 2] *= k;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = t < 0.7 ? t / 0.7 : 1;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.alpha.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
  }
}

/**
 * Speed streaks drawn close to one player's camera only (camera layer).
 * Lives in camera space, so it never appears in the other view.
 */
export class WindStreaks {
  readonly lines: LineSegments;
  private readonly count: number;
  private readonly seeds: Float32Array;
  private readonly pos: Float32Array;
  private readonly material: LineBasicMaterial;

  constructor(count = 26) {
    this.count = count;
    this.seeds = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.respawn(i, Math.random() * 30);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.material = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
  }

  private respawn(i: number, z = 30): void {
    const a = Math.random() * Math.PI * 2;
    const r = 1.5 + Math.random() * 3.5;
    this.seeds[i * 3] = Math.cos(a) * r;
    this.seeds[i * 3 + 1] = Math.sin(a) * r * 0.7;
    this.seeds[i * 3 + 2] = -z;
  }

  update(dt: number, speed: number, intensity: number): void {
    const len = 0.6 + speed * 0.06;
    for (let i = 0; i < this.count; i++) {
      this.seeds[i * 3 + 2] += speed * 1.3 * dt;
      if (this.seeds[i * 3 + 2] > 1) this.respawn(i, 25 + Math.random() * 10);
      const x = this.seeds[i * 3];
      const y = this.seeds[i * 3 + 1];
      const z = this.seeds[i * 3 + 2];
      const o = i * 6;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x;
      this.pos[o + 4] = y;
      this.pos[o + 5] = z - len;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = intensity;
    this.lines.visible = intensity > 0.01;
  }
}
