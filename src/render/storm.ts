import {
  BufferAttribute,
  BufferGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshToonMaterial,
} from 'three';
import { toon, addOutlines } from './toon';

/**
 * Easter egg 3 visuals: a dark, puffy storm cloud with rain falling from it.
 * World-space, so both players can see the cloud hunting its victim.
 */
export class StormCloud {
  readonly root = new Group();
  private readonly puffs = new Group();
  private readonly material: MeshToonMaterial;
  private readonly rain: LineSegments;
  private readonly rainMat: LineBasicMaterial;
  private readonly drops: Float32Array;
  private readonly pos: Float32Array;
  private readonly count: number;
  private flash = 0;
  private nextFlash = 2;

  constructor(lowQuality: boolean) {
    this.material = toon({ color: 0x4a4f63 });
    const geo = new IcosahedronGeometry(1, 2);
    const blobs: [number, number, number, number][] = [
      [0, 0, 0, 2.6],
      [2.3, -0.3, 0.4, 2.0],
      [-2.4, -0.2, -0.3, 2.1],
      [0.9, 0.9, -1.2, 1.9],
      [-1.0, 0.8, 1.2, 1.8],
      [3.8, -0.6, -0.6, 1.4],
      [-3.9, -0.5, 0.7, 1.4],
      [0.2, -0.7, 1.9, 1.6],
      [-0.3, -0.6, -2.0, 1.6],
    ];
    for (const [x, y, z, r] of blobs) {
      const m = new Mesh(geo, this.material);
      m.position.set(x, y, z);
      m.scale.set(r, r * 0.78, r);
      this.puffs.add(m);
    }
    addOutlines(this.puffs, 0.06, 0x1b1726);
    this.root.add(this.puffs);

    this.count = lowQuality ? 260 : 520;
    this.drops = new Float32Array(this.count * 3);
    this.pos = new Float32Array(this.count * 6);
    for (let i = 0; i < this.count; i++) this.respawn(i, Math.random() * 14);
    const rg = new BufferGeometry();
    rg.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.rainMat = new LineBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0, depthWrite: false });
    this.rain = new LineSegments(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
    this.root.visible = false;
  }

  private respawn(i: number, fall = 0): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 4.6;
    this.drops[i * 3] = Math.cos(a) * r;
    this.drops[i * 3 + 1] = -1.2 - fall;
    this.drops[i * 3 + 2] = Math.sin(a) * r;
  }

  /** cloud/rain 0..1 from the simulation. */
  update(x: number, y: number, z: number, cloud: number, rain: number, time: number, dt: number): void {
    this.root.visible = cloud > 0.01;
    if (!this.root.visible) return;
    this.root.position.set(x, y, z);
    const s = 0.4 + 0.6 * cloud;
    this.puffs.scale.setScalar(s);
    this.puffs.rotation.y = time * 0.15;
    this.puffs.children.forEach((c, k) => {
      c.position.y += Math.sin(time * 1.3 + k) * 0.002;
    });

    // Occasional lightning flicker inside the cloud while it rains.
    this.nextFlash -= dt;
    if (rain > 0.3 && this.nextFlash <= 0) {
      this.flash = 1;
      this.nextFlash = 1.5 + Math.random() * 2.5;
    }
    this.flash = Math.max(0, this.flash - dt * 5);
    const f = this.flash > 0.5 || (this.flash > 0.15 && this.flash < 0.3) ? 1 : 0;
    this.material.color.setHex(f ? 0xb8c4ff : 0x4a4f63);
    this.material.emissive.setHex(f ? 0x5a66aa : 0x000000);

    const len = 0.9;
    for (let i = 0; i < this.count; i++) {
      this.drops[i * 3 + 1] -= 26 * dt;
      if (this.drops[i * 3 + 1] < -15) this.respawn(i);
      const dx = this.drops[i * 3];
      const dy = this.drops[i * 3 + 1];
      const dz = this.drops[i * 3 + 2];
      const o = i * 6;
      this.pos[o] = dx;
      this.pos[o + 1] = dy;
      this.pos[o + 2] = dz;
      this.pos[o + 3] = dx + 0.08;
      this.pos[o + 4] = dy + len;
      this.pos[o + 5] = dz;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.rainMat.opacity = 0.75 * rain;
    this.rain.visible = rain > 0.01;
  }
}

/**
 * Heavy rain right in front of one player's camera (camera layer only),
 * so the downpour gets in the victim's way without touching the other view.
 */
export class RainSheet {
  readonly lines: LineSegments;
  private readonly count: number;
  private readonly seeds: Float32Array;
  private readonly pos: Float32Array;
  private readonly material: LineBasicMaterial;

  constructor(count = 220) {
    this.count = count;
    this.seeds = new Float32Array(count * 3);
    this.pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.respawn(i, Math.random() * 6);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.material = new LineBasicMaterial({ color: 0xd6e4ff, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new LineSegments(geo, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 20;
    this.lines.visible = false;
  }

  private respawn(i: number, drop = 0): void {
    const z = -(0.8 + Math.random() * 7);
    const spread = -z * 0.75;
    this.seeds[i * 3] = (Math.random() * 2 - 1) * spread * 1.4;
    this.seeds[i * 3 + 1] = spread - drop;
    this.seeds[i * 3 + 2] = z;
  }

  update(dt: number, intensity: number): void {
    this.lines.visible = intensity > 0.01;
    if (!this.lines.visible) return;
    for (let i = 0; i < this.count; i++) {
      const z = this.seeds[i * 3 + 2];
      this.seeds[i * 3 + 1] -= 14 * dt;
      this.seeds[i * 3] -= 2.2 * dt;
      if (this.seeds[i * 3 + 1] < z * 0.75) this.respawn(i);
      const x = this.seeds[i * 3];
      const y = this.seeds[i * 3 + 1];
      const len = 0.25 + -z * 0.08;
      const o = i * 6;
      this.pos[o] = x;
      this.pos[o + 1] = y;
      this.pos[o + 2] = z;
      this.pos[o + 3] = x + len * 0.16;
      this.pos[o + 4] = y + len;
      this.pos[o + 5] = z;
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.material.opacity = 0.55 * intensity;
  }
}
