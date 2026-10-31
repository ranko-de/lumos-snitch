import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshToonMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  Color,
  MeshStandardMaterial,
  PlaneGeometry,
  OctahedronGeometry,
} from 'three';
import { addOutlines, toon } from './toon';

/** Shared clock for cloth animation (capes, beards). Updated by the renderer. */
export const clothTime = { value: 0 };

/** Local axes for all characters: forward = -Z, up = +Y. */

const skinMat = toon({ color: 0xf1c7a3, roughness: 0.7 });
const woodMat = toon({ color: 0x8b5a2b, roughness: 0.55 });
const twigMat = toon({ color: 0xc8a160, roughness: 0.9, flatShading: true });
const twigOuterMat = toon({ color: 0xc8a160, roughness: 0.9, flatShading: true, side: DoubleSide });
const twigDarkMat = toon({ color: 0x9c7a42, roughness: 0.9, flatShading: true });
const brassMat = toon({ color: 0xd9a63e, metalness: 0.7, roughness: 0.35 });
const eyeMat = toon({ color: 0x1d1426 });
const cheekMat = toon({ color: 0xf09a8e });
const eyeGeo = new OctahedronGeometry(0.028, 1);

/** Two eyes, cheeks and a small smile on a head of the given radius (facing -Z). */
function addFace(parent: Group, x: number, y: number, z: number, r: number): void {
  for (const side of [-1, 1]) {
    const eye = mesh(eyeGeo, eyeMat, x + side * r * 0.36, y + r * 0.12, z - r * 0.9);
    eye.scale.set(1, 1.35, 0.7);
    eye.userData.noOutline = true;
    parent.add(eye);
    const cheek = mesh(eyeGeo, cheekMat, x + side * r * 0.55, y - r * 0.22, z - r * 0.78);
    cheek.scale.set(1.4, 0.8, 0.5);
    cheek.userData.noOutline = true;
    parent.add(cheek);
  }
}

/** A cloth panel that flutters in the wind (vertex animation, no CPU cost). */
function makeCape(width: number, length: number, mat: MeshToonMaterial, strength = 1): Mesh {
  const geo = new PlaneGeometry(width, length, 4, 8);
  geo.translate(0, -length / 2, 0);
  const m = mat.clone();
  m.side = DoubleSide;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uClothTime = clothTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uClothTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         float k = clamp(-position.y / ${length.toFixed(2)}, 0.0, 1.0);
         transformed.z += k * k * ${(0.9 * strength).toFixed(2)} + sin(uClothTime * 11.0 + position.y * 7.0 + position.x * 3.0) * 0.09 * k * ${strength.toFixed(2)};
         transformed.x += sin(uClothTime * 7.0 + position.y * 5.0) * 0.04 * k;`,
      );
  };
  m.customProgramCacheKey = () => `cape-${length}-${strength}`;
  const c = new Mesh(geo, m);
  c.userData.noOutline = true;
  return c;
}

function mesh(geo: ConstructorParameters<typeof Mesh>[0], mat: MeshToonMaterial, x = 0, y = 0, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

export function createBroom(): Group {
  const g = new Group();
  const handle = mesh(new CylinderGeometry(0.045, 0.06, 2.7, 10), woodMat, 0, 0, -0.15);
  handle.rotation.x = Math.PI / 2;
  g.add(handle);
  const tip = mesh(new SphereGeometry(0.07, 10, 8), woodMat, 0, 0, -1.5);
  g.add(tip);
  const band = mesh(new TorusGeometry(0.075, 0.025, 8, 16), brassMat, 0, 0, 1.2);
  g.add(band);
  // Bristles: an outer and inner cone plus some loose twigs.
  const outer = mesh(new ConeGeometry(0.32, 1.1, 14, 1, true), twigOuterMat, 0, 0, 1.72);
  outer.rotation.x = -Math.PI / 2;
  g.add(outer);
  const inner = mesh(new ConeGeometry(0.22, 1.0, 10), twigDarkMat, 0, 0, 1.68);
  inner.rotation.x = -Math.PI / 2;
  g.add(inner);
  const twigGeo = new CylinderGeometry(0.012, 0.016, 1.1, 4);
  twigGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const spoke = new Group();
    spoke.position.z = 1.72;
    spoke.rotation.z = (i / 12) * Math.PI * 2;
    const t = mesh(twigGeo, i % 2 ? twigMat : twigDarkMat, 0, 0.19, 0);
    // Splay the back end of each twig slightly outward.
    t.rotation.x = -0.2;
    spoke.add(t);
    g.add(spoke);
  }
  // Foot rests.
  const rest = mesh(new BoxGeometry(0.7, 0.04, 0.08), brassMat, 0, -0.06, 0.55);
  g.add(rest);
  return g;
}

export interface RiderParts {
  root: Group;
  /** Rolls with the broom (banking). */
  bank: Group;
  /** Extra wobble for Crazy Broom. */
  wobble: Group;
  /** Rider body lean. */
  body: Group;
  rightArm: Group;
  scarfTail: Mesh;
  /** Where a passenger sits (child slot on the wobble group). */
  passengerSlot: Group;
}

export function createRider(color: number, accent: number): RiderParts {
  const root = new Group();
  const bank = new Group();
  const wobble = new Group();
  root.add(bank);
  bank.add(wobble);
  wobble.add(createBroom());

  const robe = toon({ color: new Color(color).multiplyScalar(0.55), roughness: 0.8 });
  const robeTrim = toon({ color, roughness: 0.6 });
  const accentMat = toon({ color: accent, roughness: 0.6 });
  const hair = toon({ color: 0x4a2f1c, roughness: 0.9 });

  const body = new Group();
  body.position.set(0, 0.12, 0.1);
  wobble.add(body);

  const torso = mesh(new CylinderGeometry(0.18, 0.25, 0.62, 12), robe, 0, 0.42, -0.02);
  torso.rotation.x = -0.4;
  body.add(torso);
  const skirt = mesh(new ConeGeometry(0.42, 0.62, 12, 1, true), robe, 0, 0.14, 0.12);
  skirt.rotation.x = 0.5;
  (skirt.material as MeshToonMaterial).side = DoubleSide;
  body.add(skirt);
  const sash = mesh(new TorusGeometry(0.21, 0.04, 6, 16), robeTrim, 0, 0.3, 0.02);
  sash.rotation.x = Math.PI / 2 - 0.4;
  body.add(sash);

  const head = mesh(new SphereGeometry(0.17, 16, 12), skinMat, 0, 0.86, -0.2);
  body.add(head);
  const hairCap = mesh(new SphereGeometry(0.18, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, 0, 0.88, -0.17);
  hairCap.rotation.x = 0.35;
  body.add(hairCap);
  addFace(body, 0, 0.86, -0.2, 0.17);
  // Goggles in the player colour make riders easy to tell apart.
  const goggles = mesh(new TorusGeometry(0.175, 0.03, 6, 20), robeTrim, 0, 0.93, -0.19);
  goggles.rotation.x = Math.PI / 2 + 0.35;
  body.add(goggles);

  const scarf = mesh(new TorusGeometry(0.13, 0.05, 8, 16), accentMat, 0, 0.69, -0.12);
  scarf.rotation.x = Math.PI / 2 - 0.3;
  body.add(scarf);
  const scarfTail = mesh(new BoxGeometry(0.1, 0.03, 0.55), robeTrim, 0.08, 0.7, 0.18);
  scarfTail.geometry.translate(0, 0, 0.27);
  scarfTail.position.z = -0.02;
  body.add(scarfTail);

  const armGeo = new CylinderGeometry(0.055, 0.06, 0.5, 8);
  armGeo.translate(0, -0.25, 0);
  const makeArm = (side: number): Group => {
    const a = new Group();
    a.position.set(side * 0.22, 0.62, -0.12);
    a.rotation.x = -1.15;
    a.rotation.z = side * 0.12;
    const upper = new Mesh(armGeo, robe);
    a.add(upper);
    const hand = mesh(new SphereGeometry(0.06, 8, 6), skinMat, 0, -0.52, 0);
    a.add(hand);
    body.add(a);
    return a;
  };
  makeArm(-1);
  const rightArm = makeArm(1);

  const legGeo = new CylinderGeometry(0.07, 0.065, 0.5, 8);
  legGeo.translate(0, -0.25, 0);
  for (const side of [-1, 1]) {
    const leg = new Group();
    leg.position.set(side * 0.13, 0.05, 0.05);
    leg.rotation.x = -1.3;
    leg.rotation.z = side * 0.35;
    leg.add(new Mesh(legGeo, robe));
    const shin = new Group();
    shin.position.set(0, -0.48, 0);
    shin.rotation.x = 1.6;
    shin.add(new Mesh(legGeo, robe));
    const boot = mesh(new BoxGeometry(0.11, 0.08, 0.2), hair, 0, -0.5, -0.05);
    shin.add(boot);
    leg.add(shin);
    body.add(leg);
  }

  // Team cape streaming behind the rider.
  const cape = makeCape(0.46, 0.95, robeTrim, 1);
  cape.position.set(0, 0.7, 0.02);
  cape.rotation.x = 1.15;
  body.add(cape);

  const passengerSlot = new Group();
  passengerSlot.position.set(0, 0.06, 0.95);
  wobble.add(passengerSlot);

  addOutlines(wobble, 0.018);
  return { root, bank, wobble, body, rightArm, scarfTail, passengerSlot };
}

export interface DumbledoreParts {
  root: Group;
  /** Every material of the figure (used to fade him in the caster's own view). */
  materials: MeshToonMaterial[];
  wandArm: Group;
  wandTip: Mesh;
  outlines: Mesh[];
}

export function createDumbledoreFigure(): DumbledoreParts {
  const root = new Group();
  const dSkin = skinMat.clone();
  const robeMat = toon({ color: 0x6b3fa0, roughness: 0.75 });
  const trimMat = toon({ color: 0xe8c55a, metalness: 0.4, roughness: 0.4 });
  const beardMat = toon({ color: 0xf4f4f0, roughness: 0.95, flatShading: true });
  const body = new Group();
  body.scale.setScalar(1.3);
  root.add(body);

  const robe = mesh(new ConeGeometry(0.46, 1.1, 14), robeMat, 0, 0.45, 0.05);
  body.add(robe);
  const hem = mesh(new TorusGeometry(0.4, 0.035, 6, 20), trimMat, 0, 0.0, 0.05);
  hem.rotation.x = Math.PI / 2;
  body.add(hem);
  // Little gold stars on the robe.
  const starGeo = new SphereGeometry(0.035, 6, 4);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.1;
    const y = 0.15 + (i % 3) * 0.22;
    const r = 0.42 - y * 0.32;
    body.add(mesh(starGeo, trimMat, Math.cos(a) * r, y, Math.sin(a) * r + 0.05));
  }
  const head = mesh(new SphereGeometry(0.17, 16, 12), dSkin, 0, 1.08, 0);
  body.add(head);
  const nose = mesh(new ConeGeometry(0.035, 0.12, 6), dSkin, 0, 1.07, -0.18);
  nose.rotation.x = -Math.PI / 2;
  body.add(nose);
  addFace(body, 0, 1.08, 0, 0.17);
  // Half-moon spectacles.
  for (const side of [-1, 1]) {
    const lens = mesh(new TorusGeometry(0.045, 0.008, 4, 12, Math.PI), trimMat, side * 0.06, 1.11, -0.16);
    lens.rotation.z = Math.PI;
    body.add(lens);
  }
  // Long beard and hair.
  const beard = mesh(new ConeGeometry(0.17, 0.95, 10), beardMat, 0, 0.55, -0.12);
  beard.rotation.x = Math.PI + 0.12;
  body.add(beard);
  const hair = mesh(new ConeGeometry(0.2, 0.75, 10), beardMat, 0, 0.82, 0.1);
  hair.rotation.x = Math.PI - 0.15;
  body.add(hair);
  // Tall pointed hat with a bent tip.
  const hat = mesh(new ConeGeometry(0.22, 0.6, 14), robeMat, 0, 1.45, 0.02);
  body.add(hat);
  const hatTip = mesh(new ConeGeometry(0.09, 0.35, 10), robeMat, 0, 1.82, 0.08);
  hatTip.rotation.x = 0.6;
  body.add(hatTip);
  const brim = mesh(new CylinderGeometry(0.34, 0.34, 0.03, 18), robeMat, 0, 1.18, 0.02);
  body.add(brim);
  const hatBand = mesh(new TorusGeometry(0.205, 0.022, 6, 18), trimMat, 0, 1.21, 0.02);
  hatBand.rotation.x = Math.PI / 2;
  body.add(hatBand);

  const armGeo = new CylinderGeometry(0.06, 0.08, 0.5, 8);
  armGeo.translate(0, -0.25, 0);
  const leftArm = new Group();
  leftArm.position.set(-0.2, 0.85, 0);
  leftArm.rotation.set(-0.6, 0, -0.2);
  leftArm.add(new Mesh(armGeo, robeMat));
  body.add(leftArm);

  const wandArm = new Group();
  wandArm.position.set(0.22, 0.85, 0);
  wandArm.rotation.set(-0.5, 0, 0.25);
  wandArm.add(new Mesh(armGeo, robeMat));
  const hand = mesh(new SphereGeometry(0.06, 8, 6), dSkin, 0, -0.5, 0);
  wandArm.add(hand);
  const wand = mesh(new CylinderGeometry(0.012, 0.02, 0.45, 6), toon({ color: 0x5a3b22 }), 0, -0.68, -0.06);
  wand.rotation.x = 0.4;
  wandArm.add(wand);
  const wandTip = mesh(
    new SphereGeometry(0.035, 8, 6),
    toon({ color: 0xe9d6ff, emissive: 0xb27cff, emissiveIntensity: 1.2 }),
    0,
    -0.9,
    -0.15,
  );
  wandArm.add(wandTip);
  body.add(wandArm);

  // A flowing cloak behind him.
  const cloak = makeCape(0.7, 1.0, robeMat, 0.6);
  cloak.position.set(0, 1.0, 0.18);
  cloak.rotation.x = 0.2;
  body.add(cloak);

  addOutlines(body, 0.02);
  const outlines: Mesh[] = [];
  root.traverse((o) => {
    if (o.userData.outline) outlines.push(o as Mesh);
  });
  const materials = new Set<MeshToonMaterial>();
  root.traverse((o) => {
    if (o.userData.outline) return;
    const m = (o as Mesh).material;
    if (m instanceof MeshToonMaterial) materials.add(m);
  });
  // Always "transparent" (opacity 1 normally) so fading never swaps shader programs.
  for (const m of materials) m.transparent = true;
  return { root, wandArm, wandTip, materials: [...materials], outlines };
}

export interface SnitchParts {
  root: Group;
  ball: Mesh;
  ballMaterial: MeshStandardMaterial;
  wingL: Group;
  wingR: Group;
}

export function createSnitchMesh(radius: number): SnitchParts {
  const root = new Group();
  const ballMaterial = new MeshStandardMaterial({
    color: 0xf2c43c,
    metalness: 0.85,
    roughness: 0.28,
    emissive: 0xffc23a,
    emissiveIntensity: 0,
  });
  const ball = new Mesh(new SphereGeometry(radius, 20, 14), ballMaterial);
  root.add(ball);
  const band = new Mesh(new TorusGeometry(radius * 1.01, radius * 0.08, 6, 24), ballMaterial);
  root.add(band);

  const wingShape = new Shape();
  wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.15, 0.12, 0.45, 0.2, 0.7, 0.12);
  wingShape.bezierCurveTo(0.55, 0.05, 0.5, -0.02, 0.62, -0.06);
  wingShape.bezierCurveTo(0.4, -0.06, 0.2, -0.08, 0, -0.02);
  const wingGeo = new ShapeGeometry(wingShape, 8);
  wingGeo.scale(radius * 3.2, radius * 3.2, 1);
  const wingMat = new MeshStandardMaterial({
    color: 0xf7f3e6,
    metalness: 0.3,
    roughness: 0.35,
    side: DoubleSide,
    transparent: true,
    opacity: 0.92,
    emissive: 0xfff2c0,
    emissiveIntensity: 0,
  });
  const makeWing = (side: number): Group => {
    const pivot = new Group();
    pivot.position.set(side * radius * 0.85, radius * 0.25, 0);
    const w = new Mesh(wingGeo, wingMat);
    w.rotation.y = side > 0 ? 0 : Math.PI;
    w.rotation.x = -Math.PI / 2 + 0.2;
    pivot.add(w);
    root.add(pivot);
    return pivot;
  };
  const wingL = makeWing(-1);
  const wingR = makeWing(1);
  root.userData.wingMaterial = wingMat;
  return { root, ball, ballMaterial, wingL, wingR };
}
