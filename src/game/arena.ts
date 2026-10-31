import { Vector3 } from 'three';
import { CONFIG } from '../config';

/**
 * Pure description of the stadium's solid shapes, shared by flight, snitch,
 * catch line-of-sight and the renderer. No three.js scene objects here.
 */

const AR = CONFIG.arena;

export interface Ring {
  center: Vector3;
  radius: number;
  tube: number;
  /** Rings face along X: the hoop lies in the YZ plane. */
  postTop: number;
}

export interface Cylinder {
  x: number;
  z: number;
  radius: number;
  top: number;
}

export interface Box {
  min: Vector3;
  max: Vector3;
}

export const RINGS: Ring[] = [];
for (const side of [-1, 1]) {
  for (let i = 0; i < 3; i++) {
    const c = new Vector3(side * AR.ringX, AR.ringHeights[i], AR.ringOffsetsZ[i]);
    RINGS.push({ center: c, radius: AR.ringRadii[i], tube: AR.ringTube, postTop: c.y - AR.ringRadii[i] - AR.ringTube });
  }
}

export const POSTS: Cylinder[] = RINGS.map((r) => ({ x: r.center.x, z: r.center.z, radius: AR.postRadius, top: r.postTop }));

export const TOWERS: Cylinder[] = [];
for (let i = 0; i < AR.towerCount; i++) {
  const ang = (i + 0.5) * ((Math.PI * 2) / AR.towerCount);
  const s = AR.standsOuter + 0.06;
  TOWERS.push({
    x: Math.cos(ang) * AR.fieldA * s,
    z: Math.sin(ang) * AR.fieldB * s,
    radius: AR.towerRadius,
    top: AR.towerHeight + 6,
  });
}

/** Commentator / judges' booth on the +Z stand. */
export const BOOTH = {
  /** Solid body (players bump into it). */
  body: { min: new Vector3(-6.5, 0, AR.fieldB + 4.6), max: new Vector3(6.5, 23, AR.fieldB + 13.5) } as Box,
  /** Floor level of the balcony where Dumbledore sits. */
  floorY: 13.2,
  seat: new Vector3(0, 13.9, AR.fieldB + 6.2),
  /** Hover zone in front of the balcony that triggers the easter egg. */
  zoneCenter: new Vector3(0, 15.5, AR.fieldB + 0.2),
};

export const BOXES: Box[] = [BOOTH.body];

/** Normalised ellipse radius: 1 at the inner edge of the stands. */
export function ellipseRadius(x: number, z: number, a: number = AR.fieldA, b: number = AR.fieldB): number {
  return Math.sqrt((x / a) * (x / a) + (z / b) * (z / b));
}

/** Height of solid "ground" (grass, stands, rim wall) at a horizontal point. */
export function groundHeight(x: number, z: number): number {
  const s = ellipseRadius(x, z);
  if (s < 1) return 0;
  if (s < AR.standsOuter) return AR.standsLow + ((s - 1) / (AR.standsOuter - 1)) * (AR.standsHigh - AR.standsLow);
  if (s < AR.standsOuter + 0.025) return AR.standsRim;
  return 0;
}

const tmp = new Vector3();
const tmp2 = new Vector3();

export interface CollisionResult {
  hit: boolean;
  normal: Vector3;
  /** True when the hit was the seating area of the stands (where the crowd sits). */
  stands?: boolean;
}

/** True where spectators sit (stands, excluding the booth gap). */
export function inCrowdArea(x: number, z: number): boolean {
  const s = ellipseRadius(x, z);
  if (s < 1 || s > AR.standsOuter) return false;
  if (z > AR.fieldB * 0.7 && Math.abs(x) < 9) return false;
  return true;
}

/** A seat on the stands near (x, z), facing the pitch. */
export function crowdSeat(x: number, z: number, out: Vector3): { yaw: number } {
  const s = ellipseRadius(x, z) || 1;
  const target = Math.min(AR.standsOuter - 0.04, Math.max(1.05, s));
  out.set((x / s) * target, 0, (z / s) * target);
  out.y = groundHeight(out.x, out.z) + 0.9;
  const dx = -out.x / (AR.fieldA * AR.fieldA);
  const dz = -out.z / (AR.fieldB * AR.fieldB);
  return { yaw: Math.atan2(-dx, -dz) };
}

/** Point just in front of the stands (over the pitch edge) to take off again. */
export function standsExit(x: number, z: number, out: Vector3): Vector3 {
  const s = ellipseRadius(x, z) || 1;
  out.set((x / s) * 0.93, 0, (z / s) * 0.93);
  out.y = Math.max(groundHeight(x, z) + 3, 8);
  return out;
}

/**
 * Pushes a sphere (position p, radius r) out of all solids.
 * Modifies p and removes the velocity component that points into the surface.
 */
export function resolveCollisions(p: Vector3, vel: Vector3, r: number, out: CollisionResult): CollisionResult {
  out.hit = false;
  out.stands = false;
  out.normal.set(0, 0, 0);

  // Ground / stands heightfield.
  const g = groundHeight(p.x, p.z);
  const pen = g + r - p.y;
  if (pen > 0) {
    out.hit = true;
    if (inCrowdArea(p.x, p.z)) out.stands = true;
    if (pen > 1.4) {
      // A tall step (stand front / rim wall): push sideways toward the lower side.
      const len = Math.hypot(p.x, p.z) || 1;
      const rx = p.x / len;
      const rz = p.z / len;
      const step = 0.6;
      const inner = groundHeight(p.x - rx * step, p.z - rz * step);
      const outer = groundHeight(p.x + rx * step, p.z + rz * step);
      const dir = inner < outer ? -1 : 1;
      p.x += rx * dir * 0.35;
      p.z += rz * dir * 0.35;
      tmp.set(rx * dir, 0, rz * dir);
    } else {
      p.y = g + r;
      tmp.set(0, 1, 0);
    }
    removeInto(vel, tmp);
    out.normal.add(tmp);
  }

  for (const c of POSTS) cylinderPush(p, vel, r, c, out);
  for (const c of TOWERS) cylinderPush(p, vel, r, c, out);
  for (const ring of RINGS) ringPush(p, vel, r, ring, out);
  for (const b of BOXES) boxPush(p, vel, r, b, out);

  if (out.hit && out.normal.lengthSq() > 0) out.normal.normalize();
  return out;
}

function removeInto(vel: Vector3, n: Vector3): void {
  const d = vel.dot(n);
  if (d < 0) vel.addScaledVector(n, -d);
}

function cylinderPush(p: Vector3, vel: Vector3, r: number, c: Cylinder, out: CollisionResult): void {
  if (p.y > c.top + r) return;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const d = Math.hypot(dx, dz);
  const min = c.radius + r;
  if (d >= min) return;
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  p.x = c.x + nx * min;
  p.z = c.z + nz * min;
  tmp.set(nx, 0, nz);
  removeInto(vel, tmp);
  out.normal.add(tmp);
  out.hit = true;
}

function ringPush(p: Vector3, vel: Vector3, r: number, ring: Ring, out: CollisionResult): void {
  const ax = p.x - ring.center.x;
  if (Math.abs(ax) > ring.tube + r) return;
  const qy = p.y - ring.center.y;
  const qz = p.z - ring.center.z;
  const ql = Math.hypot(qy, qz);
  if (Math.abs(ql - ring.radius) > ring.tube + r) return;
  const cy = ql > 1e-6 ? (qy / ql) * ring.radius : ring.radius;
  const cz = ql > 1e-6 ? (qz / ql) * ring.radius : 0;
  tmp.set(ax, qy - cy, qz - cz);
  const d = tmp.length();
  const min = ring.tube + r;
  if (d >= min) return;
  if (d < 1e-6) tmp.set(1, 0, 0);
  else tmp.multiplyScalar(1 / d);
  p.set(ring.center.x, ring.center.y + cy, ring.center.z + cz).addScaledVector(tmp, min);
  removeInto(vel, tmp);
  out.normal.add(tmp);
  out.hit = true;
}

function boxPush(p: Vector3, vel: Vector3, r: number, b: Box, out: CollisionResult): void {
  tmp2.set(
    Math.max(b.min.x, Math.min(p.x, b.max.x)),
    Math.max(b.min.y, Math.min(p.y, b.max.y)),
    Math.max(b.min.z, Math.min(p.z, b.max.z)),
  );
  tmp.subVectors(p, tmp2);
  const d = tmp.length();
  if (d >= r) return;
  if (d < 1e-6) {
    // Centre inside the box: push out through the nearest face.
    const faces = [p.x - b.min.x, b.max.x - p.x, p.y - b.min.y, b.max.y - p.y, p.z - b.min.z, b.max.z - p.z];
    let k = 0;
    for (let i = 1; i < 6; i++) if (faces[i] < faces[k]) k = i;
    const axis = k >> 1;
    const sign = k % 2 === 0 ? -1 : 1;
    tmp.set(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
    p.addScaledVector(tmp, faces[k] + r);
  } else {
    tmp.multiplyScalar(1 / d);
    p.addScaledVector(tmp, r - d);
  }
  removeInto(vel, tmp);
  out.normal.add(tmp);
  out.hit = true;
}

/** Keeps a point inside the flight boundary. Returns true when it had to push. */
export function clampToBounds(p: Vector3, vel: Vector3): boolean {
  let pushed = false;
  const s = ellipseRadius(p.x, p.z, AR.boundsA, AR.boundsB);
  if (s > 1) {
    p.x /= s;
    p.z /= s;
    // Outward normal of the ellipse at this point.
    tmp.set(p.x / (AR.boundsA * AR.boundsA), 0, p.z / (AR.boundsB * AR.boundsB)).normalize().negate();
    removeInto(vel, tmp);
    pushed = true;
  }
  if (p.y > AR.ceiling) {
    p.y = AR.ceiling;
    if (vel.y > 0) vel.y = 0;
    pushed = true;
  }
  return pushed;
}

/** How close (0..1) a point is to the flight boundary; 1 = at the edge. */
export function boundaryProximity(p: Vector3): number {
  const s = ellipseRadius(p.x, p.z, AR.boundsA, AR.boundsB);
  const h = p.y / AR.ceiling;
  return Math.max(s, h);
}

/** True when any solid lies on the straight segment a→b (sampled). */
export function segmentBlocked(a: Vector3, b: Vector3): boolean {
  const len = a.distanceTo(b);
  const steps = Math.max(2, Math.ceil(len / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    tmp.lerpVectors(a, b, t);
    if (pointInsideSolid(tmp)) return true;
  }
  return false;
}

export function pointInsideSolid(p: Vector3): boolean {
  if (p.y < groundHeight(p.x, p.z)) return true;
  for (const c of POSTS) if (p.y < c.top && Math.hypot(p.x - c.x, p.z - c.z) < c.radius) return true;
  for (const c of TOWERS) if (p.y < c.top && Math.hypot(p.x - c.x, p.z - c.z) < c.radius) return true;
  for (const ring of RINGS) {
    const ax = p.x - ring.center.x;
    const ql = Math.hypot(p.y - ring.center.y, p.z - ring.center.z);
    if (Math.hypot(ax, ql - ring.radius) < ring.tube) return true;
  }
  for (const bx of BOXES) {
    if (p.x > bx.min.x && p.x < bx.max.x && p.y > bx.min.y && p.y < bx.max.y && p.z > bx.min.z && p.z < bx.max.z) return true;
  }
  return false;
}
