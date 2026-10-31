import { CONFIG } from '../config';
import type { InputSource, PlayerCommand, SourceStatus } from './types';

export interface KeyBindings {
  left: string;
  right: string;
  dive: string;
  climb: string;
  catch: string;
  brake: string;
  night: string;
}

export const KEY_BINDINGS: [KeyBindings, KeyBindings] = [
  { left: 'KeyA', right: 'KeyD', dive: 'KeyW', climb: 'KeyS', catch: 'KeyF', brake: 'KeyG', night: 'KeyR' },
  { left: 'ArrowLeft', right: 'ArrowRight', dive: 'ArrowUp', climb: 'ArrowDown', catch: 'KeyK', brake: 'KeyL', night: 'KeyO' },
];

const GAME_CODES = new Set(KEY_BINDINGS.flatMap((b) => Object.values(b)));

/**
 * One global keyboard listener shared by both players. It is installed once
 * per app and removed on dispose, so restarts never stack listeners.
 */
export class KeyboardHub {
  private readonly held = new Set<string>();
  private readonly pressCounts = new Map<string, number>();
  private readonly onKeyDown = (e: KeyboardEvent) => this.handleDown(e);
  private readonly onKeyUp = (e: KeyboardEvent) => this.handleUp(e);
  private readonly onBlur = () => this.focusLost();
  private readonly onVisibility = () => {
    if (document.hidden) this.focusLost();
  };
  /** Called with KeyboardEvent.code on every non-repeat key press. */
  onPress: ((code: string, e: KeyboardEvent) => void) | null = null;
  onFocusLost: (() => void) | null = null;

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  isHeld(code: string): boolean {
    return this.held.has(code);
  }

  presses(code: string): number {
    return this.pressCounts.get(code) ?? 0;
  }

  clear(): void {
    this.held.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.held.clear();
  }

  private handleDown(e: KeyboardEvent): void {
    const inField = e.target instanceof HTMLInputElement && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (inField) return;
    if (GAME_CODES.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.held.add(e.code);
    this.pressCounts.set(e.code, (this.pressCounts.get(e.code) ?? 0) + 1);
    this.onPress?.(e.code, e);
  }

  private handleUp(e: KeyboardEvent): void {
    this.held.delete(e.code);
  }

  private focusLost(): void {
    this.held.clear();
    this.onFocusLost?.();
  }
}

/** Keyboard adapter for one player. */
export class KeyboardSource implements InputSource {
  readonly kind = 'keyboard' as const;
  private turn = 0;
  private climb = 0;
  private dark = false;
  private lastNightPresses: number;
  private readonly cmd: PlayerCommand = { turn: 0, climb: 0, brake: false, dark: false, boostPresses: 0 };

  private readonly keys: KeyBindings[];

  /** One binding set, or several (single player may use WASD and arrows). */
  constructor(
    private readonly hub: KeyboardHub,
    keys: KeyBindings | KeyBindings[],
  ) {
    this.keys = Array.isArray(keys) ? keys : [keys];
    this.lastNightPresses = this.count('night');
  }

  private held(action: keyof KeyBindings): boolean {
    return this.keys.some((k) => this.hub.isHeld(k[action]));
  }

  private count(action: keyof KeyBindings): number {
    let n = 0;
    for (const k of this.keys) n += this.hub.presses(k[action]);
    return n;
  }

  sample(dt: number): PlayerCommand {
    const tTurn = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    const tClimb = (this.held('climb') ? 1 : 0) - (this.held('dive') ? 1 : 0);
    const a = 1 - Math.exp(-CONFIG.input.keyRamp * dt);
    this.turn += (tTurn - this.turn) * a;
    this.climb += (tClimb - this.climb) * a;
    if (Math.abs(this.turn) < 0.001) this.turn = 0;
    if (Math.abs(this.climb) < 0.001) this.climb = 0;

    const night = this.count('night');
    if (night !== this.lastNightPresses) {
      if ((night - this.lastNightPresses) % 2 !== 0) this.dark = !this.dark;
      this.lastNightPresses = night;
    }

    this.cmd.turn = this.turn;
    this.cmd.climb = this.climb;
    this.cmd.brake = this.held('brake');
    this.cmd.dark = this.dark;
    this.cmd.boostPresses = this.count('catch');
    return this.cmd;
  }

  status(): SourceStatus {
    return 'ok';
  }

  reset(): void {
    this.turn = 0;
    this.climb = 0;
    this.lastNightPresses = this.count('night');
  }

  /** Day/night can be reset to day when a new match starts. */
  setDark(dark: boolean): void {
    this.dark = dark;
  }

  dispose(): void {
    /* listeners belong to the hub */
  }
}
