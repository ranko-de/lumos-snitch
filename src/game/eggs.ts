import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { Rng } from '../core/rng';
import { BOOTH } from './arena';
import type { PlayerState } from './player';

const D = CONFIG.dumbledore;
const G = CONFIG.ghosts;

/* ------------------------------------------------------------------ */
/* Easter egg 1: Dumbledore joins your broom and hexes the opponent.   */
/* ------------------------------------------------------------------ */

export type DumbledorePhase = 'idle' | 'notice' | 'fly' | 'ride' | 'projectile' | 'rideAfter' | 'return';

export type DumbledoreEvent =
  | { type: 'dumbledoreTrigger'; caster: 0 | 1 }
  | { type: 'spellCast'; caster: 0 | 1; victim: 0 | 1 }
  | { type: 'spellHit'; victim: 0 | 1 }
  | { type: 'dumbledoreLeave'; at: Vector3 }
  | { type: 'dumbledoreHome' };

export interface DumbledoreState {
  phase: DumbledorePhase;
  phaseTime: number;
  caster: 0 | 1 | -1;
  victim: 0 | 1 | -1;
  usedBy: [boolean, boolean];
  cooldown: number;
  dwell: [number, number];
  discovered: boolean;
  /** World position of the Dumbledore figure (render uses this). */
  pos: Vector3;
  /** Heading of the figure (yaw), follows the broom while riding. */
  yaw: number;
  /** True while he sits on a broom (render parents him to that rider). */
  attached: boolean;
  projectile: Vector3;
  projectileActive: boolean;
  /** Where the figure started its current flight segment. */
  from: Vector3;
}

export function createDumbledore(): DumbledoreState {
  return {
    phase: 'idle',
    phaseTime: 0,
    caster: -1,
    victim: -1,
    usedBy: [false, false],
    cooldown: 0,
    dwell: [0, 0],
    discovered: false,
    pos: BOOTH.seat.clone(),
    yaw: 0,
    attached: false,
    projectile: new Vector3(),
    projectileActive: false,
    from: new Vector3(),
  };
}

export function resetDumbledore(d: DumbledoreState): void {
  d.phase = 'idle';
  d.phaseTime = 0;
  d.caster = -1;
  d.victim = -1;
  d.usedBy[0] = d.usedBy[1] = false;
  d.cooldown = 0;
  d.dwell[0] = d.dwell[1] = 0;
  d.discovered = false;
  d.pos.copy(BOOTH.seat);
  d.yaw = 0;
  d.attached = false;
  d.projectileActive = false;
}

/** Seat behind the rider on the broom. */
export function passengerSeat(p: PlayerState, out: Vector3): Vector3 {
  return out.copy(p.pos).addScaledVector(p.forward, -0.95).add(UP_OFFSET);
}
const UP_OFFSET = new Vector3(0, 0.05, 0);

export function isAvailableFor(d: DumbledoreState, i: 0 | 1, players: readonly PlayerState[]): boolean {
  return (
    d.phase === 'idle' &&
    d.cooldown <= 0 &&
    !d.usedBy[i] &&
    players[0].crazyTime <= 0 &&
    players[1].crazyTime <= 0
  );
}

export function inBalconyZone(p: PlayerState): boolean {
  return p.pos.distanceTo(BOOTH.zoneCenter) < D.zoneRadius;
}

const seat = new Vector3();
const ease = (t: number) => t * t * (3 - 2 * t);

export function stepDumbledore(
  d: DumbledoreState,
  players: readonly PlayerState[],
  dt: number,
  rng: Rng,
  events: DumbledoreEvent[],
): void {
  if (d.cooldown > 0) d.cooldown = Math.max(0, d.cooldown - dt);

  // Time spent inside the pick-up zone in front of the balcony.
  for (const p of players) {
    if (inBalconyZone(p)) d.dwell[p.index] += dt;
    else d.dwell[p.index] = 0;
  }

  if (d.phase === 'idle') {
    const ready: (0 | 1)[] = [];
    for (const p of players) {
      if (d.dwell[p.index] >= D.dwellTime && isAvailableFor(d, p.index, players)) ready.push(p.index);
    }
    if (ready.length > 0) {
      let caster: 0 | 1;
      if (ready.length === 1) caster = ready[0];
      else {
        // Whoever completed the dwell first: larger overshoot = finished earlier.
        const o0 = d.dwell[0] - D.dwellTime;
        const o1 = d.dwell[1] - D.dwellTime;
        if (Math.abs(o0 - o1) < 1e-6) caster = rng.next() < 0.5 ? 0 : 1;
        else caster = o0 > o1 ? 0 : 1;
      }
      d.caster = caster;
      d.victim = caster === 0 ? 1 : 0;
      d.usedBy[caster] = true;
      d.discovered = true;
      d.dwell[0] = d.dwell[1] = 0;
      setPhase(d, 'notice');
      events.push({ type: 'dumbledoreTrigger', caster });
    }
    return;
  }

  d.phaseTime += dt;
  const caster = players[d.caster as 0 | 1];
  const victim = players[d.victim as 0 | 1];
  passengerSeat(caster, seat);

  switch (d.phase) {
    case 'notice':
      d.pos.copy(BOOTH.seat);
      d.pos.y += Math.sin(Math.min(1, d.phaseTime / D.noticeTime) * Math.PI) * 0.6;
      d.yaw = Math.atan2(-(caster.pos.x - d.pos.x), -(caster.pos.z - d.pos.z));
      if (d.phaseTime >= D.noticeTime) {
        d.from.copy(d.pos);
        setPhase(d, 'fly');
      }
      break;
    case 'fly': {
      const t = ease(Math.min(1, d.phaseTime / D.flyTime));
      d.pos.lerpVectors(d.from, seat, t);
      d.pos.y += Math.sin(t * Math.PI) * 3;
      d.yaw = caster.yaw;
      if (d.phaseTime >= D.flyTime) setPhase(d, 'ride');
      break;
    }
    case 'ride':
      d.attached = true;
      d.pos.copy(seat);
      d.yaw = caster.yaw;
      // He rides along until the caster gets close to the opponent.
      if (d.phaseTime >= D.maxRideTime) {
        d.attached = false;
        d.from.copy(d.pos);
        events.push({ type: 'dumbledoreLeave', at: d.pos.clone() });
        setPhase(d, 'return');
      } else if (caster.pos.distanceTo(victim.pos) <= D.castRange) {
        setPhase(d, 'projectile');
        d.projectileActive = true;
        d.from.copy(caster.pos).y += 1.4;
        d.projectile.copy(d.from);
        events.push({ type: 'spellCast', caster: caster.index, victim: victim.index });
      }
      break;
    case 'projectile': {
      d.pos.copy(seat);
      d.yaw = caster.yaw;
      const t = Math.min(1, d.phaseTime / D.projectileTime);
      // Homing bolt with a little arc so it reads as magic.
      d.projectile.lerpVectors(d.from, victim.pos, ease(t));
      d.projectile.y += Math.sin(t * Math.PI) * 4;
      if (t >= 1) {
        d.projectileActive = false;
        victim.crazyTime = D.spellDuration;
        victim.crazyPhase = 0;
        events.push({ type: 'spellHit', victim: victim.index });
        setPhase(d, 'rideAfter');
      }
      break;
    }
    case 'rideAfter':
      d.pos.copy(seat);
      d.yaw = caster.yaw;
      if (d.phaseTime >= D.rideAfterCast) {
        d.attached = false;
        d.from.copy(d.pos);
        events.push({ type: 'dumbledoreLeave', at: d.pos.clone() });
        setPhase(d, 'return');
      }
      break;
    case 'return': {
      const t = ease(Math.min(1, d.phaseTime / D.returnTime));
      d.pos.lerpVectors(d.from, BOOTH.seat, t);
      d.pos.y += Math.sin(t * Math.PI) * 4;
      if (d.phaseTime >= D.returnTime) {
        d.pos.copy(BOOTH.seat);
        d.yaw = 0;
        d.cooldown = D.sharedCooldown;
        events.push({ type: 'dumbledoreHome' });
        setPhase(d, 'idle');
        d.caster = -1;
        d.victim = -1;
      }
      break;
    }
  }
}

function setPhase(d: DumbledoreState, phase: DumbledorePhase): void {
  d.phase = phase;
  d.phaseTime = 0;
  d.attached = phase === 'ride' || phase === 'projectile' || phase === 'rideAfter';
}

/* ------------------------------------------------------------------ */
/* Easter egg 2: both players in the dark → the crowd becomes ghosts.  */
/* ------------------------------------------------------------------ */

export type GhostEvent = { type: 'haunt'; withSound: boolean } | { type: 'unhaunt' };

export interface GhostState {
  overlap: number;
  haunted: boolean;
  releaseTimer: number;
  /** Visual 0..1 blend toward ghost form. */
  blend: number;
  soundCooldown: number;
  messageTimer: number;
}

export function createGhosts(): GhostState {
  return { overlap: 0, haunted: false, releaseTimer: 0, blend: 0, soundCooldown: 0, messageTimer: 0 };
}

export function resetGhosts(g: GhostState): void {
  g.overlap = 0;
  g.haunted = false;
  g.releaseTimer = 0;
  g.blend = 0;
  g.soundCooldown = 0;
  g.messageTimer = 0;
}

export function stepGhosts(g: GhostState, bothDark: boolean, dt: number, events: GhostEvent[]): void {
  if (g.soundCooldown > 0) g.soundCooldown = Math.max(0, g.soundCooldown - dt);
  if (g.messageTimer > 0) g.messageTimer = Math.max(0, g.messageTimer - dt);

  if (bothDark) {
    g.overlap += dt;
    g.releaseTimer = 0;
    if (!g.haunted && g.overlap >= G.requiredOverlap) {
      g.haunted = true;
      const withSound = g.soundCooldown <= 0;
      if (withSound) {
        g.soundCooldown = G.soundCooldown;
        g.messageTimer = G.messageTime;
      }
      events.push({ type: 'haunt', withSound });
    }
  } else {
    g.overlap = 0;
    if (g.haunted) {
      g.releaseTimer += dt;
      if (g.releaseTimer >= G.releaseDelay) {
        g.haunted = false;
        g.releaseTimer = 0;
        events.push({ type: 'unhaunt' });
      }
    }
  }

  const target = g.haunted ? 1 : 0;
  const rate = dt / G.fade;
  g.blend = target > g.blend ? Math.min(1, g.blend + rate) : Math.max(0, g.blend - rate);
}
