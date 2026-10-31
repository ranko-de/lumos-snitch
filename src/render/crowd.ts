import {
  DoubleSide,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  MeshToonMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOUSE_ACCENTS, HOUSE_COLORS } from './stadium';
import { toon } from './toon';

/**
 * Spectators: little cartoon people (body, head, hair, scarf, waving arms,
 * some with pointed hats). Every body part is ONE InstancedMesh per stand
 * sector, so the whole crowd costs a few dozen draw calls and can be frustum-
 * culled by sector. The ghost easter egg is a shader uniform on the same
 * materials: no new models are created.
 */

type Seat = { pos: Vector3; yaw: number; house: number; sector: number };

const SKIN = ['#f6d3b3', '#eab88f', '#d39a6a', '#a8714a', '#7a4d2f', '#f1c7a3'];
const HAIR = ['#3b2416', '#5a3a1e', '#1f1a18', '#c48a3f', '#e6c36a', '#9a3d1f', '#7d6a5a'];
const HATS = ['#3a2b5c', '#2a2a2a', '#5b3a8c', '#2e4a7a'];

/** Vertex-shader snippet shared by all crowd parts. */
const COMMON_VERT = /* glsl */ `
  uniform float uTime; uniform float uGhost; uniform float uCheer;
  varying float vGhostY;
  float hash(float n) { return fract(sin(n) * 43758.5453); }
`;

function bodyAnim(isArm: boolean): string {
  return /* glsl */ `
    float id = float(gl_InstanceID);
    float rnd = hash(id * 1.37);
    float h = clamp(position.y / 1.7, 0.0, 1.0);
    vGhostY = h;
    ${
      isArm
        ? `
    // Arms pivot at the shoulders. Idle: hang and sway. Cheering: wave above head.
    vec3 shoulder = vec3(sign(position.x) * 0.24, 1.08, 0.0);
    vec3 rel = transformed - shoulder;
    float wave = sin(uTime * (8.0 + rnd * 4.0) + id) * 0.35;
    float idle = sin(uTime * 1.3 + id * 0.7) * 0.12;
    float excited = step(0.55, hash(id * 3.1)) ; // some fans always wave a bit
    float lift = mix(0.15 + excited * 0.25 * (0.5 + 0.5 * sin(uTime * 2.0 + id)), 2.7, uCheer) + wave * uCheer + idle;
    // Ghosts hold their arms forward ("boo!").
    lift = mix(lift, 1.5 + sin(uTime * 2.0 + id) * 0.15, uGhost);
    float c = cos(-lift); float s = sin(-lift);
    rel = vec3(rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
    transformed = shoulder + rel;`
        : ''
    }
    // Idle sway and cheering jumps.
    float jump = max(0.0, sin(uTime * 9.0 + id * 0.91)) * 0.45 * uCheer;
    transformed.y += jump * (1.0 - uGhost);
    transformed.x += sin(uTime * 1.7 + id * 1.37) * 0.04 * h;
    // Ghost form: wispy tail, gently floating above the seat.
    float taper = mix(1.0, 0.45 + 0.55 * smoothstep(0.0, 0.6, h), uGhost);
    transformed.xz *= taper;
    transformed.x += uGhost * sin(uTime * 2.3 + id + h * 5.0) * 0.14 * (1.0 - h);
    transformed.y += uGhost * (0.9 + 0.35 * sin(uTime * 1.3 + id * 2.1));
  `;
}

function crowdMaterial(uniforms: Crowd['uniforms'], isArm: boolean, color = 0xffffff): MeshToonMaterial {
  const m = toon({ color, transparent: true });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_VERT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${bodyAnim(isArm)}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGhost; varying float vGhostY;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 ghostCol = mix(vec3(0.6, 0.76, 1.0), vec3(0.96, 0.99, 1.0), vGhostY);
         diffuseColor.rgb = mix(diffuseColor.rgb, ghostCol, uGhost);
         diffuseColor.a *= mix(1.0, mix(0.22, 0.85, smoothstep(0.0, 0.55, vGhostY)), uGhost);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += uGhost * vec3(0.3, 0.42, 0.7);`,
      );
  };
  m.customProgramCacheKey = () => `crowd-${isArm ? 'arm' : 'body'}`;
  return m;
}

/** Builds the part geometries for one stylised person (facing +Z, feet at y=0). */
function personGeometries(): Record<string, BufferGeometry> {
  // Kept deliberately low-poly (~300 triangles): thousands are drawn per view.
  const body = new LatheGeometry(
    [
      new Vector2(0.0, 0.0),
      new Vector2(0.35, 0.03),
      new Vector2(0.34, 0.45),
      new Vector2(0.28, 0.9),
      new Vector2(0.2, 1.12),
      new Vector2(0.0, 1.16),
    ],
    8,
  );
  const head = new SphereGeometry(0.23, 9, 6);
  head.translate(0, 1.38, 0);
  const hair = new SphereGeometry(0.245, 9, 3, 0, Math.PI * 2, 0, Math.PI * 0.5);
  hair.rotateX(-0.35);
  hair.translate(0, 1.42, -0.03);
  const eyeL = new OctahedronGeometry(0.04, 0);
  eyeL.scale(1, 1.4, 0.6);
  eyeL.translate(-0.08, 1.41, 0.21);
  const eyeR = eyeL.clone();
  eyeR.translate(0.16, 0, 0);
  const eyes = mergeGeometries([eyeL, eyeR]);
  const scarf = new CylinderGeometry(0.21, 0.25, 0.13, 8, 1, true);
  scarf.translate(0, 1.12, 0);
  // Both sleeves in one geometry, hanging from the shoulders; the shader lifts them.
  const armL = new CylinderGeometry(0.08, 0.07, 0.62, 5, 1);
  armL.translate(-0.3, 1.08 - 0.31, 0.02);
  const armR = armL.clone();
  armR.translate(0.6, 0, 0);
  const arms = mergeGeometries([armL.toNonIndexed(), armR.toNonIndexed()]);
  const hat = new ConeGeometry(0.3, 0.62, 8, 1, true);
  hat.translate(0, 1.82, -0.02);
  const brim = new CylinderGeometry(0.4, 0.4, 0.03, 8, 1, true);
  brim.translate(0, 1.53, 0);
  const hatAll = mergeGeometries([hat.toNonIndexed(), brim.toNonIndexed()]);
  return { body, head, hair, eyes, scarf, arms, hat: hatAll };
}

export class Crowd {
  readonly group = new Group();
  readonly uniforms = {
    uTime: { value: 0 },
    uGhost: { value: 0 },
    uCheer: { value: 0 },
  };
  private total = 0;

  constructor(seats: Seat[], scale = 2.05) {
    const geos = personGeometries();
    const mats = {
      body: crowdMaterial(this.uniforms, false),
      skin: crowdMaterial(this.uniforms, false),
      hair: crowdMaterial(this.uniforms, false),
      eyes: crowdMaterial(this.uniforms, false, 0x1d1426),
      scarf: crowdMaterial(this.uniforms, false),
      arms: crowdMaterial(this.uniforms, true),
      hat: crowdMaterial(this.uniforms, false),
    };
    mats.scarf.side = DoubleSide;
    mats.hat.side = DoubleSide;
    // Seeded variety so every load looks the same.
    let sd = 99;
    const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
    const bySector = new Map<number, Seat[]>();
    for (const s of seats) {
      const list = bySector.get(s.sector) ?? [];
      list.push(s);
      bySector.set(s.sector, list);
    }
    const m = new Matrix4();
    const hidden = new Matrix4().makeScale(0, 0, 0);
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const sc = new Vector3();
    const c = new Color();
    for (const list of bySector.values()) {
      const n = list.length;
      const parts = {
        body: new InstancedMesh(geos.body, mats.body, n),
        head: new InstancedMesh(geos.head, mats.skin, n),
        hair: new InstancedMesh(geos.hair, mats.hair, n),
        eyes: new InstancedMesh(geos.eyes, mats.eyes, n),
        scarf: new InstancedMesh(geos.scarf, mats.scarf, n),
        arms: new InstancedMesh(geos.arms, mats.arms, n),
        hat: new InstancedMesh(geos.hat, mats.hat, n),
      };
      list.forEach((seat, i) => {
        q.setFromAxisAngle(up, seat.yaw);
        const s = scale * (0.9 + rnd() * 0.22);
        sc.set(s, s, s);
        m.compose(seat.pos, q, sc);
        for (const p of Object.values(parts)) p.setMatrixAt(i, m);
        const house = HOUSE_COLORS[seat.house];
        const accent = HOUSE_ACCENTS[seat.house];
        const jumper = rnd() < 0.7 ? house : accent;
        parts.body.setColorAt(i, c.set(jumper).offsetHSL(0, (rnd() - 0.5) * 0.1, (rnd() - 0.5) * 0.12));
        parts.arms.setColorAt(i, c);
        const skin = c.set(SKIN[Math.floor(rnd() * SKIN.length)]);
        parts.head.setColorAt(i, skin);
        parts.hair.setColorAt(i, c.set(HAIR[Math.floor(rnd() * HAIR.length)]));
        parts.scarf.setColorAt(i, c.set(jumper === house ? accent : house));
        parts.eyes.setColorAt(i, c.set(0xffffff));
        if (rnd() < 0.22) parts.hat.setColorAt(i, c.set(HATS[Math.floor(rnd() * HATS.length)]));
        else {
          parts.hat.setMatrixAt(i, hidden);
          parts.hat.setColorAt(i, c.set(0x000000));
        }
      });
      for (const p of Object.values(parts)) {
        p.instanceMatrix.needsUpdate = true;
        if (p.instanceColor) p.instanceColor.needsUpdate = true;
        p.computeBoundingSphere();
        // Leave a margin for jumping / floating ghosts.
        if (p.boundingSphere) p.boundingSphere.radius += 4;
        this.group.add(p);
      }
      this.total += n;
    }
    this.group.name = 'crowd';
  }

  update(time: number, ghost: number, cheer: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uGhost.value = ghost;
    this.uniforms.uCheer.value = cheer;
  }

  get count(): number {
    return this.total;
  }
}
