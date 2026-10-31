import { Vector3 } from 'three';
import { CONFIG } from '../config';
import { segmentBlocked } from './arena';

const C = CONFIG.catch;
const toTarget = new Vector3();

export interface CatchCheck {
  ok: boolean;
  distance: number;
}

/**
 * Catching is automatic: it happens when the snitch is visible, close enough
 * and nothing solid is between rider and snitch.
 */
export function checkCatch(
  pos: Vector3,
  snitchPos: Vector3,
  snitchVisible: boolean,
  out: CatchCheck,
): CatchCheck {
  toTarget.subVectors(snitchPos, pos);
  const d = toTarget.length();
  out.distance = d;
  out.ok = false;
  if (!snitchVisible || d > C.radius) return out;
  if (segmentBlocked(pos, snitchPos)) return out;
  out.ok = true;
  return out;
}

export interface CatchAttempt {
  player: 0 | 1;
  distance: number;
}

export type CatchResolution =
  | { kind: 'none' }
  | { kind: 'caught'; winner: 0 | 1 }
  | { kind: 'tie' };

/**
 * Resolves the successful attempts of one simulation step.
 * Closer player wins; an (almost) exact tie lets the snitch escape both.
 * There is never a fixed priority for Player 1 and never two points.
 */
export function resolveCatches(successes: readonly CatchAttempt[], tolerance: number = C.tieTolerance): CatchResolution {
  if (successes.length === 0) return { kind: 'none' };
  if (successes.length === 1) return { kind: 'caught', winner: successes[0].player };
  const [a, b] = successes;
  if (Math.abs(a.distance - b.distance) <= tolerance) return { kind: 'tie' };
  return { kind: 'caught', winner: a.distance < b.distance ? a.player : b.player };
}

