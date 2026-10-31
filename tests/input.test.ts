import { describe, expect, it } from 'vitest';
import {
  AdaptiveLight,
  applyDeadzone,
  defaultCalibration,
  lightSeparationOk,
  LightDetector,
  lightThresholds,
  tiltSign,
  tiltToAxes,
} from '../src/input/calibration';
import { CalibrationFlow } from '../src/input/calibrationFlow';
import { MicrobitSource } from '../src/input/microbit';
import { parseRecord, PlayerLink } from '../src/serial/protocol';

const pkt = (s: number, o: { pi?: number; ro?: number; l?: number; b?: number; a?: number } = {}) =>
  parseRecord({ v: 1, p: 1, s, pi: o.pi ?? 0, ro: o.ro ?? 0, l: o.l ?? 150, b: o.b ?? 0, a: o.a ?? 0 })!;

describe('tilt processing', () => {
  it('dead zone removes small jitter and still reaches full scale', () => {
    expect(applyDeadzone(0.05)).toBe(0);
    expect(applyDeadzone(1)).toBeCloseTo(1);
    expect(applyDeadzone(-1)).toBeCloseTo(-1);
  });

  it('uses the calibrated neutral and direction signs', () => {
    const cal = { ...defaultCalibration(), neutralPitch: 10, neutralRoll: -5, rollSign: -1, forwardSign: 1 };
    const neutral = tiltToAxes(10, -5, cal, 1);
    expect(neutral.turn).toBe(0);
    expect(neutral.climb).toBe(0);
    const right = tiltToAxes(10, -40, cal, 1);
    expect(right.turn).toBeGreaterThan(0.9);
    const forward = tiltToAxes(50, -5, cal, 1);
    expect(forward.climb).toBeLessThan(-0.9);
  });

  it('by default, pointing the board up climbs and pointing it down dives', () => {
    const cal = defaultCalibration();
    // Firmware pitch goes negative when the top edge points down.
    expect(tiltToAxes(-40, 0, cal, 1).climb).toBeLessThan(-0.9);
    expect(tiltToAxes(40, 0, cal, 1).climb).toBeGreaterThan(0.9);
  });

  it('calibration rejects a too-small tilt', () => {
    expect(tiltSign(0, 4)).toBeNull();
    expect(tiltSign(0, -25)).toBe(-1);
  });
});

describe('light detection', () => {
  it('requires enough separation between open and covered readings', () => {
    expect(lightSeparationOk(160, 30)).toBe(true);
    expect(lightSeparationOk(40, 32)).toBe(false);
  });

  it('hysteresis + debounce prevent flicker near the threshold', () => {
    const t = lightThresholds({ lightOpen: 160, lightCovered: 20 });
    const det = new LightDetector(t.darkBelow, t.lightAbove, 0.12);
    const mid = (t.darkBelow + t.lightAbove) / 2;
    // Hovering around the middle never toggles.
    for (let k = 0; k < 100; k++) det.update(mid + (k % 2 ? 5 : -5), 1 / 60);
    expect(det.dark).toBe(false);
    // A brief dip shorter than the debounce is ignored.
    for (let k = 0; k < 4; k++) det.update(10, 1 / 60);
    det.update(150, 1 / 60);
    expect(det.dark).toBe(false);
    // Sustained cover switches to dark.
    for (let k = 0; k < 10; k++) det.update(10, 1 / 60);
    expect(det.dark).toBe(true);
  });
});

describe('micro:bit source', () => {
  it('stale data falls back to neutral instead of keeping the last tilt', () => {
    const link = new PlayerLink();
    const cal = { ...defaultCalibration(), rollSign: 1 };
    const src = new MicrobitSource(link, cal);
    link.accept(pkt(1, { ro: 400 }), 0);
    link.accept(pkt(2, { ro: 400 }), 10);
    let c = src.sample(0.5, 20);
    expect(c.turn).toBeGreaterThan(0.5);
    for (let t = 0; t < 30; t++) c = src.sample(0.05, 1000 + t * 50);
    expect(Math.abs(c.turn)).toBeLessThan(0.01);
    expect(src.status(3000)).toBe('lost');
  });

  it('A-press counter is passed through as monotonic presses', () => {
    const link = new PlayerLink();
    const src = new MicrobitSource(link, defaultCalibration());
    link.accept(pkt(1, { a: 7 }), 0);
    link.accept(pkt(2, { a: 8 }), 50);
    expect(src.sample(0.05, 60).boostPresses).toBe(1);
  });
});

describe('calibration flow', () => {
  it('walks through neutral, right, forward, open and covered with A presses', () => {
    const link = new PlayerLink();
    const flow = new CalibrationFlow(link);
    let seq = 0;
    let a = 0;
    let now = 0;
    const feed = (o: { pi?: number; ro?: number; l?: number }, press: boolean, seconds: number) => {
      if (press) a++;
      for (let t = 0; t < seconds; t += 0.05) {
        now += 50;
        link.accept(pkt(++seq, { ...o, a }), now);
        flow.update(now);
      }
    };
    feed({ pi: 0, ro: 0, l: 0 }, false, 0.2); // boot (first light reading 0 is ignored)
    feed({ pi: 50, ro: -20, l: 150 }, true, 1.4);
    expect(flow.step).toBe('right');
    feed({ pi: 50, ro: 280, l: 150 }, true, 1.4);
    expect(flow.step).toBe('forward');
    feed({ pi: -200, ro: -20, l: 150 }, true, 1.4);
    expect(flow.step).toBe('open');
    feed({ pi: 50, ro: -20, l: 160 }, true, 1.4);
    feed({ pi: 50, ro: -20, l: 25 }, true, 1.4);
    expect(flow.step).toBe('done');
    expect(flow.result.rollSign).toBe(1);
    expect(flow.result.forwardSign).toBe(-1);
    expect(flow.result.lightOpen).toBe(160);
    expect(flow.result.lightCovered).toBe(25);
  });

  it('asks for recalibration when light and dark are too similar', () => {
    const link = new PlayerLink();
    const flow = new CalibrationFlow(link);
    Object.assign(flow.result, { lightOpen: 40 });
    flow.step = 'covered';
    let seq = 0;
    let now = 0;
    link.accept(pkt(++seq, { l: 38 }), now);
    link.accept(pkt(++seq, { l: 38, a: 1 }), (now += 50));
    flow.update(now);
    for (let t = 0; t < 1.5; t += 0.05) {
      link.accept(pkt(++seq, { l: 36, a: 1 }), (now += 50));
      flow.update(now);
    }
    expect(flow.step).toBe('failed');
  });
});

describe('no-calibration defaults', () => {
  it('day/night works without calibration in bright and dim rooms', () => {
    for (const open of [180, 40]) {
      const det = new AdaptiveLight();
      for (let k = 0; k < 60; k++) det.update(open + (k % 3) - 1, 1 / 20);
      expect(det.dark).toBe(false);
      // Fully covered: near-total darkness.
      for (let k = 0; k < 10; k++) det.update(2, 1 / 20);
      expect(det.dark).toBe(true);
      // Staying covered for a long time never makes "covered" the new normal.
      for (let k = 0; k < 2000; k++) det.update(2, 1 / 20);
      expect(det.dark).toBe(true);
      for (let k = 0; k < 10; k++) det.update(open, 1 / 20);
      expect(det.dark).toBe(false);
    }
  });

  it('shade is not night: only a really covered sensor switches', () => {
    for (const open of [200, 120, 40]) {
      const det = new AdaptiveLight();
      for (let k = 0; k < 60; k++) det.update(open, 1 / 20);
      // Shade from a hand or body (about a third of the room light) stays day.
      for (const shade of [open * 0.5, Math.max(24, open * 0.3)]) {
        for (let k = 0; k < 100; k++) det.update(Math.round(shade), 1 / 20);
        expect(det.dark).toBe(false);
      }
      // A finger over the LEDs (some light still leaking in) → night.
      for (let k = 0; k < 10; k++) det.update(Math.round(Math.max(8, open * 0.12)), 1 / 20);
      expect(det.dark).toBe(true);
    }
  });

  it('a quick passing shadow does not flip to night', () => {
    const det = new AdaptiveLight();
    for (let k = 0; k < 60; k++) det.update(150, 1 / 20);
    for (let k = 0; k < 2; k++) det.update(1, 1 / 20); // 0.1 s
    det.update(150, 1 / 20);
    expect(det.dark).toBe(false);
  });

  it('stays in day mode when the room is too dark to tell', () => {
    const det = new AdaptiveLight();
    for (let k = 0; k < 100; k++) det.update(k % 2 ? 10 : 1, 1 / 20);
    expect(det.dark).toBe(false);
  });

  it('captures the resting grip during the countdown as the new neutral', () => {
    const link = new PlayerLink();
    const src = new MicrobitSource(link, defaultCalibration());
    src.beginNeutralCapture();
    let now = 0;
    for (let s2 = 1; s2 <= 40; s2++) {
      now += 50;
      link.accept(pkt(s2, { pi: 250, ro: -80 }), now);
      src.sample(0.05, now);
    }
    src.endNeutralCapture();
    expect(src.calibration.neutralPitch).toBeCloseTo(25, 1);
    expect(src.calibration.neutralRoll).toBeCloseTo(-8, 1);
    // Holding that grip now means "fly straight".
    let c = src.sample(0.05, now);
    for (let k = 0; k < 20; k++) {
      now += 50;
      link.accept(pkt(41 + k, { pi: 250, ro: -80 }), now);
      c = src.sample(0.05, now);
    }
    expect(Math.abs(c.turn)).toBeLessThan(0.01);
    expect(Math.abs(c.climb)).toBeLessThan(0.01);
  });

  it('ignores an implausible grip (e.g. the board was lying upside down)', () => {
    const link = new PlayerLink();
    const src = new MicrobitSource(link, defaultCalibration());
    src.beginNeutralCapture();
    for (let s2 = 1; s2 <= 20; s2++) {
      link.accept(pkt(s2, { pi: 800, ro: 0 }), s2 * 50);
      src.sample(0.05, s2 * 50);
    }
    src.endNeutralCapture();
    expect(src.calibration.neutralPitch).toBe(0);
  });
});
