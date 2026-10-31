import {
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  InstancedMesh,
  Matrix4,
  Quaternion,
  TorusGeometry,
  BoxGeometry,
  type Material,
  type Object3D,
  Vector3,
  Float32BufferAttribute,
} from 'three';
import { CONFIG } from '../config';
import { BOOTH, RINGS, TOWERS } from '../game/arena';
import { toon, addOutlines } from './toon';
import { makeCloudTexture, makeFlagTexture, makeGlowTexture, makeGrassTexture, makeMoonTexture, makeStripeTexture } from './textures';

const AR = CONFIG.arena;

export interface StadiumParts {
  root: Group;
  sky: Mesh;
  skyMaterial: ShaderMaterial;
  sun: Sprite;
  moon: Mesh;
  stars: Points;
  /** Materials whose emissive intensity rises at night (lanterns, trims, windows). */
  nightGlow: { material: MeshToonMaterial; day: number; night: number }[];
  ringMaterial: MeshToonMaterial;
  flagMaterials: MeshToonMaterial[];
  clouds: Group;
  cloudMaterial: SpriteMaterial;
  boothLantern: MeshToonMaterial;
  boothSparkle: Sprite;
  /** Seat slots on the stands for crowd instancing. */
  seats: { pos: Vector3; yaw: number; house: number; sector: number }[];
  flagTime: { value: number };
}

export const HOUSE_COLORS = ['#b8322a', '#2e7d46', '#2d5fae', '#d6a924'];
export const HOUSE_ACCENTS = ['#e7b33f', '#c9ced6', '#c08a4a', '#2b2b2b'];

function ellipsePoint(t: number, s: number, y: number, out = new Vector3()): Vector3 {
  return out.set(Math.cos(t) * AR.fieldA * s, y, Math.sin(t) * AR.fieldB * s);
}

/** Builds a quad strip around the ellipse between two (s, y) profiles. */
function ellipseStrip(
  segs: number,
  s0: number,
  y0: number,
  s1: number,
  y1: number,
  colorAt: (seg: number, t: number) => Color,
  pos: number[],
  col: number[],
): void {
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const d = new Vector3();
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2;
    const t1 = ((i + 1) / segs) * Math.PI * 2;
    ellipsePoint(t0, s0, y0, a);
    ellipsePoint(t1, s0, y0, b);
    ellipsePoint(t1, s1, y1, c);
    ellipsePoint(t0, s1, y1, d);
    const cl = colorAt(i, (t0 + t1) / 2);
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v.x, v.y, v.z);
      col.push(cl.r, cl.g, cl.b);
    }
  }
}

function sectorColor(t: number): number {
  const a = ((t / (Math.PI * 2)) * 4 + 0.5) % 4;
  return Math.floor(a);
}

export function buildStadium(lowQuality: boolean): StadiumParts {
  const root = new Group();
  root.name = 'stadium';
  const nightGlow: StadiumParts['nightGlow'] = [];
  const segs = lowQuality ? 96 : 160;

  // --- Sky dome with day/night gradient (uniforms are set per viewport). ---
  const skyMaterial = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color('#4f9be8') },
      uHorizon: { value: new Color('#cfe8ff') },
      uBottom: { value: new Color('#9cc79a') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(clamp(h * 1.6, 0.0, 1.0), 0.7))
                         : mix(uHorizon, uBottom, clamp(-h * 4.0, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new Mesh(new SphereGeometry(1500, 32, 16), skyMaterial);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  root.add(sky);

  const sun = new Sprite(
    new SpriteMaterial({ map: makeGlowTexture('rgba(255,250,225,1)', 'rgba(255,220,140,0)'), depthWrite: false, fog: false, transparent: true }),
  );
  sun.position.set(-570, 500, -780);
  sun.scale.setScalar(280);
  root.add(sun);

  const moon = new Mesh(
    new CircleGeometry(56, 32),
    new MeshBasicMaterial({ map: makeMoonTexture(), transparent: true, fog: false, depthWrite: false }),
  );
  moon.position.set(540, 450, -840);
  moon.lookAt(0, 0, 0);
  root.add(moon);

  const starPos: number[] = [];
  let sd = 3;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < (lowQuality ? 300 : 700); i++) {
    const th = rnd() * Math.PI * 2;
    const ph = Math.acos(rnd() * 0.92);
    const r = 1400;
    starPos.push(Math.cos(th) * Math.sin(ph) * r, Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute('position', new Float32BufferAttribute(starPos, 3));
  const stars = new Points(
    starGeo,
    new PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }),
  );
  stars.frustumCulled = false;
  root.add(stars);

  // --- Ground: surrounding meadow + striped pitch. ---
  const meadow = new Mesh(new CircleGeometry(1400, 48), toon({ color: 0x4d7f3a, roughness: 1 }));
  meadow.rotation.x = -Math.PI / 2;
  meadow.position.y = -0.05;
  root.add(meadow);

  const pitch = new Mesh(
    new CircleGeometry(1, 128),
    toon({ map: makeGrassTexture(lowQuality ? 1024 : 2048), roughness: 0.95 }),
  );
  pitch.rotation.x = -Math.PI / 2;
  pitch.scale.set(AR.fieldA * 1.005, AR.fieldB * 1.005, 1);
  root.add(pitch);

  // --- Stands: stepped tiers with house-coloured sectors. ---
  const pos: number[] = [];
  const col: number[] = [];
  const rows = lowQuality ? CONFIG.render.crowdRowsLow : CONFIG.render.crowdRows;
  const tierCount = rows + 1;
  const ds = (AR.standsOuter - 1) / tierCount;
  const dh = (AR.standsHigh - AR.standsLow) / tierCount;
  const wood = new Color('#8a5a34');
  const woodDark = new Color('#6e4426');
  const tmpC = new Color();
  // Front wall.
  ellipseStrip(segs, 1, 0, 1, AR.standsLow, () => woodDark, pos, col);
  for (let k = 0; k < tierCount; k++) {
    const s0 = 1 + k * ds;
    const s1 = s0 + ds;
    const yTread = AR.standsLow + k * dh;
    // Tread (seat row surface).
    ellipseStrip(
      segs,
      s0,
      yTread,
      s1,
      yTread,
      (_i, t) => tmpC.set(HOUSE_COLORS[sectorColor(t)]).lerp(wood, k % 2 === 0 ? 0.15 : 0.3),
      pos,
      col,
    );
    // Riser up to next row.
    ellipseStrip(
      segs,
      s1,
      yTread,
      s1,
      yTread + dh,
      (_i, t) => tmpC.set(HOUSE_ACCENTS[sectorColor(t)]).lerp(wood, 0.55),
      pos,
      col,
    );
  }
  // Back wall (inner side above top row, outer face to the ground).
  const topY = AR.standsLow + tierCount * dh;
  ellipseStrip(segs, AR.standsOuter, topY, AR.standsOuter, AR.standsRim, (_i, t) => tmpC.set(HOUSE_COLORS[sectorColor(t)]), pos, col);
  ellipseStrip(segs, AR.standsOuter + 0.025, AR.standsRim, AR.standsOuter + 0.025, 0, () => woodDark, pos, col);
  ellipseStrip(segs, AR.standsOuter, AR.standsRim, AR.standsOuter + 0.025, AR.standsRim, () => wood, pos, col);
  const standsGeo = new BufferGeometry();
  standsGeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  standsGeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  standsGeo.computeVertexNormals();
  const stands = new Mesh(standsGeo, toon({ vertexColors: true, roughness: 0.85, side: DoubleSide, flatShading: true }));
  root.add(stands);

  // Glowing trims (night outlines) along the stand front and rim.
  const trimMat = toon({ color: 0xf2d18a, emissive: 0xffc860, emissiveIntensity: 0.05, roughness: 0.6 });
  nightGlow.push({ material: trimMat, day: 0.05, night: 1.4 });
  for (const [s, y] of [
    [1.0, AR.standsLow],
    [AR.standsOuter + 0.012, AR.standsRim],
  ] as const) {
    const tp: number[] = [];
    const tc: number[] = [];
    ellipseStrip(segs, s - 0.004, y + 0.02, s + 0.004, y + 0.02, () => new Color(1, 1, 1), tp, tc);
    ellipseStrip(segs, s, y - 0.25, s, y + 0.02, () => new Color(1, 1, 1), tp, tc);
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(tp, 3));
    g.computeVertexNormals();
    const m = new Mesh(g, trimMat);
    root.add(m);
  }

  // Crowd seat slots: two rows of spectators on every tier, about a person's
  // width apart, so the stands look properly packed.
  const seats: StadiumParts['seats'] = [];
  const subRows = lowQuality ? [0.5] : [0.32, 0.74];
  const spacing = lowQuality ? 3.8 : 2.7;
  for (let k = 0; k < rows; k++) {
    const y = AR.standsLow + k * dh;
    for (let r = 0; r < subRows.length; r++) {
      const sRow = 1 + (k + subRows[r]) * ds;
      // Approximate ellipse perimeter for this row.
      const a = AR.fieldA * sRow;
      const b = AR.fieldB * sRow;
      const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const count = Math.floor(perimeter / spacing);
      for (let i = 0; i < count; i++) {
        const t = ((i + (r % 2) * 0.5 + (rnd() - 0.5) * 0.35) / count) * Math.PI * 2;
        const p = ellipsePoint(t, sRow, y);
        // Leave the booth area free.
        if (p.z > AR.fieldB * 0.75 && Math.abs(p.x) < 8.5) continue;
        if (rnd() < 0.08) continue;
        const yaw = Math.atan2(-p.x / (AR.fieldA * AR.fieldA), -p.z / (AR.fieldB * AR.fieldB));
        seats.push({ pos: p, yaw, house: sectorColor(t), sector: Math.floor(((t / (Math.PI * 2)) % 1) * 12) });
      }
    }
  }

  // --- Lanterns on the rim (soft night lighting, emissive only). ---
  const lanternMat = toon({ color: 0xffe2a8, emissive: 0xffb347, emissiveIntensity: 0.15, roughness: 0.4 });
  nightGlow.push({ material: lanternMat, day: 0.15, night: 3.2 });
  const lanternGeo = new IcosahedronGeometry(0.55, 1);
  const poleGeo = new CylinderGeometry(0.08, 0.08, 2.4, 6);
  const poleMat = toon({ color: 0x3b2b20, roughness: 0.8 });
  const lanternCount = lowQuality ? 28 : 48;
  // One instanced draw for all poles and one for all lanterns.
  const poles = new InstancedMesh(poleGeo, poleMat, lanternCount);
  const lamps = new InstancedMesh(lanternGeo, lanternMat, lanternCount);
  const lm = new Matrix4();
  for (let i = 0; i < lanternCount; i++) {
    const t = (i / lanternCount) * Math.PI * 2;
    const p = ellipsePoint(t, AR.standsOuter + 0.01, AR.standsRim);
    lm.makeTranslation(p.x, p.y + 1.2, p.z);
    poles.setMatrixAt(i, lm);
    lm.makeTranslation(p.x, p.y + 2.6, p.z);
    lamps.setMatrixAt(i, lm);
  }
  poles.computeBoundingSphere();
  lamps.computeBoundingSphere();
  root.add(poles, lamps);

  // --- Hoops. ---
  const ringMaterial = toon({ color: 0xe5b94a, metalness: 0.7, roughness: 0.3, emissive: 0xffc24a, emissiveIntensity: 0 });
  nightGlow.push({ material: ringMaterial, day: 0, night: 0.9 });
  const postMat = toon({ color: 0xd9c08a, metalness: 0.4, roughness: 0.45 });
  for (const r of RINGS) {
    const torus = new Mesh(new TorusGeometry(r.radius, r.tube, 12, 48), ringMaterial);
    torus.position.copy(r.center);
    torus.rotation.y = Math.PI / 2;
    root.add(torus);
    addOutlines(torus, 0.07);
    const post = new Mesh(new CylinderGeometry(AR.postRadius * 0.8, AR.postRadius, r.postTop, 10), postMat);
    post.position.set(r.center.x, r.postTop / 2, r.center.z);
    root.add(post);
    addOutlines(post, 0.06);
    const base = new Mesh(new CylinderGeometry(1.1, 1.3, 0.5, 12), postMat);
    base.position.set(r.center.x, 0.25, r.center.z);
    root.add(base);
  }

  // --- Towers with striped walls, conical roofs and flags. ---
  const flagTime = { value: 0 };
  const flagMaterials: MeshToonMaterial[] = [];
  const flagGeo = new PlaneGeometry(4.2, 2.2, 12, 4);
  flagGeo.translate(2.1, 0, 0);
  const windowMat = toon({ color: 0x3a2a1a, emissive: 0xffc870, emissiveIntensity: 0.0 });
  nightGlow.push({ material: windowMat, day: 0, night: 2.2 });
  TOWERS.forEach((tw, i) => {
    const house = i % 4;
    const wall = new Mesh(
      new CylinderGeometry(tw.radius * 0.92, tw.radius, AR.towerHeight, 16, 1, true),
      toon({ map: makeStripeTexture(HOUSE_COLORS[house], HOUSE_ACCENTS[house]), roughness: 0.8 }),
    );
    wall.position.set(tw.x, AR.towerHeight / 2, tw.z);
    root.add(wall);
    addOutlines(wall, 0.14);
    const roof = new Mesh(new ConeGeometry(tw.radius * 1.25, 7, 16), toon({ color: HOUSE_COLORS[house], roughness: 0.6 }));
    roof.position.set(tw.x, AR.towerHeight + 3.5, tw.z);
    root.add(roof);
    addOutlines(roof, 0.16);
    const win = new Mesh(new BoxGeometry(1.2, 1.8, 0.2), windowMat);
    const toCenter = Math.atan2(-tw.x, -tw.z);
    win.position.set(tw.x - Math.sin(toCenter) * -tw.radius * 0.96, AR.towerHeight * 0.75, tw.z - Math.cos(toCenter) * -tw.radius * 0.96);
    win.rotation.y = toCenter;
    root.add(win);
    const pole = new Mesh(new CylinderGeometry(0.1, 0.1, 6, 6), poleMat);
    pole.position.set(tw.x, AR.towerHeight + 9, tw.z);
    root.add(pole);
    const fm = toon({ map: makeFlagTexture(HOUSE_COLORS[house], HOUSE_ACCENTS[house]), side: DoubleSide, roughness: 0.9 });
    addFlagWave(fm, flagTime, i);
    flagMaterials.push(fm);
    const flag = new Mesh(flagGeo, fm);
    flag.position.set(tw.x, AR.towerHeight + 10.8, tw.z);
    flag.rotation.y = i * 0.7;
    root.add(flag);
  });

  // Banners hanging on the inner back wall between towers.
  const bannerGeo = new PlaneGeometry(3, 5, 1, 6);
  for (let i = 0; i < 24; i++) {
    const t = ((i + 0.25) / 24) * Math.PI * 2;
    const p = ellipsePoint(t, AR.standsOuter - 0.004, AR.standsRim - 2.6);
    if (p.z > AR.fieldB * 0.75 && Math.abs(p.x) < 10) continue;
    const house = sectorColor(t);
    const m = toon({ map: makeFlagTexture(HOUSE_COLORS[house], HOUSE_ACCENTS[house]), side: DoubleSide });
    const b = new Mesh(bannerGeo, m);
    b.position.copy(p);
    b.rotation.y = Math.atan2(-p.x / (AR.fieldA * AR.fieldA), -p.z / (AR.fieldB * AR.fieldB));
    b.rotation.z = Math.PI / 2;
    root.add(b);
  }

  // --- Judges' booth (Dumbledore's balcony). ---
  const booth = buildBooth();
  addOutlines(booth.group, 0.06);
  root.add(booth.group);

  // --- Distant scenery: mountains and a castle silhouette. ---
  root.add(buildScenery(lowQuality, nightGlow));

  // --- Painted clouds (soft billboards). ---
  const cloudMaterial = new SpriteMaterial({ map: makeCloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
  const clouds = new Group();
  for (let i = 0; i < (lowQuality ? 9 : 18); i++) {
    const c = new Sprite(cloudMaterial);
    const ang = rnd() * Math.PI * 2;
    const dist = 380 + rnd() * 520;
    c.position.set(Math.cos(ang) * dist, 150 + rnd() * 110, Math.sin(ang) * dist);
    const w = 140 + rnd() * 150;
    c.scale.set(w, w * 0.45, 1);
    clouds.add(c);
  }
  root.add(clouds);

  // --- Trees dotted around the grounds (one instanced draw each). ---
  root.add(buildTrees(lowQuality));

  return {
    root,
    sky,
    skyMaterial,
    sun,
    moon,
    stars,
    nightGlow,
    ringMaterial,
    flagMaterials,
    clouds,
    cloudMaterial,
    boothLantern: booth.lantern,
    boothSparkle: booth.sparkle,
    seats,
    flagTime,
  };
}

function addFlagWave(m: Material, time: { value: number }, phase: number): void {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float k = position.x / 4.2;
         transformed.z += sin(position.x * 1.6 - uTime * 5.0 + ${phase.toFixed(1)}) * 0.45 * k;
         transformed.y += sin(position.x * 1.1 - uTime * 3.0) * 0.12 * k;`,
      );
  };
}

function buildBooth(): { group: Group; lantern: MeshToonMaterial; sparkle: Sprite } {
  const g = new Group();
  const b = BOOTH.body;
  const w = b.max.x - b.min.x;
  const d = b.max.z - b.min.z;
  const floorY = BOOTH.floorY;
  const purple = toon({ color: 0x23306a, roughness: 0.7 });
  const cream = toon({ color: 0xf0dfb0, roughness: 0.8 });
  const gold = toon({ color: 0xe0b04a, metalness: 0.6, roughness: 0.35 });
  const woodM = toon({ color: 0x7a4d2a, roughness: 0.8 });
  const cz = (b.min.z + b.max.z) / 2;

  // Supporting pillars from the stands.
  for (const x of [b.min.x + 0.6, b.max.x - 0.6]) {
    const pillar = new Mesh(new CylinderGeometry(0.45, 0.55, floorY, 10), woodM);
    pillar.position.set(x, floorY / 2, b.min.z + 0.6);
    g.add(pillar);
  }
  const floor = new Mesh(new BoxGeometry(w, 0.6, d), woodM);
  floor.position.set(0, floorY - 0.3, cz);
  g.add(floor);
  const back = new Mesh(new BoxGeometry(w, b.max.y - floorY, 0.5), purple);
  back.position.set(0, (floorY + b.max.y) / 2, b.max.z - 0.25);
  g.add(back);
  for (const x of [b.min.x + 0.25, b.max.x - 0.25]) {
    const side = new Mesh(new BoxGeometry(0.5, b.max.y - floorY - 1.5, d), purple);
    side.position.set(x, floorY + (b.max.y - floorY - 1.5) / 2, cz);
    g.add(side);
  }
  // Peaked roof.
  const roof = new Mesh(new ConeGeometry(Math.hypot(w, d) * 0.58, 4.5, 4), toon({ color: 0x3c2466, roughness: 0.6 }));
  roof.position.set(0, b.max.y - 1.0, cz);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, d / w);
  g.add(roof);
  const finial = new Mesh(new SphereGeometry(0.45, 12, 8), gold);
  finial.position.set(0, b.max.y + 1.4, cz);
  g.add(finial);
  // Front railing with gold balusters.
  const rail = new Mesh(new BoxGeometry(w, 0.2, 0.25), gold);
  rail.position.set(0, floorY + 0.8, b.min.z + 0.15);
  g.add(rail);
  for (let i = 0; i <= 12; i++) {
    const bal = new Mesh(new CylinderGeometry(0.06, 0.06, 0.8, 6), gold);
    bal.userData.noOutline = true;
    bal.position.set(b.min.x + (i / 12) * w, floorY + 0.4, b.min.z + 0.15);
    g.add(bal);
  }
  // Draped front banner.
  const drape = new Mesh(new PlaneGeometry(w * 0.9, 2.4), toon({ map: makeFlagTexture('#5b3a8c', '#e0b04a'), side: DoubleSide }));
  drape.position.set(0, floorY - 1.5, b.min.z - 0.05);
  drape.rotation.y = Math.PI;
  g.add(drape);
  // Raised dais and a tall throne-like chair so he is easy to spot.
  const dais = new Mesh(new BoxGeometry(3.2, BOOTH.seat.y - floorY, 2.6), woodM);
  dais.position.set(BOOTH.seat.x, (floorY + BOOTH.seat.y) / 2, BOOTH.seat.z + 0.3);
  g.add(dais);
  const chair = new Mesh(new BoxGeometry(1.6, 0.4, 1.3), gold);
  chair.position.set(BOOTH.seat.x, BOOTH.seat.y + 0.1, BOOTH.seat.z + 0.2);
  g.add(chair);
  const chairBack = new Mesh(new BoxGeometry(1.8, 3.2, 0.3), toon({ color: 0x9c2a2a, roughness: 0.6 }));
  chairBack.position.set(BOOTH.seat.x, BOOTH.seat.y + 1.6, BOOTH.seat.z + 0.9);
  g.add(chairBack);
  const chairTop = new Mesh(new SphereGeometry(0.3, 12, 8), gold);
  chairTop.position.set(BOOTH.seat.x, BOOTH.seat.y + 3.3, BOOTH.seat.z + 0.9);
  g.add(chairTop);
  // A back panel inside the booth so the stands behind do not show through.
  const inner = new Mesh(new BoxGeometry(w - 1, b.max.y - floorY, 0.3), cream);
  inner.position.set(0, (floorY + b.max.y) / 2, BOOTH.seat.z + 1.6);
  g.add(inner);

  // Subtle hint: two little lanterns that brighten when someone approaches.
  const lantern = toon({ color: 0xe9d7ff, emissive: 0xb07cff, emissiveIntensity: 0.25 });
  for (const x of [b.min.x + 0.6, b.max.x - 0.6]) {
    const l = new Mesh(new IcosahedronGeometry(0.4, 1), lantern);
    l.position.set(x, floorY + 2.4, b.min.z + 0.3);
    g.add(l);
  }
  const sparkle = new Sprite(
    new SpriteMaterial({ map: makeGlowTexture('rgba(235,215,255,1)', 'rgba(160,100,255,0)'), transparent: true, depthWrite: false, opacity: 0 }),
  );
  sparkle.position.set(0, floorY + 2.2, b.min.z + 0.6);
  sparkle.scale.setScalar(3.5);
  g.add(sparkle);
  return { group: g, lantern, sparkle };
}

function buildScenery(lowQuality: boolean, nightGlow: StadiumParts['nightGlow']): Object3D {
  const g = new Group();
  const mountainMat = toon({ color: 0x6f8f7a });
  const farMat = toon({ color: 0x8aa3b8 });
  let sd = 11;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  // Two layers of rounded, hand-drawn looking peaks; the far one is bluer
  // (aerial perspective), the near one greener with painted snow caps.
  const layers = [
    { count: lowQuality ? 12 : 20, dist: 980, hMin: 170, hMax: 300, mat: farMat },
    { count: lowQuality ? 14 : 24, dist: 700, hMin: 90, hMax: 190, mat: mountainMat },
  ];
  for (const layer of layers) {
    for (let i = 0; i < layer.count; i++) {
      const ang = (i / layer.count) * Math.PI * 2 + rnd() * 0.18;
      if (Math.abs(ang - Math.PI * 1.5) < 0.22) continue;
      const dist = layer.dist + rnd() * 160;
      const h = layer.hMin + rnd() * (layer.hMax - layer.hMin);
      const r = h * (0.9 + rnd() * 0.5);
      g.add(makePeak(r, h, Math.cos(ang) * dist, Math.sin(ang) * dist, layer.mat, rnd));
    }
  }

  // Castle silhouette on a hill beyond the -Z end.
  const stone = toon({ color: 0x8c8a9a });
  const roofM = toon({ color: 0x3a3f5c, roughness: 0.8, flatShading: true });
  const win = toon({ color: 0x2a2a30, emissive: 0xffcf73, emissiveIntensity: 0.0 });
  nightGlow.push({ material: win, day: 0, night: 2.5 });
  const castle = new Group();
  const hill = new Mesh(new SphereGeometry(110, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mountainMat);
  hill.scale.set(1.4, 0.35, 1);
  castle.add(hill);
  const parts: [number, number, number, number, number][] = [
    [0, 52, 0, 34, 26],
    [-30, 44, 6, 14, 40],
    [28, 48, -4, 12, 48],
    [-8, 64, -12, 10, 60],
    [14, 40, 14, 20, 22],
  ];
  for (const [x, h, z, w, extra] of parts) {
    const tower = new Mesh(new BoxGeometry(w, h + extra * 0.4, w * 0.8), stone);
    tower.position.set(x, 30 + (h + extra * 0.4) / 2, z);
    castle.add(tower);
    const cone = new Mesh(new ConeGeometry(w * 0.72, extra, 4), roofM);
    cone.position.set(x, 30 + h + extra * 0.4 + extra / 2, z);
    cone.rotation.y = Math.PI / 4;
    castle.add(cone);
    for (let k = 0; k < 3; k++) {
      const wm = new Mesh(new BoxGeometry(1.6, 2.6, 0.4), win);
      wm.position.set(x - w * 0.25 + k * w * 0.25, 30 + h * (0.45 + k * 0.12), z + w * 0.41);
      castle.add(wm);
    }
  }
  castle.position.set(0, -2, -720);
  castle.scale.setScalar(1.4);
  g.add(castle);
  return g;
}


function buildTrees(lowQuality: boolean): Group {
  const g = new Group();
  const count = lowQuality ? 160 : 360;
  const crown = new ConeGeometry(1, 1, 9, 1);
  crown.translate(0, 0.5, 0);
  const trunkGeo = new CylinderGeometry(0.12, 0.16, 1, 6);
  trunkGeo.translate(0, 0.5, 0);
  const leaf = toon({ color: 0xffffff });
  const bark = toon({ color: 0x6b4529 });
  const tiers = [
    { y: 0.25, r: 1, h: 0.55 },
    { y: 0.5, r: 0.78, h: 0.48 },
    { y: 0.72, r: 0.55, h: 0.4 },
  ];
  const crowns = tiers.map(() => new InstancedMesh(crown, leaf, count));
  const trunks = new InstancedMesh(trunkGeo, bark, count);
  const m = new Matrix4();
  const q = new Quaternion();
  const sc = new Vector3();
  const p = new Vector3();
  const c = new Color();
  let sd = 21;
  const rnd = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const greens = ['#3f8a3c', '#4f9a3f', '#2f7a46', '#5a9e3a', '#3b7f52'];
  let n = 0;
  for (let i = 0; i < count * 3 && n < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 1 + rnd();
    const x = Math.cos(ang) * AR.boundsA * (0.82 + dist * 0.9);
    const z = Math.sin(ang) * AR.boundsB * (0.82 + dist * 0.9);
    // Keep clear of the stadium itself.
    if ((x / (AR.fieldA * 1.5)) ** 2 + (z / (AR.fieldB * 1.5)) ** 2 < 1) continue;
    const h = 10 + rnd() * 14;
    const w = h * (0.32 + rnd() * 0.1);
    q.setFromAxisAngle(sc.set(0, 1, 0), rnd() * Math.PI);
    c.set(greens[Math.floor(rnd() * greens.length)]);
    tiers.forEach((t, k) => {
      p.set(x, h * t.y, z);
      sc.set(w * t.r, h * t.h, w * t.r);
      m.compose(p, q, sc);
      crowns[k].setMatrixAt(n, m);
      crowns[k].setColorAt(n, c);
    });
    p.set(x, 0, z);
    sc.set(w * 0.5, h * 0.35, w * 0.5);
    m.compose(p, q, sc);
    trunks.setMatrixAt(n, m);
    n++;
  }
  for (const im of [...crowns, trunks]) {
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

/**
 * A soft mountain: a dense cone whose surface is gently displaced, with the
 * top tinted white as snow through vertex colours.
 */
function makePeak(r: number, h: number, x: number, z: number, mat: MeshToonMaterial, rnd: () => number): Mesh {
  const geo = new ConeGeometry(r, h, 28, 10);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = mat.color.clone();
  const snow = new Color('#f4f6fb');
  const seedA = rnd() * 10;
  const seedB = rnd() * 10;
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.min(1, Math.max(0, (v.y + h / 2) / h)); // 0 bottom .. 1 top
    const ang = Math.atan2(v.z, v.x);
    const wobble = 1 + 0.13 * Math.sin(ang * 3 + seedA) + 0.07 * Math.sin(ang * 7 + seedB) + 0.05 * Math.sin(t * 9 + ang * 2);
    const rr = Math.hypot(v.x, v.z) * wobble;
    v.x = Math.cos(ang) * rr;
    v.z = Math.sin(ang) * rr;
    // Slightly rounder shoulders instead of a perfectly straight cone.
    v.y = (t * (1 + 0.18 * (1 - t)) / 1.0 - 0.5) * h;
    pos.setXYZ(i, v.x, v.y, v.z);
    const snowLine = 0.72 + 0.06 * Math.sin(ang * 5 + seedA);
    const c = t > snowLine ? snow : base;
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const m = mat.clone();
  m.color.set(0xffffff);
  m.vertexColors = true;
  const mesh = new Mesh(geo, m);
  mesh.position.set(x, h / 2 - 4, z);
  mesh.rotation.y = rnd() * Math.PI;
  return mesh;
}
