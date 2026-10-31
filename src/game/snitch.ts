import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Rng } from '../core/rng';
import { BOOTH, POSTS, RINGS, ellipseRadius, resolveCollisions, type CollisionResult } from './arena';

const S = CONFIG.snitch;
const AR = CONFIG.arena;

export type SnitchMode = 'cruise' | 'hover' | 'dart' | 'tired';

export interface SnitchState {
  pos: Vector3;
  dir: Vector3;
  speed: number;
  mode: SnitchMode;
  modeTimer: number;
  target: Vector3;
  stamina: number;
  visible: boolean;
  /** Seconds until respawn while hidden. */
  hiddenTimer: number;
  /** 0..1 appear (visible) or vanish (hidden) animation progress. */
  anim: number;
  wingPhase: number;
  /** Ring buffer of recent positions (x,y,z triples), newest at trailHead. */
  trail: Float32Array;
  trailHead: number;
  trailCount: number;
  trailTick: number;
  /** Practice mode: hovers slowly in a small area. */
  practice: boolean;
}

export function createSnitch(): SnitchState {
  return {
    pos: new Vector3(0, 12, 0),
    dir: new Vector3(1, 0, 0),
    speed: S.cruiseSpeed,
    mode: 'cruise',
    modeTimer: 2,
    target: new Vector3(0, 12, 0),
    stamina: S.evadeStamina,
    visible: true,
    hiddenTimer: 0,
    anim: 1,
    wingPhase: 0,
    trail: new Float32Array(S.trailLength * 3),
    trailHead: 0,
    trailCount: 0,
    trailTick: 0,
    practice: false,
  };
}

export function placeSnitch(s: SnitchState, at: Vector3, rng: Rng): void {
  s.pos.copy(at);
  s.dir.set(rng.range(-1, 1), 0, rng.range(-1, 1));
  if (s.dir.lengthSq() < 1e-4) s.dir.set(1, 0, 0);
  s.dir.normalize();
  s.speed = S.hoverSpeed;
  s.mode = 'hover';
  s.modeTimer = 1.0;
  s.stamina = S.evadeStamina;
  s.visible = true;
  s.hiddenTimer = 0;
  s.anim = 0;
  s.trailCount = 0;
  pickWaypoint(s, rng);
}

/** Random legal point inside the pitch volume. */
export function randomFieldPoint(rng: Rng, out: Vector3, fraction = 0.8): Vector3 {
  for (let i = 0; i < 20; i++) {
    const ang = rng.range(0, Math.PI * 2);
    const r = Math.sqrt(rng.next()) * fraction;
    out.set(Math.cos(ang) * AR.fieldA * r, rng.range(S.minY + 2, S.maxY - 6), Math.sin(ang) * AR.fieldB * r);
    if (!nearObstacle(out, 3.5)) return out;
  }
  return out.set(0, 12, 0);
}

function nearObstacle(p: Vector3, margin: number): boolean {
  for (const c of POSTS) if (p.y < c.top + margin && Math.hypot(p.x - c.x, p.z - c.z) < c.radius + margin) return true;
  for (const r of RINGS) if (p.distanceTo(r.center) < r.radius + margin) return true;
  return false;
}

function pickWaypoint(s: SnitchState, rng: Rng): void {
  if (s.practice) {
    s.target.set(rng.range(-8, 8), rng.range(9, 14), rng.range(-6, 6));
    return;
  }
  const roll = rng.next();
  if (roll < 0.3) {
    // Swing past a hoop, staying on the field side of it.
    const ring = RINGS[Math.floor(rng.next() * RINGS.length)];
    const inward = -Math.sign(ring.center.x);
    s.target.set(
      ring.center.x + inward * rng.range(5, 9),
      ring.center.y + rng.range(-2, 3),
      ring.center.z + rng.range(-5, 5),
    );
  } else if (roll < 0.5) {
    s.target.set(rng.range(-28, 28), rng.range(6, 20), rng.range(-20, 20));
  } else {
    randomFieldPoint(rng, s.target);
  }
}

const desired = new Vector3();
const tmp = new Vector3();
const col: CollisionResult = { hit: false, normal: new Vector3() };

function enterMode(s: SnitchState, rng: Rng): void {
  if (s.practice) {
    s.mode = 'hover';
    s.modeTimer = 2;
    return;
  }
  const r = rng.next();
  if (r < S.dartChance) {
    s.mode = 'dart';
    s.modeTimer = rng.range(0.45, 0.8);
    pickWaypoint(s, rng);
  } else if (r < S.dartChance + S.hoverChance) {
    s.mode = 'hover';
    s.modeTimer = rng.range(0.8, 1.6);
  } else {
    s.mode = 'cruise';
    s.modeTimer = rng.range(2, 4);
  }
}

/**
 * Steering-based flight inside the pitch. `chasers` are the player positions.
 */
export function stepSnitch(s: SnitchState, chasers: readonly Vector3[], dt: number, rng: Rng): void {
  s.wingPhase += dt * 38;
  if (!s.visible) {
    s.anim = Math.min(1, s.anim + dt / 0.4);
    return;
  }
  s.anim = Math.min(1, s.anim + dt / 0.5);

  s.modeTimer -= dt;
  if (s.modeTimer <= 0) {
    if (s.mode === 'tired') s.stamina = S.evadeStamina;
    enterMode(s, rng);
  }
  if (s.pos.distanceTo(s.target) < 3) pickWaypoint(s, rng);

  desired.subVectors(s.target, s.pos).normalize();

  // Evade the nearest chaser, but only while it has stamina left.
  let nearest = Infinity;
  let nearestIdx = -1;
  for (let i = 0; i < chasers.length; i++) {
    const d = chasers[i].distanceTo(s.pos);
    if (d < nearest) {
      nearest = d;
      nearestIdx = i;
    }
  }
  let evading = false;
  if (!s.practice && s.mode !== 'tired' && nearestIdx >= 0 && nearest < S.evadeRadius) {
    evading = true;
    tmp.subVectors(s.pos, chasers[nearestIdx]).normalize();
    desired.addScaledVector(tmp, 1.3);
    s.stamina -= dt;
    if (s.stamina <= 0) {
      s.mode = 'tired';
      s.modeTimer = S.tiredTime;
    }
  } else if (s.mode !== 'tired') {
    s.stamina = Math.min(S.evadeStamina, s.stamina + dt * 0.6);
  }

  // Soft avoidance of hoops, posts and the booth.
  for (const r of RINGS) {
    tmp.subVectors(s.pos, r.center);
    const d = tmp.length();
    if (d < r.radius + 3 && Math.abs(tmp.x) < 2) {
      // Only steer around the rim; the open hoop is fine to pass through.
      const radial = Math.hypot(tmp.y, tmp.z);
      if (Math.abs(radial - r.radius) < 1.2) desired.addScaledVector(tmp.normalize(), 0.8);
    }
  }
  for (const c of POSTS) {
    if (s.pos.y > c.top + 1) continue;
    const dx = s.pos.x - c.x;
    const dz = s.pos.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < 3) {
      desired.x += (dx / (d || 1)) * 1.2;
      desired.z += (dz / (d || 1)) * 1.2;
    }
  }
  if (s.pos.distanceTo(BOOTH.zoneCenter) < 10) desired.z -= 1.2;

  const fieldS = ellipseRadius(s.pos.x, s.pos.z);
  if (fieldS > S.fieldFraction * 0.85) {
    desired.x -= (s.pos.x / AR.fieldA) * 2;
    desired.z -= (s.pos.z / AR.fieldB) * 2;
  }
  if (s.pos.y < S.minY + 2) desired.y += 1.2;
  if (s.pos.y > S.maxY - 3) desired.y -= 1.2;
  desired.normalize();

  const turn = Math.min(1, S.turnRate * dt * (s.mode === 'dart' ? 1.6 : 1));
  s.dir.lerp(desired, turn).normalize();

  let targetSpeed: number = S.cruiseSpeed;
  if (s.practice) targetSpeed = S.hoverSpeed * 1.5;
  else if (s.mode === 'dart') targetSpeed = S.dartSpeed;
  else if (s.mode === 'hover') targetSpeed = S.hoverSpeed;
  else if (s.mode === 'tired') targetSpeed = S.tiredSpeed;
  if (evading) targetSpeed += S.evadeBoost;
  s.speed += (targetSpeed - s.speed) * (1 - Math.exp(-3 * dt));

  s.pos.addScaledVector(s.dir, s.speed * dt);
  // Gentle bob so even hovering looks alive.
  s.pos.y += Math.sin(s.wingPhase * 0.07) * 0.3 * dt;

  // Hard limits: always inside the pitch volume, never in solids.
  const limitS = ellipseRadius(s.pos.x, s.pos.z);
  if (limitS > S.fieldFraction) {
    s.pos.x *= S.fieldFraction / limitS;
    s.pos.z *= S.fieldFraction / limitS;
  }
  s.pos.y = Math.max(S.minY, Math.min(S.maxY, s.pos.y));
  tmp.set(0, 0, 0);
  resolveCollisions(s.pos, tmp, 0.35, col);

  s.trailTick += dt;
  if (s.trailTick >= 1 / 40) {
    s.trailTick = 0;
    s.trailHead = (s.trailHead + 1) % S.trailLength;
    s.trail[s.trailHead * 3] = s.pos.x;
    s.trail[s.trailHead * 3 + 1] = s.pos.y;
    s.trail[s.trailHead * 3 + 2] = s.pos.z;
    s.trailCount = Math.min(S.trailLength, s.trailCount + 1);
  }
}

/** Makes the snitch dart away (used when two simultaneous catches tie). */
export function snitchEscape(s: SnitchState, rng: Rng): void {
  s.mode = 'dart';
  s.modeTimer = 0.9;
  s.stamina = S.evadeStamina;
  pickWaypoint(s, rng);
  s.dir.subVectors(s.target, s.pos).normalize();
  s.speed = S.dartSpeed;
}

export function hideSnitch(s: SnitchState, delay: number): void {
  s.visible = false;
  s.hiddenTimer = delay;
  s.anim = 0;
  s.trailCount = 0;
}

/**
 * Picks a respawn point that is not close to any player and roughly fair
 * between them.
 */
export function chooseRespawn(players: readonly Vector3[], rng: Rng, out: Vector3): Vector3 {
  const cand = new Vector3();
  let bestScore = -Infinity;
  for (let i = 0; i < CONFIG.match.respawnCandidates; i++) {
    randomFieldPoint(rng, cand, 0.75);
    let minD = Infinity;
    let maxD = 0;
    for (const p of players) {
      const d = p.distanceTo(cand);
      minD = Math.min(minD, d);
      maxD = Math.max(maxD, d);
    }
    const far = Math.min(minD, CONFIG.match.respawnMinDistance * 1.6);
    const score = far - 0.6 * (maxD - minD) + (minD >= CONFIG.match.respawnMinDistance ? 100 : 0);
    if (score > bestScore) {
      bestScore = score;
      out.copy(cand);
    }
  }
  return out;
}
