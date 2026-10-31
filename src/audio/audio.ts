import { Music, type MusicMode } from './music';

/**
 * All sounds are synthesised with the Web Audio API (no downloaded audio).
 * The context is only created/resumed after a user gesture.
 * One shared, calm mix: player-specific sounds get only a slight pan.
 */
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private crowdGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private ambienceOn = false;
  private music: Music | null = null;
  private musicMode: MusicMode = 'off';
  private musicVolume = 0.6;
  private buzzGain: GainNode | null = null;
  private buzzPan: StereoPannerNode | null = null;
  private rainGain: GainNode | null = null;
  private rainPan: StereoPannerNode | null = null;
  private buzzOsc: OscillatorNode | null = null;

  /** Call from a user gesture (click / key). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 3;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = this.makeNoise();
      this.startAmbience();
      this.music = new Music(this.ctx, this.master, this.noise);
      this.music.setVolume(this.musicVolume);
      this.music.setMode(this.musicMode);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setMusicVolume(v: number): void {
    this.musicVolume = v;
    this.music?.setVolume(v);
  }

  setMusic(mode: MusicMode): void {
    this.musicMode = mode;
    this.music?.setMode(mode);
  }

  /** Night filter on the music and the haunted theremin layer. */
  setMusicMood(darkCount: number, haunted: boolean): void {
    this.music?.setDarkness(darkCount);
    this.music?.setHaunted(haunted);
  }

  /** Suspends everything (pause menu / tab hidden). */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') void this.ctx.suspend();
    else if (!paused && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      // Slightly pink-ish noise.
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1);
      d[i] = b * 6 + (Math.random() * 2 - 1) * 0.15;
    }
    return buf;
  }

  private loopNoise(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    return src;
  }

  private startAmbience(): void {
    if (this.ambienceOn || !this.ctx || !this.master) return;
    this.ambienceOn = true;
    const ctx = this.ctx;
    // Wind: band-limited noise whose level and brightness follow speed.
    const wind = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();
    // Crowd murmur: low, slowly modulated noise.
    const crowd = this.loopNoise();
    const cf = ctx.createBiquadFilter();
    cf.type = 'bandpass';
    cf.frequency.value = 900;
    cf.Q.value = 1.4;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0.0;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.01;
    lfo.connect(lfoGain).connect(this.crowdGain.gain);
    lfo.start();
    crowd.connect(cf).connect(this.crowdGain).connect(this.master);
    crowd.start();
    // Snitch wings: a buzzing hum (saw with fast tremolo), loud only when close.
    this.buzzOsc = ctx.createOscillator();
    this.buzzOsc.type = 'sawtooth';
    this.buzzOsc.frequency.value = 210;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = 'bandpass';
    buzzFilter.frequency.value = 1100;
    buzzFilter.Q.value = 1.2;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const tremLfo = ctx.createOscillator();
    tremLfo.frequency.value = 34;
    const tremDepth = ctx.createGain();
    tremDepth.gain.value = 0.5;
    tremLfo.connect(tremDepth).connect(trem.gain);
    this.buzzGain = ctx.createGain();
    this.buzzGain.gain.value = 0;
    this.buzzPan = ctx.createStereoPanner();
    this.buzzOsc.connect(buzzFilter).connect(trem).connect(this.buzzGain).connect(this.buzzPan).connect(this.master);
    this.buzzOsc.start();
    tremLfo.start();
    // Rain hiss for the rain-cloud easter egg (silent until a storm rains).
    const rain = this.loopNoise();
    const rf = ctx.createBiquadFilter();
    rf.type = 'highpass';
    rf.frequency.value = 1800;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainPan = ctx.createStereoPanner();
    rain.connect(rf).connect(this.rainGain).connect(this.rainPan).connect(this.master);
    rain.start(0, 0.7);
  }

  /** Rain loop level 0..1, panned toward the victim's half of the screen. */
  setRain(level: number, victim: number): void {
    if (!this.ctx || !this.rainGain || !this.rainPan) return;
    const t = this.ctx.currentTime;
    this.rainGain.gain.setTargetAtTime(level * 0.22, t, 0.25);
    if (level > 0) this.rainPan.pan.setTargetAtTime(victim === 0 ? -0.45 : 0.45, t, 0.1);
  }

  /** Rolling thunder (a storm is summoned / starts raining). */
  playThunder(strength = 1): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.burstNoise(t, 0.25, 2600, 0.18 * strength);
    this.burstNoise(t + 0.05, 2.4, 160, 0.55 * strength);
    this.burstNoise(t + 0.4, 1.8, 90, 0.4 * strength);
    this.tone(55, t + 0.05, 1.6, { type: 'sine', gain: 0.12 * strength, glide: 0.7, attack: 0.08 });
  }

  /** Little chime for each new hoop toward the storm. */
  playHoopProgress(count: number, player: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const pan = player === 0 ? -0.3 : 0.3;
    const notes = [523, 659, 784];
    for (let k = 0; k < count; k++) this.tone(notes[k] ?? 784, t + 0.25 + k * 0.08, 0.3, { type: 'triangle', gain: 0.06, pan });
  }

  /**
   * Snitch wing buzz. `near` 0..1 per player (1 = right next to it).
   * One shared mix, panned slightly toward the closer player's side.
   */
  setSnitchBuzz(near0: number, near1: number): void {
    if (!this.ctx || !this.buzzGain || !this.buzzPan || !this.buzzOsc) return;
    const t = this.ctx.currentTime;
    const n = Math.max(near0, near1);
    this.buzzGain.gain.setTargetAtTime(n * n * 0.09, t, 0.08);
    this.buzzPan.pan.setTargetAtTime(n > 0 ? ((near1 - near0) / (near0 + near1 + 1e-3)) * 0.35 : 0, t, 0.1);
    this.buzzOsc.frequency.setTargetAtTime(200 + n * 60, t, 0.1);
  }

  /** Continuous layers: speed 0..1 (average of both riders), crowd level 0..1. */
  setAmbience(speed01: number, crowd01: number): void {
    if (!this.ctx || !this.windGain || !this.windFilter || !this.crowdGain) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.02 + speed01 * 0.12, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(300 + speed01 * 900, t, 0.3);
    this.crowdGain.gain.setTargetAtTime(0.02 + crowd01 * 0.07, t, 0.4);
  }

  private tone(
    freq: number,
    start: number,
    dur: number,
    opts: { type?: OscillatorType; gain?: number; pan?: number; glide?: number; vibrato?: number; attack?: number } = {},
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (opts.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * opts.glide), start + dur);
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2;
    const attack = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node: AudioNode = osc.connect(g);
    if (opts.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(start + dur + 0.05);
    }
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      node = node.connect(p);
    }
    node.connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private burstNoise(start: number, dur: number, freq: number, gain: number, pan = 0): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, start);
    f.frequency.exponentialRampToValueAtTime(freq * 0.4, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.master!);
    src.start(start, Math.random());
    src.stop(start + dur + 0.05);
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  playCatch(player: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const pan = player === 0 ? -0.25 : 0.25;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.07, 0.5, { type: 'triangle', gain: 0.16, pan }));
    this.burstNoise(t, 0.8, 2500, 0.05);
  }

  /** A stadium cheer: many voices, a roar and clapping. */
  playCheer(strength = 1): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Roar: band-limited noise swell.
    this.burstNoise(t, 1.8 * strength + 0.4, 900, 0.28 * strength);
    this.burstNoise(t + 0.05, 1.5 * strength + 0.3, 1900, 0.12 * strength);
    // Voices: short rising "yay!" glides with vibrato.
    const voices = Math.round(10 * strength) + 2;
    for (let i = 0; i < voices; i++) {
      const start = t + Math.random() * 0.25;
      const f = 260 + Math.random() * 420;
      this.tone(f, start, 0.5 + Math.random() * 0.5, {
        type: 'sawtooth',
        gain: 0.02,
        glide: 1.35,
        vibrato: 14,
        pan: Math.random() * 1.4 - 0.7,
        attack: 0.04,
      });
    }
    this.clapping(t + 0.2, 1.6 * strength + 0.6, Math.round(22 * strength) + 6);
  }

  private clapping(start: number, dur: number, claps: number): void {
    for (let i = 0; i < claps; i++) {
      const at = start + Math.random() * dur;
      this.burstNoise(at, 0.05, 1500 + Math.random() * 1500, 0.06 * (1 - (at - start) / (dur * 1.2)), Math.random() * 1.2 - 0.6);
    }
  }

  /** The crowd goes "ooooh!" (Crazy Broom hits). */
  playOoh(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    for (let i = 0; i < 8; i++) {
      const f = 180 + Math.random() * 180;
      this.tone(f, t + Math.random() * 0.12, 1.1, { type: 'triangle', gain: 0.02, glide: 0.8, vibrato: 6, pan: Math.random() - 0.5, attack: 0.12 });
    }
    this.burstNoise(t, 1.0, 500, 0.06);
  }

  /** Applause for the end of the match. */
  playApplause(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.clapping(t, 3.5, 140);
    this.burstNoise(t, 3.5, 1200, 0.05);
  }

  /** Swoosh through a hoop. */
  playRing(player: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const pan = player === 0 ? -0.3 : 0.3;
    this.burstNoise(t, 0.45, 2400, 0.12, pan);
    this.tone(880, t + 0.05, 0.35, { type: 'sine', gain: 0.05, glide: 1.5, pan });
  }

  playMiss(player: number): void {
    if (!this.ready()) return;
    this.burstNoise(this.ctx!.currentTime, 0.25, 1200, 0.08, player === 0 ? -0.25 : 0.25);
  }

  playBoost(player: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const pan = player === 0 ? -0.25 : 0.25;
    this.burstNoise(t, 0.7, 700, 0.14, pan);
    this.tone(220, t, 0.5, { type: 'sawtooth', gain: 0.04, glide: 2.2, pan });
  }

  playBump(player: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(90, t, 0.25, { type: 'sine', gain: 0.18, glide: 0.6, pan: player === 0 ? -0.2 : 0.2 });
  }

  playCountdown(final: boolean): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    if (final) {
      [523, 659, 784].forEach((f) => this.tone(f, t, 0.7, { type: 'sawtooth', gain: 0.06, attack: 0.03 }));
      this.tone(1046, t, 0.7, { type: 'triangle', gain: 0.1 });
    } else {
      this.tone(660, t, 0.18, { type: 'triangle', gain: 0.12 });
    }
  }

  playMagic(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(420, t, 0.9, { type: 'sine', gain: 0.12, glide: 3.2, vibrato: 30 });
    for (let i = 0; i < 6; i++) this.tone(1400 + i * 260, t + 0.1 + i * 0.06, 0.25, { type: 'triangle', gain: 0.05 });
  }

  playSpellHit(victim: number): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const pan = victim === 0 ? -0.25 : 0.25;
    this.tone(300, t, 0.6, { type: 'square', gain: 0.05, glide: 0.5, vibrato: 60, pan });
    this.tone(450, t + 0.05, 0.6, { type: 'triangle', gain: 0.08, glide: 0.6, vibrato: 40, pan });
  }

  /** Original "oooooh" ghost choir: detuned voices gliding with vibrato. */
  playGhosts(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    const ctx = this.ctx!;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    f.Q.value = 6;
    f.connect(this.master!);
    for (const [base, det] of [
      [220, 0],
      [277, 7],
      [330, -6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.detune.value = det;
      osc.frequency.setValueAtTime(base * 1.2, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.8, t + 0.9);
      osc.frequency.exponentialRampToValueAtTime(base * 1.05, t + 1.8);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.8;
      const lg = ctx.createGain();
      lg.gain.value = 9;
      lfo.connect(lg).connect(osc.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.35);
      g.gain.setValueAtTime(0.07, t + 1.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      osc.connect(g).connect(f);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 2.2);
      lfo.stop(t + 2.2);
    }
  }

  playHint(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(1760, t, 0.4, { type: 'sine', gain: 0.04 });
    this.tone(2349, t + 0.12, 0.5, { type: 'sine', gain: 0.03 });
  }

  playWhistle(): void {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(2200, t, 0.9, { type: 'sine', gain: 0.08, vibrato: 50 });
  }

  playClick(): void {
    if (!this.ready()) return;
    this.tone(880, this.ctx!.currentTime, 0.08, { type: 'triangle', gain: 0.06 });
  }
}
