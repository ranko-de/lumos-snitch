import { CONFIG } from './config';

export interface Settings {
  sensitivity: [number, number];
  invertPitch: [boolean, boolean];
  volume: number;
  musicVolume: number;
  reduceMotion: boolean;
  lowQuality: boolean;
}

const KEY = 'lumos-snitch.settings.v1';

export function defaultSettings(): Settings {
  return {
    sensitivity: [CONFIG.input.defaultSensitivity, CONFIG.input.defaultSensitivity],
    invertPitch: [false, false],
    volume: CONFIG.audio.defaultVolume,
    musicVolume: CONFIG.audio.defaultMusicVolume,
    reduceMotion: false,
    lowQuality: false,
  };
}

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const v = JSON.parse(raw) as Partial<Settings>;
    const clampS = (x: unknown) =>
      typeof x === 'number' ? Math.min(CONFIG.input.maxSensitivity, Math.max(CONFIG.input.minSensitivity, x)) : CONFIG.input.defaultSensitivity;
    return {
      sensitivity: Array.isArray(v.sensitivity) ? [clampS(v.sensitivity[0]), clampS(v.sensitivity[1])] : d.sensitivity,
      invertPitch: Array.isArray(v.invertPitch) ? [!!v.invertPitch[0], !!v.invertPitch[1]] : d.invertPitch,
      volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : d.volume,
      musicVolume: typeof v.musicVolume === 'number' ? Math.min(1, Math.max(0, v.musicVolume)) : d.musicVolume,
      reduceMotion: !!v.reduceMotion,
      lowQuality: !!v.lowQuality,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}
