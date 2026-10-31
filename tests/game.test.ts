import { Vector3 } from 'three';
import { BOOTH } from '../src/game/arena';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { checkCatch, resolveCatches } from '../src/game/catch';
import { createPlayer, stepFlight, updateBasis } from '../src/game/player';
import { catchOrigin, ringPassed, Simulation, type SimEvent } from '../src/game/simulation';
import type { PlayerCommand } from '../src/input/types';

const STEP = CONFIG.sim.step;

function cmd(over: Partial<PlayerCommand> = {}): PlayerCommand {
  return { turn: 0, climb: 0, brake: false, dark: false, boostPresses: 0, ...over };
}

/** Puts the snitch hovering right in front of a player so a catch is possible. */
function setupCatchable(sim: Simulation, i: 0 | 1, dist = 1.5): void {
  const p = sim.players[i];
  catchOrigin(p, sim.snitch.pos).addScaledVector(p.forward, dist);
  sim.snitch.visible = true;
}

function playing(): Simulation {
  const sim = new Simulation();
  sim.startCountdown();
  const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
  for (let t = 0; t < CONFIG.match.countdown + 0.1; t += STEP) sim.step(STEP, c);
  expect(sim.phase).toBe('playing');
  sim.events.length = 0;
  return sim;
}

/** Freeze snitch movement for deterministic catch tests. */
function freezeSnitch(sim: Simulation): void {
  sim.snitch.practice = true;
  sim.snitch.speed = 0;
}

describe('catch geometry', () => {
  it('catches automatically when close enough in any direction, with a visible snitch', () => {
    const pos = new Vector3(0, 10, 0);
    const out = { ok: false, distance: 0 };
    expect(checkCatch(pos, new Vector3(0, 10, -2), true, out).ok).toBe(true);
    expect(checkCatch(pos, new Vector3(2.5, 10, 1), true, out).ok).toBe(true);
    expect(checkCatch(pos, new Vector3(0, 10, -2), false, out).ok).toBe(false);
    expect(checkCatch(pos, new Vector3(0, 10, -10), true, out).ok).toBe(false);
  });

  it('is blocked by solid obstacles (the grass)', () => {
    const out = { ok: false, distance: 0 };
    const ok = checkCatch(new Vector3(0, 0.9, 0), new Vector3(0, -0.5, -1.5), true, out).ok;
    expect(ok).toBe(false);
  });
});

describe('simultaneous catch resolution', () => {
  it('closest player wins', () => {
    expect(resolveCatches([{ player: 0, distance: 2 }, { player: 1, distance: 1 }])).toEqual({ kind: 'caught', winner: 1 });
    expect(resolveCatches([{ player: 1, distance: 2.5 }, { player: 0, distance: 1.2 }])).toEqual({ kind: 'caught', winner: 0 });
  });
  it('an exact tie lets the snitch escape (no fixed Player 1 priority)', () => {
    expect(resolveCatches([{ player: 0, distance: 1.5 }, { player: 1, distance: 1.52 }])).toEqual({ kind: 'tie' });
  });
});

describe('match flow', () => {
  it('one press gives exactly one boost, holding does not repeat', () => {
    const sim = playing();
    const c: [PlayerCommand, PlayerCommand] = [cmd({ boostPresses: 1 }), cmd()];
    const boosts: SimEvent[] = [];
    for (let t = 0; t < 8; t += STEP) {
      sim.step(STEP, c); // press counter stays at 1 = button held
      boosts.push(...sim.events.filter((e) => e.type === 'boost'));
      sim.events.length = 0;
    }
    expect(boosts).toHaveLength(1);
  });

  it('boost makes the broom faster, then goes on cooldown', () => {
    const sim = playing();
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    for (let t = 0; t < 3; t += STEP) sim.step(STEP, c);
    const cruise = sim.players[0].speed;
    c[0].boostPresses = 1;
    for (let t = 0; t < 1; t += STEP) sim.step(STEP, c);
    expect(sim.players[0].speed).toBeGreaterThan(cruise + 6);
    expect(sim.players[0].boostCooldown).toBeGreaterThan(0);
    // A second press during the cooldown does nothing.
    c[0].boostPresses = 2;
    sim.events.length = 0;
    sim.step(STEP, c);
    expect(sim.events.filter((e) => e.type === 'boost')).toHaveLength(0);
  });

  it('flies slower at night than by day', () => {
    const sim = playing();
    const c: [PlayerCommand, PlayerCommand] = [cmd({ dark: true }), cmd()];
    for (let t = 0; t < 4; t += STEP) sim.step(STEP, c);
    expect(sim.players[0].speed).toBeLessThan(sim.players[1].speed * 0.8);
  });

  it('a successful catch scores once and hides the snitch, which respawns after 3 s away from players', () => {
    const sim = playing();
    freezeSnitch(sim);
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    setupCatchable(sim, 0, 1.2);
    sim.step(STEP, c);
    expect(sim.players[0].score).toBe(1);
    expect(sim.snitch.visible).toBe(false);
    // Staying nearby does not score again.
    for (let t = 0; t < 2.9; t += STEP) sim.step(STEP, c);
    expect(sim.players[0].score).toBe(1);
    expect(sim.snitch.visible).toBe(false);
    for (let t = 0; t < 0.3; t += STEP) sim.step(STEP, c);
    expect(sim.snitch.visible).toBe(true);
    for (const p of sim.players) expect(p.pos.distanceTo(sim.snitch.pos)).toBeGreaterThan(25);
  });

  it('both reach it in the same step: closer player gets the only point', () => {
    const sim = playing();
    freezeSnitch(sim);
    // Place both players facing the same snitch from opposite sides.
    const [a, b] = sim.players;
    a.pos.set(-1.2, 12, 0);
    a.yaw = -Math.PI / 2;
    b.pos.set(2.0, 12, 0);
    b.yaw = Math.PI / 2;
    for (const p of sim.players) {
      p.pitch = 0;
      p.forward.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      p.vel.set(0, 0, 0);
      p.speed = 0;
    }
    sim.snitch.pos.set(0, 12 + CONFIG.catch.originHeight, 0);
    sim.snitch.visible = true;
    // Use brake so they barely move during the step.
    const c: [PlayerCommand, PlayerCommand] = [cmd({ boostPresses: 1, brake: true }), cmd({ boostPresses: 1, brake: true })];
    sim.step(STEP, c);
    expect(a.score + b.score).toBe(1);
    expect(a.score).toBe(1);
  });

  it('first to three wins immediately', () => {
    const sim = playing();
    freezeSnitch(sim);
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    for (let k = 1; k <= 3; k++) {
      sim.snitch.visible = true;
      setupCatchable(sim, 1, 1.2);
      c[1].boostPresses = k;
      sim.step(STEP, c);
    }
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(1);
  });

  it('time-out with a tie goes to overtime, then the next catch wins', () => {
    const sim = playing();
    freezeSnitch(sim);
    sim.timeLeft = STEP / 2;
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    sim.step(STEP, c);
    expect(sim.overtime).toBe(true);
    expect(sim.phase).toBe('playing');
    setupCatchable(sim, 0, 1.2);
    c[0].boostPresses = 1;
    sim.step(STEP, c);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(0);
  });

  it('time-out with different scores ends the match', () => {
    const sim = playing();
    sim.players[1].score = 2;
    sim.players[0].score = 1;
    sim.timeLeft = STEP / 2;
    sim.step(STEP, [cmd(), cmd()]);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(1);
  });

  it('restart resets scores, timer, eggs and positions', () => {
    const sim = playing();
    sim.players[0].score = 2;
    sim.players[1].crazyTime = 3;
    sim.dumbledore.usedBy[0] = true;
    sim.dumbledore.cooldown = 12;
    sim.ghosts.haunted = true;
    sim.ghosts.blend = 1;
    sim.timeLeft = 20;
    sim.overtime = true;
    sim.players[0].pos.set(10, 50, 10);
    sim.startCountdown();
    expect(sim.players[0].score).toBe(0);
    expect(sim.players[1].crazyTime).toBe(0);
    expect(sim.dumbledore.usedBy).toEqual([false, false]);
    expect(sim.dumbledore.cooldown).toBe(0);
    expect(sim.ghosts.haunted).toBe(false);
    expect(sim.ghosts.blend).toBe(0);
    expect(sim.timeLeft).toBe(CONFIG.match.duration);
    expect(sim.overtime).toBe(false);
    expect(sim.players[0].pos.x).toBe(-75);
  });
});

describe('flight', () => {
  it('moves forward by default and stays inside bounds and above ground', () => {
    const sim = playing();
    const c: [PlayerCommand, PlayerCommand] = [cmd({ climb: -1 }), cmd({ turn: 1 })];
    for (let t = 0; t < 20; t += STEP) sim.step(STEP, c);
    for (const p of sim.players) {
      expect(p.pos.y).toBeGreaterThan(0.5);
      expect(Math.abs(p.pitch)).toBeLessThan(CONFIG.flight.maxPitch + 1e-6);
    }
  });

  it('braking (B) slows down only partly', () => {
    const sim = playing();
    const c: [PlayerCommand, PlayerCommand] = [cmd({ brake: true }), cmd()];
    for (let t = 0; t < 3; t += STEP) sim.step(STEP, c);
    const braked = sim.players[0].speed;
    expect(braked).toBeLessThan(CONFIG.flight.cruiseSpeed * 0.7);
    expect(braked).toBeGreaterThan(CONFIG.flight.cruiseSpeed * 0.4);
    expect(sim.players[1].speed).toBeGreaterThan(18);
  });

  it('braking while turning gives a much tighter, faster turn', () => {
    const run = (brake: boolean) => {
      const p = createPlayer(0);
      p.pos.set(0, 20, 0);
      p.speed = CONFIG.flight.cruiseSpeed;
      updateBasis(p);
      p.vel.copy(p.forward).multiplyScalar(p.speed);
      let turned = 0;
      for (let t = 0; t < 1.5; t += STEP) {
        stepFlight(p, cmd({ turn: 1, brake }), STEP);
        turned += p.yawRate * STEP;
      }
      return { turned, radius: p.speed / p.yawRate };
    };
    const normal = run(false);
    const carve = run(true);
    expect(carve.turned).toBeGreaterThan(normal.turned * 1.5);
    expect(carve.radius).toBeLessThan(normal.radius * 0.5);
  });

  it('can fly through the open hoop without being pushed', () => {
    const sim = playing();
    const p = sim.players[1];
    // Line up with the middle hoop on the +X end, flying toward +X.
    p.pos.set(CONFIG.arena.ringX - 6, CONFIG.arena.ringHeights[1], 0);
    p.yaw = -Math.PI / 2;
    p.pitch = 0;
    p.speed = CONFIG.flight.cruiseSpeed;
    p.forward.set(1, 0, 0);
    p.vel.set(CONFIG.flight.cruiseSpeed, 0, 0);
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    let bumped = false;
    for (let t = 0; t < 0.7; t += STEP) {
      sim.step(STEP, c);
      if (sim.events.some((e) => e.type === 'bump' && e.player === 1)) bumped = true;
      sim.events.length = 0;
    }
    expect(p.pos.x).toBeGreaterThan(CONFIG.arena.ringX + 1);
    expect(bumped).toBe(false);
  });

  it('detects flying through a hoop, but not past it', () => {
    const y = CONFIG.arena.ringHeights[1];
    const x = CONFIG.arena.ringX;
    expect(ringPassed(new Vector3(x - 0.5, y, 0), new Vector3(x + 0.5, y, 0))).not.toBeNull();
    expect(ringPassed(new Vector3(x - 0.5, y + 6, 0), new Vector3(x + 0.5, y + 6, 0))).toBeNull();
    expect(ringPassed(new Vector3(x - 3, y, 0), new Vector3(x - 2, y, 0))).toBeNull();
  });

});

describe('single player', () => {
  function solo(): Simulation {
    const sim = new Simulation();
    sim.setActive(true, false);
    sim.startCountdown();
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd()];
    for (let t = 0; t < CONFIG.match.countdown + 0.1; t += STEP) sim.step(STEP, c);
    sim.events.length = 0;
    return sim;
  }

  it('only the active player flies, scores and can win', () => {
    const sim = solo();
    expect(sim.singlePlayer).toBe(true);
    const parked = sim.players[1].pos.clone();
    sim.snitch.practice = true;
    const c: [PlayerCommand, PlayerCommand] = [cmd(), cmd({ boostPresses: 5 })];
    for (let k = 1; k <= 3; k++) {
      sim.snitch.visible = true;
      catchOrigin(sim.players[0], sim.snitch.pos).addScaledVector(sim.players[0].forward, 1.2);
      sim.step(STEP, c);
    }
    expect(sim.players[0].score).toBe(3);
    expect(sim.players[1].pos.equals(parked)).toBe(true);
    expect(sim.phase).toBe('ended');
    expect(sim.winner).toBe(0);
  });

  it('time-out ends the round without overtime', () => {
    const sim = solo();
    sim.timeLeft = STEP / 2;
    sim.step(STEP, [cmd(), cmd()]);
    expect(sim.overtime).toBe(false);
    expect(sim.phase).toBe('ended');
  });

  it('the ghost crowd appears when the one player stays in the dark', () => {
    const sim = solo();
    const c: [PlayerCommand, PlayerCommand] = [cmd({ dark: true }), cmd()];
    for (let t = 0; t < 1.2; t += STEP) sim.step(STEP, c);
    expect(sim.ghosts.haunted).toBe(true);
  });

  it('Dumbledore does not appear without an opponent', () => {
    const sim = solo();
    const p = sim.players[0];
    const c: [PlayerCommand, PlayerCommand] = [cmd({ brake: true }), cmd()];
    for (let t = 0; t < 3; t += STEP) {
      p.pos.copy(BOOTH.zoneCenter);
      sim.step(STEP, c);
    }
    expect(sim.dumbledore.phase).toBe('idle');
  });

  it('a player-2-only game works too (controller 2 alone)', () => {
    const sim = new Simulation();
    sim.setActive(false, true);
    expect(sim.soloIndex).toBe(1);
    sim.startPractice();
    sim.step(STEP, [cmd(), cmd({ turn: 1 })]);
    expect(sim.practice[1].right).toBe(true);
    expect(sim.practice[0].right).toBe(false);
  });

  it('flying through hoops in a two-player match counts toward the rain cloud', () => {
    const sim = playing();
    const p = sim.players[0];
    const r = CONFIG.arena.ringX;
    p.pos.set(r - 3, CONFIG.arena.ringHeights[1], 0);
    p.yaw = -Math.PI / 2;
    p.pitch = 0;
    p.speed = CONFIG.flight.cruiseSpeed;
    p.forward.set(1, 0, 0);
    p.vel.set(CONFIG.flight.cruiseSpeed, 0, 0);
    for (let t = 0; t < 0.5; t += STEP) sim.step(STEP, [cmd(), cmd()]);
    expect(sim.storm.hoops[0].length).toBe(1);
  });

  it('flying into the crowd seats you in the stands for 5 s, then you fly on', () => {
    const sim = playing();
    const p = sim.players[0];
    // Head straight into the long stand on the -Z side.
    p.pos.set(0, 6, -(CONFIG.arena.fieldB - 2));
    p.yaw = 0;
    p.pitch = 0;
    p.speed = CONFIG.flight.cruiseSpeed;
    p.forward.set(0, 0, -1);
    p.vel.set(0, 0, -CONFIG.flight.cruiseSpeed);
    const evs: SimEvent[] = [];
    for (let t = 0; t < 1 && p.seatedTime <= 0; t += STEP) {
      sim.step(STEP, [cmd(), cmd()]);
      evs.push(...sim.events.splice(0));
    }
    expect(p.seatedTime).toBeGreaterThan(4.5);
    expect(evs.some((e) => e.type === 'seated' && e.player === 0)).toBe(true);
    const seat = p.pos.clone();
    // Seated: no flying, no catching, even with the snitch right there.
    sim.snitch.pos.copy(seat).y += CONFIG.catch.originHeight;
    sim.snitch.visible = true;
    for (let t = 0; t < 2; t += STEP) sim.step(STEP, [cmd({ turn: 1, climb: 1 }), cmd()]);
    expect(p.pos.distanceTo(seat)).toBeLessThan(1e-6);
    expect(p.score).toBe(0);
    sim.events.length = 0;
    for (let t = 0; t < CONFIG.crowdPenalty.seatTime - 2 + 0.1; t += STEP) {
      sim.step(STEP, [cmd(), cmd()]);
      evs.push(...sim.events.splice(0));
    }
    expect(p.seatedTime).toBe(0);
    expect(evs.some((e) => e.type === 'unseated')).toBe(true);
    // Back over the pitch edge, flying again.
    expect(p.speed).toBeGreaterThan(5);
    sim.step(STEP, [cmd(), cmd()]);
    expect(p.pos.distanceTo(seat)).toBeGreaterThan(1);
  });

  it('touching the grass or a hoop post is not a crowd penalty', () => {
    const sim = playing();
    const p = sim.players[0];
    p.pos.set(0, 0.5, 0);
    p.pitch = -0.6;
    for (let t = 0; t < 1; t += STEP) sim.step(STEP, [cmd({ climb: -1 }), cmd()]);
    expect(p.seatedTime).toBe(0);
  });
});

