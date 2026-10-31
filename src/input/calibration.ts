import { CONFIG } from '../config';

const I = CONFIG.input;

export interface Calibration {
  neutralPitch: number;
  neutralRoll: number;
  /** +1 if tilting right increases roll, otherwise -1. */
  rollSign: number;
  /** +1 if tilting forward increases pitch, otherwise -1. */
  forwardSign: number;
  lightOpen: number;
  lightCovered: number;
}

export function defaultCalibration(): Calibration {
  // micro:bit axes: X grows when tilting right, Y grows when the top (USB/logo)
  // edge dips forward. Held flat with LEDs up, that is all we need.
  return { neutralPitch: 0, neutralRoll: 0, rollSign: 1, forwardSign: 1, lightOpen: 120, lightCovered: 20 };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Direction sign from a deliberate tilt, or null if the tilt was too small. */
export function tiltSign(neutral: number, tilted: number): number | null {
  const d = tilted - neutral;
  if (Math.abs(d) < I.minCalibrationTiltDeg) return null;
  return d > 0 ? 1 : -1;
}

/** True when uncovered and covered readings are far enough apart. */
export function lightSeparationOk(open: number, covered: number): boolean {
  const sep = open - covered;
  return sep >= I.minLightSeparation && sep >= open * I.minLightSeparationRatio;
}

export function lightThresholds(c: Pick<Calibration, 'lightOpen' | 'lightCovered'>): { darkBelow: number; lightAbove: number } {
  const range = c.lightOpen - c.lightCovered;
  const mid = c.lightCovered + range * 0.5;
  const band = range * I.lightHysteresis;
  return { darkBelow: mid - band, lightAbove: mid + band };
}

/**
 * Light → dark state with hysteresis and debounce, so a hand hovering near the
 * threshold or sensor noise never makes the screen flicker.
 */
export class LightDetector {
  dark = false;
  private candidate = false;
  private candidateTime = 0;

  constructor(
    private darkBelow: number,
    private lightAbove: number,
    private readonly debounce: number = I.lightDebounce,
  ) {}

  setThresholds(darkBelow: number, lightAbove: number): void {
    this.darkBelow = darkBelow;
    this.lightAbove = lightAbove;
  }

  update(light: number, dt: number): boolean {
    let want = this.dark;
    if (!this.dark && light < this.darkBelow) want = true;
    else if (this.dark && light > this.lightAbove) want = false;

    if (want === this.dark) {
      this.candidateTime = 0;
      this.candidate = this.dark;
      return this.dark;
    }
    if (want !== this.candidate) {
      this.candidate = want;
      this.candidateTime = 0;
    }
    this.candidateTime += dt;
    if (this.candidateTime >= this.debounce) {
      this.dark = want;
      this.candidateTime = 0;
    }
    return this.dark;
  }

  reset(): void {
    this.dark = false;
    this.candidate = false;
    this.candidateTime = 0;
  }
}

/**
 * Day/night from the light sensor WITHOUT calibration.
 * It keeps a running estimate of the uncovered ("open") light level: it rises
 * immediately to brighter readings and slowly forgets old ones. Covering the
 * top LED row drops the reading far below that level, which means "night".
 * Hysteresis + debounce stop flicker.
 */
export class AdaptiveLight {
  dark = false;
  openLevel = 0;
  private candidateTime = 0;

  constructor(
    private readonly darkRatio = 0.45,
    private readonly lightRatio = 0.62,
    private readonly debounce: number = I.lightDebounce,
    /** Seconds for the open-level estimate to forget a brighter past. */
    private readonly forget = 25,
    /** Below this open level the room is too dark to tell. */
    private readonly minOpen = 6,
  ) {}

  update(light: number, dt: number): boolean {
    // Only forget toward the current reading while uncovered, so holding
    // the sensor covered for a long time never makes "dark" the new normal.
    if (light >= this.openLevel) this.openLevel = light;
    else if (!this.dark) this.openLevel += (light - this.openLevel) * (1 - Math.exp(-dt / this.forget));
    if (this.openLevel < this.minOpen) {
      this.dark = false;
      this.candidateTime = 0;
      return false;
    }
    const want = this.dark ? light < this.openLevel * this.lightRatio : light < this.openLevel * this.darkRatio;
    if (want === this.dark) {
      this.candidateTime = 0;
      return this.dark;
    }
    this.candidateTime += dt;
    if (this.candidateTime >= this.debounce) {
      this.dark = want;
      this.candidateTime = 0;
    }
    return this.dark;
  }

  reset(): void {
    this.dark = false;
    this.candidateTime = 0;
  }
}

/** Dead zone with rescale so output still reaches ±1 smoothly. */
export function applyDeadzone(v: number, dz: number = I.deadzone): number {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  return (Math.sign(v) * (a - dz)) / (1 - dz);
}

export function tiltToAxes(
  pitch: number,
  roll: number,
  cal: Calibration,
  sensitivity: number,
): { turn: number; climb: number } {
  const r = ((roll - cal.neutralRoll) * cal.rollSign) / I.fullRollDeg;
  // Tilting forward means dive (climb = -1).
  const f = ((pitch - cal.neutralPitch) * cal.forwardSign) / I.fullPitchDeg;
  const turn = applyDeadzone(Math.max(-1, Math.min(1, r))) * sensitivity;
  const climb = applyDeadzone(-Math.max(-1, Math.min(1, f))) * sensitivity;
  return { turn: Math.max(-1.5, Math.min(1.5, turn)), climb: Math.max(-1, Math.min(1, climb)) };
}

const STORAGE_KEY = 'lumos-snitch.calibration.v1';

export function saveCalibrations(cals: readonly (Calibration | null)[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cals));
  } catch {
    /* storage unavailable — fine */
  }
}

export function loadCalibrations(): (Calibration | null)[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [null, null];
    const v = JSON.parse(raw) as (Calibration | null)[];
    if (!Array.isArray(v) || v.length !== 2) return [null, null];
    return v.map((c) => (c && typeof c.neutralPitch === 'number' ? c : null));
  } catch {
    return [null, null];
  }
}
