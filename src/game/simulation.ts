import { Vector3 } from 'three';
import { CONFIG } from '../config';
import { Rng } from '../core/rng';
import type { PlayerCommand } from '../input/types';
import { RINGS, type Ring } from './arena';
import { checkCatch, resolveCatches, type CatchAttempt, type CatchCheck } from './catch';
import {
  createDumbledore,
  createGhosts,
  createStorm,
  resetStorm,
  stepStorm,
  stormHoop,
  type StormEvent,
  resetDumbledore,
  resetGhosts,
  stepDumbledore,
  stepGhosts,
  type DumbledoreEvent,
  type GhostEvent,
} from './eggs';
import { createPlayer, resetPlayer, stepFlight, tryBoost, type PlayerState } from './player';
import {
  chooseRespawn,
  createSnitch,
  hideSnitch,
  placeSnitch,
  snitchEscape,
  stepSnitch,
  type SnitchState,
} from './snitch';

export type MatchPhase = 'attract' | 'practice' | 'countdown' | 'playing' | 'ended';

export type SimEvent =
  | { type: 'catch'; player: 0 | 1; at: Vector3 }
  | { type: 'practiceCatch'; player: 0 | 1; at: Vector3 }
  | { type: 'boost'; player: 0 | 1 }
  | { type: 'ring'; player: 0 | 1; at: Vector3 }
  | { type: 'tie'; at: Vector3 }
  | { type: 'respawn'; at: Vector3 }
  | { type: 'bump'; player: 0 | 1 }
  | { type: 'hint'; at: Vector3 }
  | { type: 'countdownTick'; value: number }
  | { type: 'go' }
  | { type: 'overtime' }
  | { type: 'matchEnd'; winner: 0 | 1 | -1 }
  | DumbledoreEvent
  | GhostEvent
  | StormEvent;

export interface PracticeProgress {
  left: boolean;
  right: boolean;
  climb: boolean;
  dive: boolean;
  dark: boolean;
  light: boolean;
  boost: boolean;
}

export function practiceDone(p: PracticeProgress): boolean {
  return p.left && p.right && p.climb && p.dive && p.dark && p.light && p.boost;
}

const M = CONFIG.match;

export class Simulation {
  readonly rng = new Rng(1);
  readonly players: [PlayerState, PlayerState] = [createPlayer(0), createPlayer(1)];
  readonly snitch: SnitchState = createSnitch();
  readonly dumbledore = createDumbledore();
  readonly ghosts = createGhosts();
  readonly storm = createStorm();
  readonly events: SimEvent[] = [];
  readonly practice: [PracticeProgress, PracticeProgress] = [freshPractice(), freshPractice()];

  phase: MatchPhase = 'attract';
  timeLeft: number = M.duration;
  countdown = 0;
  overtime = false;
  winner: 0 | 1 | -1 = -1;
  /** Seconds since anybody tried to catch (for the gentle hint). */
  noAttemptTimer = 0;
  /** Total simulated seconds (drives shared animations). */
  clock = 0;
  /** Which players take part (single player = only one is active). */
  readonly active: [boolean, boolean] = [true, true];

  private readonly check: CatchCheck = { ok: false, distance: 0 };
  private readonly successes: CatchAttempt[] = [];
  private chaserPositions: Vector3[] = [this.players[0].pos, this.players[1].pos];
  private readonly eggEvents: (DumbledoreEvent | GhostEvent | StormEvent)[] = [];
  private readonly scratch = new Vector3();
  private readonly prevPos = [new Vector3(), new Vector3()];

  /** Full reset for a new match (also used by Restart). */
  reset(seed = (Math.random() * 2 ** 31) | 0): void {
    this.rng.seed(seed);
    for (const p of this.players) {
      const presses = p.lastBoostPresses;
      resetPlayer(p);
      p.lastBoostPresses = presses;
    }
    this.snitch.practice = false;
    placeSnitch(this.snitch, this.scratch.set(0, 12, 0), this.rng);
    resetDumbledore(this.dumbledore);
    resetGhosts(this.ghosts);
    resetStorm(this.storm);
    this.timeLeft = M.duration;
    this.countdown = 0;
    this.overtime = false;
    this.winner = -1;
    this.noAttemptTimer = 0;
    this.events.length = 0;
    this.practice[0] = freshPractice();
    this.practice[1] = freshPractice();
    // A player who is not playing is parked far below the grounds, out of sight.
    for (const p of this.players) if (!this.active[p.index]) p.pos.set(0, -500, 0);
    // A lone player starts in the middle of the pitch.
    if (this.singlePlayer) {
      const p = this.players[this.soloIndex];
      p.pos.set(-60, 12, 0);
    }
  }

  /** Chooses who plays. Takes effect at the next start*(). */
  setActive(p0: boolean, p1: boolean): void {
    this.active[0] = p0 || !p1;
    this.active[1] = p1;
    this.chaserPositions = this.players.filter((_, i) => this.active[i]).map((p) => p.pos);
  }

  get singlePlayer(): boolean {
    return this.active[0] !== this.active[1];
  }

  /** Practice finished by everyone who is playing. */
  get practiceComplete(): boolean {
    return [0, 1].every((i) => !this.active[i] || practiceDone(this.practice[i]));
  }

  /** Index of the only player in single-player mode. */
  get soloIndex(): 0 | 1 {
    return this.active[1] && !this.active[0] ? 1 : 0;
  }

  /** Keeps press counters in sync when an input source is swapped. */
  syncPresses(i: 0 | 1, presses: number): void {
    this.players[i].lastBoostPresses = presses;
  }

  startAttract(): void {
    this.reset();
    this.phase = 'attract';
  }

  startPractice(): void {
    this.reset();
    this.phase = 'practice';
    this.snitch.practice = true;
    placeSnitch(this.snitch, this.scratch.set(0, 11, 0), this.rng);
  }

  startCountdown(): void {
    this.reset();
    this.phase = 'countdown';
    this.countdown = M.countdown;
    this.events.push({ type: 'countdownTick', value: M.countdown });
  }

  /** One fixed simulation step for the whole shared world. */
  step(dt: number, cmds: readonly [PlayerCommand, PlayerCommand]): void {
    this.clock += dt;
    const [p0, p1] = this.players;

    if (this.phase === 'attract') {
      stepSnitch(this.snitch, [], dt, this.rng);
      return;
    }

    // Day/night is a pure view state but the ghost egg reads it.
    p0.dark = cmds[0].dark;
    p1.dark = cmds[1].dark;

    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      // Swallow presses made during the countdown.
      p0.lastBoostPresses = cmds[0].boostPresses;
      p1.lastBoostPresses = cmds[1].boostPresses;
      for (const p of this.players) p.darkBlend = approachBlend(p.darkBlend, p.dark, dt);
      if (after !== before && after > 0) this.events.push({ type: 'countdownTick', value: after });
      if (this.countdown <= 0) {
        this.phase = 'playing';
        this.events.push({ type: 'go' });
      }
      stepSnitch(this.snitch, [], dt, this.rng);
      return;
    }

    if (this.phase === 'ended') {
      for (let i = 0; i < 2; i++) {
        if (!this.active[i]) continue;
        stepFlight(this.players[i], cmds[i], dt);
        this.players[i].lastBoostPresses = cmds[i].boostPresses;
      }
      return;
    }

    // --- practice / playing ---
    this.handleBoosts(cmds);
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      if (!this.active[i]) continue;
      this.prevPos[i].copy(this.players[i].pos);
      const r = stepFlight(this.players[i], cmds[i], dt);
      if (r.bumped) this.events.push({ type: 'bump', player: i });
      const ring = ringPassed(this.prevPos[i], this.players[i].pos);
      if (ring) {
        this.events.push({ type: 'ring', player: i, at: ring.center.clone() });
        // Easter egg 3: three different hoops summon a rain cloud (needs an opponent).
        if (this.phase === 'playing' && !this.singlePlayer)
          stormHoop(this.storm, i, RINGS.indexOf(ring), this.events as StormEvent[]);
      }
    }

    if (this.phase === 'practice') this.trackPractice(cmds);

    stepSnitch(this.snitch, this.chaserPositions, dt, this.rng);

    // Respawn after a catch.
    if (!this.snitch.visible) {
      this.snitch.hiddenTimer -= dt;
      if (this.snitch.hiddenTimer <= 0) {
        if (this.phase === 'practice') this.scratch.set(this.rng.range(-6, 6), 11, this.rng.range(-6, 6));
        else chooseRespawn(this.chaserPositions, this.rng, this.scratch);
        placeSnitch(this.snitch, this.scratch, this.rng);
        this.events.push({ type: 'respawn', at: this.snitch.pos.clone() });
      }
    }

    this.handleCatches();

    // Easter eggs.
    this.eggEvents.length = 0;
    // Dumbledore needs an opponent to hex, so he only appears in two-player games.
    if (this.phase === 'playing' && !this.singlePlayer)
      stepDumbledore(this.dumbledore, this.players, dt, this.rng, this.eggEvents as DumbledoreEvent[]);
    if (this.phase === 'playing' && !this.singlePlayer)
      stepStorm(this.storm, this.players, dt, this.eggEvents as StormEvent[]);
    const allDark = (!this.active[0] || p0.dark) && (!this.active[1] || p1.dark);
    stepGhosts(this.ghosts, allDark, dt, this.eggEvents as GhostEvent[]);
    for (const e of this.eggEvents) this.events.push(e);

    if (this.phase === 'playing') {
      this.noAttemptTimer += dt;
      if (this.noAttemptTimer >= CONFIG.snitch.hintAfter && this.snitch.visible) {
        this.noAttemptTimer = 0;
        this.events.push({ type: 'hint', at: this.snitch.pos.clone() });
      }
      if (!this.overtime) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) {
          this.timeLeft = 0;
          if (this.singlePlayer) this.end(this.soloIndex);
          else if (p0.score !== p1.score) this.end(p0.score > p1.score ? 0 : 1);
          else {
            this.overtime = true;
            this.events.push({ type: 'overtime' });
          }
        }
      }
    }
  }

  /** Boost button: one press = one boost (holding never repeats). */
  private handleBoosts(cmds: readonly [PlayerCommand, PlayerCommand]): void {
    for (const p of this.players) {
      if (!this.active[p.index]) continue;
      const presses = cmds[p.index].boostPresses;
      const pressed = presses > p.lastBoostPresses;
      p.lastBoostPresses = presses;
      if (!pressed) continue;
      if (this.phase === 'practice') this.practice[p.index].boost = true;
      if (tryBoost(p)) this.events.push({ type: 'boost', player: p.index });
    }
  }

  /** Catching is automatic: whoever gets close enough first catches it. */
  private handleCatches(): void {
    this.successes.length = 0;
    for (const p of this.players) {
      if (!this.active[p.index]) continue;
      catchOrigin(p, this.scratch);
      checkCatch(this.scratch, this.snitch.pos, this.snitch.visible, this.check);
      p.canCatch = this.check.ok;
      if (this.check.ok) this.successes.push({ player: p.index, distance: this.check.distance });
    }

    const res = resolveCatches(this.successes);
    if (res.kind === 'none') return;
    if (res.kind === 'tie') {
      snitchEscape(this.snitch, this.rng);
      this.events.push({ type: 'tie', at: this.snitch.pos.clone() });
      return;
    }

    const winner = this.players[res.winner];
    winner.grabAnim = 0.45;
    const at = this.snitch.pos.clone();
    hideSnitch(this.snitch, this.phase === 'practice' ? 1.2 : M.respawnDelay);
    if (this.phase === 'practice') {
      this.events.push({ type: 'practiceCatch', player: res.winner, at });
      return;
    }
    this.noAttemptTimer = 0;
    winner.score += 1;
    this.events.push({ type: 'catch', player: res.winner, at });
    if (winner.score >= M.catchesToWin || this.overtime) this.end(res.winner);
  }

  private end(winner: 0 | 1 | -1): void {
    this.phase = 'ended';
    this.winner = winner;
    this.events.push({ type: 'matchEnd', winner });
  }

  private trackPractice(cmds: readonly [PlayerCommand, PlayerCommand]): void {
    for (let i = 0; i < 2; i++) {
      if (!this.active[i]) continue;
      const c = cmds[i];
      const pr = this.practice[i];
      if (c.turn < -0.5) pr.left = true;
      if (c.turn > 0.5) pr.right = true;
      if (c.climb > 0.5) pr.climb = true;
      if (c.climb < -0.5) pr.dive = true;
      if (c.dark) pr.dark = true;
      if (pr.dark && !c.dark) pr.light = true;
    }
  }
}

/** Returns the hoop a rider flew through between two positions, if any. */
export function ringPassed(a: Vector3, b: Vector3): Ring | null {
  for (const r of RINGS) {
    const da = a.x - r.center.x;
    const db = b.x - r.center.x;
    if (da * db > 0 || da === db) continue;
    const t = da / (da - db);
    const y = a.y + (b.y - a.y) * t - r.center.y;
    const z = a.z + (b.z - a.z) * t - r.center.z;
    if (Math.hypot(y, z) < r.radius - r.tube) return r;
  }
  return null;
}

/** Where the catch zone starts (rider's raised hand). */
export function catchOrigin(p: PlayerState, out: Vector3): Vector3 {
  return out.copy(p.pos).setY(p.pos.y + CONFIG.catch.originHeight);
}

function freshPractice(): PracticeProgress {
  return { left: false, right: false, climb: false, dive: false, dark: false, light: false, boost: false };
}

function approachBlend(v: number, dark: boolean, dt: number): number {
  const rate = dt / CONFIG.lighting.transition;
  return dark ? Math.min(1, v + rate) : Math.max(0, v - rate);
}
