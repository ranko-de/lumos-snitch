import { CONFIG } from '../config';
import type { PlayerLink } from '../serial/protocol';
import { STRINGS } from '../strings';
import { defaultCalibration, lightSeparationOk, median, tiltSign, type Calibration } from './calibration';

export type CalStep = 'neutral' | 'right' | 'forward' | 'open' | 'covered' | 'done' | 'failed';

const ORDER: CalStep[] = ['neutral', 'right', 'forward', 'open', 'covered', 'done'];

/**
 * Step-by-step calibration for one controller. The player advances each step
 * by pressing A on the controller; values are sampled for a short time.
 */
export class CalibrationFlow {
  step: CalStep = 'neutral';
  sampling = false;
  progress = 0;
  error = '';
  readonly result: Calibration = defaultCalibration();
  private lastA: number;
  private lastSeq = -1;
  private startMs = 0;
  private pitch: number[] = [];
  private roll: number[] = [];
  private light: number[] = [];

  constructor(private readonly link: PlayerLink) {
    this.lastA = link.aTotal;
  }

  get stepIndex(): number {
    return Math.max(0, ORDER.indexOf(this.step));
  }

  get instruction(): string {
    if (this.sampling) return STRINGS.calSampling;
    switch (this.step) {
      case 'neutral':
        return STRINGS.calNeutral;
      case 'right':
        return STRINGS.calRight;
      case 'forward':
        return STRINGS.calForward;
      case 'open':
        return STRINGS.calOpen;
      case 'covered':
        return STRINGS.calCovered;
      case 'done':
        return STRINGS.calDone;
      case 'failed':
        return STRINGS.calLightFail;
    }
  }

  restart(): void {
    this.step = 'neutral';
    this.sampling = false;
    this.progress = 0;
    this.error = '';
    this.lastA = this.link.aTotal;
  }

  update(nowMs: number): void {
    if (this.step === 'done' || this.step === 'failed') {
      this.lastA = this.link.aTotal;
      return;
    }
    const fresh = this.link.latest && this.link.ageMs(nowMs) < 500;
    if (!this.sampling) {
      if (this.link.aTotal > this.lastA) {
        this.lastA = this.link.aTotal;
        if (fresh) this.begin(nowMs);
      }
      return;
    }
    const pkt = this.link.latest;
    if (pkt && pkt.seq !== this.lastSeq) {
      this.lastSeq = pkt.seq;
      this.pitch.push(pkt.pitch);
      this.roll.push(pkt.roll);
      // The first light reading after boot may be 0: skip it.
      if (this.link.packetsSinceBoot > 1) this.light.push(pkt.light);
    }
    // Wall-clock timing: calibration must not depend on the frame rate.
    this.progress = (nowMs - this.startMs) / 1000 / CONFIG.input.calibrationSampleTime;
    if (this.progress >= 1) this.finishStep();
    this.lastA = this.link.aTotal;
  }

  private begin(nowMs: number): void {
    this.startMs = nowMs;
    this.sampling = true;
    this.progress = 0;
    this.error = '';
    this.pitch = [];
    this.roll = [];
    this.light = [];
  }

  private finishStep(): void {
    this.sampling = false;
    this.progress = 0;
    if (this.pitch.length < 3) {
      this.error = STRINGS.waitingForController;
      return;
    }
    const p = median(this.pitch);
    const r = median(this.roll);
    const l = median(this.light);
    const c = this.result;
    switch (this.step) {
      case 'neutral':
        c.neutralPitch = p;
        c.neutralRoll = r;
        this.step = 'right';
        break;
      case 'right': {
        const s = tiltSign(c.neutralRoll, r);
        if (s === null) {
          this.error = STRINGS.calTiltTooSmall;
          return;
        }
        c.rollSign = s;
        this.step = 'forward';
        break;
      }
      case 'forward': {
        const s = tiltSign(c.neutralPitch, p);
        if (s === null) {
          this.error = STRINGS.calTiltTooSmall;
          return;
        }
        c.forwardSign = s;
        this.step = 'open';
        break;
      }
      case 'open':
        c.lightOpen = l;
        this.step = 'covered';
        break;
      case 'covered':
        c.lightCovered = l;
        this.step = lightSeparationOk(c.lightOpen, c.lightCovered) ? 'done' : 'failed';
        break;
      default:
        break;
    }
  }
}
