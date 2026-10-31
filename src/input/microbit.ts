import { CONFIG } from '../config';
import type { PlayerLink } from '../serial/protocol';
import { AdaptiveLight, tiltToAxes, type Calibration } from './calibration';
import type { InputSource, PlayerCommand, SourceStatus } from './types';

const I = CONFIG.input;

/** micro:bit controller adapter: tilt → axes, light → day/night, A → catch. */
export class MicrobitSource implements InputSource {
  readonly kind = 'microbit' as const;
  private turn = 0;
  private climb = 0;
  private readonly light = new AdaptiveLight();
  private capturing = false;
  private capPitch = 0;
  private capRoll = 0;
  private capCount = 0;
  private lastSeq = -1;
  private readonly cmd: PlayerCommand = { turn: 0, climb: 0, brake: false, dark: false, boostPresses: 0 };

  constructor(
    private readonly link: PlayerLink,
    private cal: Calibration,
  ) {}

  setCalibration(cal: Calibration): void {
    this.cal = cal;
  }

  /**
   * Automatic "neutral" grip: averages the tilt while the player waits
   * (the countdown), so no calibration screen is needed.
   */
  beginNeutralCapture(): void {
    this.capturing = true;
    this.capPitch = 0;
    this.capRoll = 0;
    this.capCount = 0;
  }

  /** Applies the captured grip if it looks like a sensible resting pose. */
  endNeutralCapture(): void {
    this.capturing = false;
    if (this.capCount < 5) return;
    const p = this.capPitch / this.capCount;
    const r = this.capRoll / this.capCount;
    if (Math.abs(p) <= 40 && Math.abs(r) <= 30) {
      this.cal = { ...this.cal, neutralPitch: p, neutralRoll: r };
    }
  }

  get calibration(): Calibration {
    return this.cal;
  }

  sample(dt: number, nowMs: number): PlayerCommand {
    const pkt = this.link.latest;
    const fresh = pkt !== null && this.link.ageMs(nowMs) < I.staleAfter * 1000;
    let tTurn = 0;
    let tClimb = 0;
    if (fresh && pkt) {
      if (this.capturing && pkt.seq !== this.lastSeq) {
        this.capPitch += pkt.pitch;
        this.capRoll += pkt.roll;
        this.capCount++;
      }
      this.lastSeq = pkt.seq;
      const axes = tiltToAxes(pkt.pitch, pkt.roll, this.cal, 1);
      tTurn = axes.turn;
      tClimb = axes.climb;
      // The very first light reading after boot can be 0 — ignore it.
      if (this.link.packetsSinceBoot > 1) this.light.update(pkt.light, dt);
    } else {
      // Never keep using the last tilt forever: fall back to neutral.
      this.light.reset();
    }
    const a = 1 - Math.exp(-dt / I.tiltSmoothing);
    this.turn += (tTurn - this.turn) * a;
    this.climb += (tClimb - this.climb) * a;

    this.cmd.turn = this.turn;
    this.cmd.climb = this.climb;
    this.cmd.brake = fresh && !!pkt?.buttonB;
    this.cmd.dark = fresh && this.light.dark;
    this.cmd.boostPresses = this.link.aTotal;
    return this.cmd;
  }

  status(nowMs: number): SourceStatus {
    if (!this.link.latest) return 'lost';
    const age = this.link.ageMs(nowMs);
    if (age > I.disconnectAfter * 1000) return 'lost';
    if (age > I.staleAfter * 1000) return 'stale';
    const rssi = this.link.latest.rssi;
    if (rssi !== null && rssi < -88) return 'weak';
    return 'ok';
  }

  reset(): void {
    this.turn = 0;
    this.climb = 0;
    this.light.reset();
  }

  dispose(): void {
    /* nothing owned */
  }
}
