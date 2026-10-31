/**
 * Unified per-player command. Game rules only ever see this, never the device.
 */
export interface PlayerCommand {
  /** -1 = full left, +1 = full right. */
  turn: number;
  /** -1 = full dive, +1 = full climb (already includes the invert setting). */
  climb: number;
  brake: boolean;
  dark: boolean;
  /**
   * Monotonic count of boost-button presses (A on the micro:bit, F / K on the keyboard) since the source was created.
   * The simulation consumes the delta, so a short press between samples
   * is never lost and holding the button never repeats.
   */
  boostPresses: number;
}

export type SourceStatus = 'ok' | 'weak' | 'stale' | 'lost';

export interface InputSource {
  readonly kind: 'keyboard' | 'microbit';
  /** Updates internal smoothing and returns the current command. */
  sample(dt: number, nowMs: number): PlayerCommand;
  status(nowMs: number): SourceStatus;
  /** Clears held keys / filters (on blur, restart, pause). */
  reset(): void;
  dispose(): void;
}

export function neutralCommand(): PlayerCommand {
  return { turn: 0, climb: 0, brake: false, dark: false, boostPresses: 0 };
}
