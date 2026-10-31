import { Vector3 } from 'three';
import { CONFIG } from '../config';
import type { PlayerCommand } from '../input/types';
import { clampToBounds, resolveCollisions, type CollisionResult } from './arena';

const F = CONFIG.flight;

export interface PlayerState {
  index: 0 | 1;
  pos: Vector3;
  vel: Vector3;
  /** Heading: yaw 0 looks toward -Z, positive yaw turns left. */
  yaw: number;
  yawRate: number;
  pitch: number;
  /** Visual roll of broom + rider (radians, + = lean left). */
  bank: number;
  speed: number;
  forward: Vector3;
  right: Vector3;
  score: number;
  /** Logical day/night state (after hysteresis/debounce in the input layer). */
  dark: boolean;
  /** Visual blend 0 = day, 1 = night (0.5 s transition). */
  darkBlend: number;
  /** Seconds until the boost can be used again. */
  boostCooldown: number;
  /** Seconds of boost left (0 = not boosting). */
  boostTime: number;
  /** Last consumed value of PlayerCommand.boostPresses. */
  lastBoostPresses: number;
  /** Seconds left of the reach-out arm animation. */
  grabAnim: number;
  /** True during this step when the snitch is catchable (for the HUD reticle). */
  canCatch: boolean;
  crazyTime: number;
  crazyPhase: number;
  bumpCooldown: number;
  nearBoundary: boolean;
  /** Last input turn value, for rider animation. */
  turnInput: number;
}

export function createPlayer(index: 0 | 1): PlayerState {
  const p: PlayerState = {
    index,
    pos: new Vector3(),
    vel: new Vector3(),
    yaw: 0,
    yawRate: 0,
    pitch: 0,
    bank: 0,
    speed: F.cruiseSpeed * 0.6,
    forward: new Vector3(0, 0, -1),
    right: new Vector3(1, 0, 0),
    score: 0,
    dark: false,
    darkBlend: 0,
    boostCooldown: 0,
    boostTime: 0,
    lastBoostPresses: 0,
    grabAnim: 0,
    canCatch: false,
    crazyTime: 0,
    crazyPhase: 0,
    bumpCooldown: 0,
    nearBoundary: false,
    turnInput: 0,
  };
  resetPlayer(p);
  return p;
}

/** Start positions: one at each end of the pitch, facing the centre. */
export function resetPlayer(p: PlayerState): void {
  const side = p.index === 0 ? -1 : 1;
  p.pos.set(side * 75, 10, 0);
  p.yaw = side * (Math.PI / 2);
  p.yawRate = 0;
  p.pitch = 0;
  p.bank = 0;
  p.speed = F.cruiseSpeed * 0.6;
  updateBasis(p);
  p.vel.copy(p.forward).multiplyScalar(p.speed);
  p.score = 0;
  p.dark = false;
  p.darkBlend = 0;
  p.boostCooldown = 0;
  p.boostTime = 0;
  p.grabAnim = 0;
  p.canCatch = false;
  p.crazyTime = 0;
  p.crazyPhase = 0;
  p.bumpCooldown = 0;
  p.nearBoundary = false;
  p.turnInput = 0;
}

export function updateBasis(p: PlayerState): void {
  const cp = Math.cos(p.pitch);
  p.forward.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  p.right.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
}

const desired = new Vector3();
const crazyOffset = new Vector3();
const col: CollisionResult = { hit: false, normal: new Vector3() };

function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export interface FlightResult {
  bumped: boolean;
}

const result: FlightResult = { bumped: false };

/** Arcade flight step. Frame-rate independent (called with the fixed sim step). */
export function stepFlight(p: PlayerState, cmd: PlayerCommand, dt: number): FlightResult {
  result.bumped = false;
  p.turnInput = cmd.turn;

  const speedNorm = Math.min(1, Math.max(0, (p.speed - F.hoverSpeed) / (F.cruiseSpeed - F.hoverSpeed)));
  // Holding brake trades speed for a much tighter, snappier turn.
  const carve = cmd.brake ? F.brakeTurnBoost : 1;
  const grip = cmd.brake ? F.brakeGrip : 1;
  const targetYawRate = cmd.turn * F.maxYawRate * (1 + F.slowTurnBoost * (1 - speedNorm)) * carve;
  p.yawRate = approach(p.yawRate, targetYawRate, F.yawResponse * grip, dt);
  p.yaw -= p.yawRate * dt;
  if (p.yaw > Math.PI) p.yaw -= Math.PI * 2;
  else if (p.yaw < -Math.PI) p.yaw += Math.PI * 2;

  const targetPitch = Math.max(-1, Math.min(1, cmd.climb)) * F.maxPitch;
  p.pitch = approach(p.pitch, targetPitch, F.pitchResponse, dt);
  p.pitch = Math.max(-F.maxPitch, Math.min(F.maxPitch, p.pitch));

  let targetSpeed: number;
  if (cmd.brake) {
    targetSpeed = Math.max(F.hoverSpeed, F.cruiseSpeed * F.brakeSpeedFactor);
  } else {
    const pitchNorm = p.pitch / F.maxPitch;
    targetSpeed = F.cruiseSpeed + (pitchNorm < 0 ? -pitchNorm * F.diveBonus : -pitchNorm * F.climbPenalty);
    if (p.boostTime > 0) targetSpeed += F.boostSpeed;
  }
  // Night helps you find the snitch but the broom is slower in the dark.
  targetSpeed *= 1 + (F.nightSpeedFactor - 1) * p.darkBlend;
  const speedRate = cmd.brake ? F.brakeDecel : p.boostTime > 0 ? F.accel * 3 : F.accel;
  p.speed = approach(p.speed, targetSpeed, speedRate, dt);

  updateBasis(p);
  desired.copy(p.forward).multiplyScalar(p.speed);
  const k = 1 - Math.exp(-F.velocityResponse * grip * dt);
  p.vel.lerp(desired, k);

  // Crazy Broom: a gentle side-to-side swerve on top of normal control.
  crazyOffset.set(0, 0, 0);
  if (p.crazyTime > 0) {
    p.crazyTime = Math.max(0, p.crazyTime - dt);
    p.crazyPhase += dt * Math.PI * 2 * CONFIG.dumbledore.crazyFrequency;
    const fade = Math.min(1, p.crazyTime / 0.5);
    crazyOffset
      .copy(p.right)
      .multiplyScalar(Math.sin(p.crazyPhase) * CONFIG.dumbledore.crazyAmplitude * fade);
    crazyOffset.y = Math.sin(p.crazyPhase * 2.3) * 0.9 * fade;
  }

  p.pos.addScaledVector(p.vel, dt).addScaledVector(crazyOffset, dt);

  const targetBank = cmd.turn * F.maxBank * (cmd.brake ? F.brakeBank : 0.55 + 0.45 * speedNorm);
  p.bank = approach(p.bank, targetBank, F.bankResponse, dt);

  if (p.bumpCooldown > 0) p.bumpCooldown -= dt;
  resolveCollisions(p.pos, p.vel, F.riderRadius, col);
  if (col.hit) {
    if (p.bumpCooldown <= 0) {
      p.speed *= F.collisionSlowdown;
      p.vel.multiplyScalar(F.collisionSlowdown);
      p.vel.addScaledVector(col.normal, F.collisionPush);
      p.bumpCooldown = 0.35;
      result.bumped = true;
    }
  }
  p.nearBoundary = clampToBounds(p.pos, p.vel);

  if (p.boostCooldown > 0) p.boostCooldown = Math.max(0, p.boostCooldown - dt);
  if (p.boostTime > 0) p.boostTime = Math.max(0, p.boostTime - dt);
  if (p.grabAnim > 0) p.grabAnim = Math.max(0, p.grabAnim - dt);

  // Visual night blend (0.5 s ease) is part of the shared state so both views agree.
  const target = p.dark ? 1 : 0;
  const rate = dt / CONFIG.lighting.transition;
  p.darkBlend = target > p.darkBlend ? Math.min(target, p.darkBlend + rate) : Math.max(target, p.darkBlend - rate);

  return result;
}

/** Starts a speed boost if it is off cooldown. Returns true when it fired. */
export function tryBoost(p: PlayerState): boolean {
  if (p.boostCooldown > 0) return false;
  p.boostTime = F.boostTime;
  p.boostCooldown = F.boostCooldown;
  return true;
}
