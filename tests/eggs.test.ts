import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Rng } from '../src/core/rng';
import { BOOTH } from '../src/game/arena';
import {
  createDumbledore,
  createGhosts,
  stepDumbledore,
  stepGhosts,
  type DumbledoreEvent,
  type GhostEvent,
} from '../src/game/eggs';
import { createPlayer, type PlayerState } from '../src/game/player';

const STEP = CONFIG.sim.step;
const D = CONFIG.dumbledore;

function hoverAtBalcony(p: PlayerState): void {
  p.pos.copy(BOOTH.zoneCenter);
  p.speed = 18;
}
function farAway(p: PlayerState): void {
  p.pos.set(-100, 10, -40);
  p.speed = 18;
}
/** Puts the victim right next to the caster. */
function nextTo(victim: PlayerState, caster: PlayerState): void {
  victim.pos.copy(caster.pos).x += 10;
}

function run(seconds: number, f: () => void): void {
  for (let t = 0; t < seconds - 1e-9; t += STEP) f();
}

function setup(casterIdx: 0 | 1) {
  const d = createDumbledore();
  const players = [createPlayer(0), createPlayer(1)];
  const caster = players[casterIdx];
  const victim = players[casterIdx === 0 ? 1 : 0];
  const ev: DumbledoreEvent[] = [];
  const rng = new Rng(7);
  const step = () => {
    stepDumbledore(d, players, STEP, rng, ev);
    for (const p of players) p.crazyTime = Math.max(0, p.crazyTime - STEP);
  };
  return { d, players, caster, victim, ev, rng, step };
}

describe('Dumbledore easter egg', () => {
  it('joins when you fly up to the booth (no need to stop)', () => {
    const { d, caster, victim, ev, step } = setup(0);
    hoverAtBalcony(caster);
    farAway(victim);
    run(D.dwellTime - 0.1, step);
    expect(ev).toHaveLength(0);
    run(0.2, step);
    expect(ev.map((e) => e.type)).toEqual(['dumbledoreTrigger']);
    expect(d.caster).toBe(0);
  });

  it('does nothing when you stay away from the booth', () => {
    const { caster, victim, ev, step } = setup(0);
    farAway(caster);
    farAway(victim);
    run(5, step);
    expect(ev).toHaveLength(0);
  });

  it('rides along until you get close to the opponent, hexes them, then flies home', () => {
    const { d, caster, victim, ev, step } = setup(0);
    hoverAtBalcony(caster);
    farAway(victim);
    run(0.5, step);
    caster.pos.set(0, 15, 0); // fly away from the booth with him
    run(D.noticeTime + D.flyTime + 0.2, step);
    expect(d.phase).toBe('ride');
    expect(d.attached).toBe(true);
    // Far from the opponent: no spell yet, even after a while.
    run(6, step);
    expect(ev.filter((e) => e.type === 'spellCast')).toHaveLength(0);
    expect(d.attached).toBe(true);
    // Get close to the opponent.
    nextTo(victim, caster);
    let atHit = -1;
    run(6, () => {
      const before = ev.length;
      step();
      if (atHit < 0 && ev.slice(before).some((e) => e.type === 'spellHit')) atHit = victim.crazyTime;
    });
    expect(ev.map((e) => e.type)).toEqual(['dumbledoreTrigger', 'spellCast', 'spellHit', 'dumbledoreLeave', 'dumbledoreHome']);
    expect(atHit).toBeGreaterThan(D.spellDuration - 2 * STEP);
    expect(caster.crazyTime).toBe(0);
    expect(d.phase).toBe('idle');
    expect(d.pos.distanceTo(BOOTH.seat)).toBeLessThan(0.01);
  });

  it('gives up and flies home if the opponent is never reached', () => {
    const { d, caster, victim, ev, step } = setup(1);
    hoverAtBalcony(caster);
    farAway(victim);
    run(0.5, step);
    caster.pos.set(100, 20, 0);
    run(D.maxRideTime + 5, step);
    expect(ev.filter((e) => e.type === 'spellCast')).toHaveLength(0);
    expect(d.phase).toBe('idle');
  });

  it('once per player, and a shared cooldown after he returns', () => {
    const { d, players, ev, step } = setup(0);
    const [p0, p1] = players;
    hoverAtBalcony(p0);
    farAway(p1);
    run(0.5, step);
    nextTo(p1, p0); // cast quickly
    run(6, step);
    expect(d.phase).toBe('idle');
    expect(d.cooldown).toBeGreaterThan(0);
    // Player 2 tries during the cooldown: nothing.
    farAway(p0);
    hoverAtBalcony(p1);
    run(d.cooldown - 0.5, step);
    expect(ev.filter((e) => e.type === 'dumbledoreTrigger')).toHaveLength(1);
    // After the cooldown Player 2 gets him.
    run(1, step);
    expect(ev.filter((e) => e.type === 'dumbledoreTrigger')).toHaveLength(2);
    expect(d.caster).toBe(1);
    // Player 1 can never trigger him again this match.
    nextTo(p0, p1);
    run(8, step);
    hoverAtBalcony(p0);
    farAway(p1);
    run(D.sharedCooldown + 5, step);
    expect(ev.filter((e) => e.type === 'dumbledoreTrigger')).toHaveLength(2);
  });

  it('an exact tie is decided fairly (not always Player 1)', () => {
    const winners = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const d = createDumbledore();
      const players = [createPlayer(0), createPlayer(1)];
      hoverAtBalcony(players[0]);
      hoverAtBalcony(players[1]);
      const ev: DumbledoreEvent[] = [];
      run(D.dwellTime + 0.1, () => stepDumbledore(d, players, STEP, new Rng(seed), ev));
      expect(ev.filter((e) => e.type === 'dumbledoreTrigger')).toHaveLength(1);
      winners.add(d.caster);
    }
    expect(winners.size).toBe(2);
  });
});

describe('ghost crowd easter egg', () => {
  it('needs one continuous second of both players in the dark', () => {
    const g = createGhosts();
    const ev: GhostEvent[] = [];
    run(0.9, () => stepGhosts(g, true, STEP, ev));
    expect(g.haunted).toBe(false);
    // One player flips to light briefly: the overlap restarts.
    stepGhosts(g, false, STEP, ev);
    run(0.9, () => stepGhosts(g, true, STEP, ev));
    expect(g.haunted).toBe(false);
    run(0.15, () => stepGhosts(g, true, STEP, ev));
    expect(g.haunted).toBe(true);
    expect(ev).toEqual([{ type: 'haunt', withSound: true }]);
  });

  it('stays haunted while both are dark, absorbs sensor flicker, fades back in about a second', () => {
    const g = createGhosts();
    const ev: GhostEvent[] = [];
    run(2, () => stepGhosts(g, true, STEP, ev));
    expect(g.blend).toBeGreaterThan(0.95);
    // 0.1 s flicker of light does not end it.
    run(0.1, () => stepGhosts(g, false, STEP, ev));
    expect(g.haunted).toBe(true);
    run(0.5, () => stepGhosts(g, true, STEP, ev));
    // Real return to light.
    run(0.3, () => stepGhosts(g, false, STEP, ev));
    expect(g.haunted).toBe(false);
    run(1.05, () => stepGhosts(g, false, STEP, ev));
    expect(g.blend).toBe(0);
  });

  it('the "oooooh" sound has a cooldown so toggling does not spam it', () => {
    const g = createGhosts();
    const ev: GhostEvent[] = [];
    for (let k = 0; k < 3; k++) {
      run(1.1, () => stepGhosts(g, true, STEP, ev));
      run(0.4, () => stepGhosts(g, false, STEP, ev));
    }
    const haunts = ev.filter((e) => e.type === 'haunt') as { withSound: boolean }[];
    expect(haunts).toHaveLength(3);
    expect(haunts.filter((h) => h.withSound)).toHaveLength(1);
  });
});
