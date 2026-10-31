/**
 * Original procedural soundtrack (Web Audio, no samples, no downloaded music).
 * A small look-ahead sequencer plays one of a few themes written for this game:
 *  - title:    a gentle music-box waltz in D minor
 *  - match:    a brisk orchestral waltz with harp arpeggios and pizzicato bass
 *  - overtime: the match theme, faster, with timpani
 *  - results:  a short fanfare, then the title theme
 * A ghostly theremin line can be layered on top while the stands are haunted.
 */

export type MusicMode = 'off' | 'title' | 'match' | 'overtime' | 'results';

type Note = [beat: number, midi: number, beats: number];

interface Theme {
  bpm: number;
  /** One chord per bar: root midi + chord tones as semitone offsets. */
  chords: [number, number[]][];
  melody: Note[];
  /** Melody instrument for even / odd passes. */
  lead: ('bell' | 'strings' | 'flute')[];
  harp: boolean;
  drums: boolean;
}

const MINOR = [0, 3, 7];
const MAJOR = [0, 4, 7];
const DOM7 = [0, 4, 7, 10];

const TITLE: Theme = {
  bpm: 84,
  chords: [
    [50, MINOR], // Dm
    [46, MAJOR], // Bb
    [43, MINOR], // Gm
    [45, DOM7], // A7
    [50, MINOR], // Dm
    [41, MAJOR], // F
    [43, MINOR], // Gm
    [50, MINOR], // Dm
  ],
  melody: [
    [0, 69, 1], [1, 74, 1.5], [2.5, 76, 0.5],
    [3, 77, 1], [4, 74, 2],
    [6, 79, 1], [7, 77, 0.5], [7.5, 76, 0.5], [8, 74, 1],
    [9, 73, 2], [11, 76, 1],
    [12, 81, 1], [13, 77, 1.5], [14.5, 74, 0.5],
    [15, 84, 1], [16, 81, 1], [17, 77, 1],
    [18, 79, 1.5], [19.5, 82, 0.5], [20, 81, 1],
    [21, 74, 3],
  ],
  lead: ['bell', 'flute'],
  harp: true,
  drums: false,
};

const MATCH: Theme = {
  bpm: 150,
  chords: [
    [50, MINOR], // Dm
    [50, MINOR], // Dm
    [46, MAJOR], // Bb
    [48, MAJOR], // C
    [41, MAJOR], // F
    [45, MAJOR], // A
    [50, MINOR], // Dm
    [45, DOM7], // A7
  ],
  melody: [
    [0, 74, 0.5], [0.5, 76, 0.5], [1, 77, 0.5], [1.5, 79, 0.5], [2, 81, 1],
    [3, 81, 0.5], [3.5, 79, 0.5], [4, 77, 1], [5, 74, 1],
    [6, 82, 1], [7, 81, 0.5], [7.5, 79, 0.5], [8, 77, 1],
    [9, 79, 1.5], [10.5, 76, 0.5], [11, 72, 1],
    [12, 77, 0.5], [12.5, 79, 0.5], [13, 81, 1], [14, 84, 1],
    [15, 85, 1.5], [16.5, 83, 0.5], [17, 81, 1],
    [18, 86, 1], [19, 81, 1], [20, 77, 1],
    [21, 76, 1], [22, 73, 1], [23, 69, 1],
  ],
  lead: ['strings', 'bell'],
  harp: true,
  drums: true,
};

const OVERTIME: Theme = { ...MATCH, bpm: 170 };

const FANFARE: Note[] = [
  [0, 62, 0.5], [0.5, 66, 0.5], [1, 69, 0.5], [1.5, 74, 1.5],
  [3, 71, 0.5], [3.5, 74, 0.5], [4, 78, 2.5],
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Music {
  private mode: MusicMode = 'off';
  private theme: Theme | null = null;
  private timer = 0;
  private nextBeatTime = 0;
  private beat = 0;
  private pass = 0;
  readonly out: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly reverb: ConvolverNode;
  private readonly wet: GainNode;
  private haunted = false;
  private hauntNext = 0;
  private hauntIndex = 0;
  private volume = 0.6;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = this.volume * 1.6;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 16000;
    this.filter.Q.value = 0.5;
    // A small synthetic hall reverb (decaying noise impulse).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.out.connect(this.filter);
    this.filter.connect(destination);
    this.out.connect(this.reverb);
    this.reverb.connect(this.wet).connect(this.filter);
  }

  private makeImpulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.out.gain.setTargetAtTime(v * 1.6, this.ctx.currentTime, 0.1);
  }

  /** 0 = both players in daylight, 1 = one in the dark, 2 = both in the dark. */
  setDarkness(level: number): void {
    const f = level >= 2 ? 1400 : level === 1 ? 4200 : 16000;
    this.filter.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.4);
  }

  setHaunted(on: boolean): void {
    if (on && !this.haunted) {
      this.hauntNext = this.ctx.currentTime + 0.2;
      this.hauntIndex = 0;
    }
    this.haunted = on;
  }

  setMode(mode: MusicMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.beat = 0;
    this.pass = 0;
    const t = this.ctx.currentTime;
    if (mode === 'off') {
      this.theme = null;
      this.stopTimer();
      return;
    }
    if (mode === 'results') {
      this.playFanfare(t + 0.1);
      this.theme = TITLE;
      this.nextBeatTime = t + 3.6;
    } else {
      this.theme = mode === 'title' ? TITLE : mode === 'match' ? MATCH : OVERTIME;
      this.nextBeatTime = t + 0.15;
    }
    if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 25);
  }

  private stopTimer(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  dispose(): void {
    this.stopTimer();
  }

  /** Look-ahead scheduler: queues every note that starts in the next ~150 ms. */
  private schedule(): void {
    const th = this.theme;
    if (!th) return;
    const ahead = this.ctx.currentTime + 0.15;
    // If the tab was suspended, skip forward instead of playing a burst.
    if (this.nextBeatTime < this.ctx.currentTime - 0.3) this.nextBeatTime = this.ctx.currentTime + 0.05;
    const spb = 60 / th.bpm;
    const bars = th.chords.length;
    while (this.nextBeatTime < ahead) {
      const beatInSong = this.beat % (bars * 3);
      const bar = Math.floor(beatInSong / 3);
      const beatInBar = beatInSong % 3;
      const t = this.nextBeatTime;
      const [root, tones] = th.chords[bar];

      // Waltz accompaniment: bass on 1, chord on 2 and 3.
      if (beatInBar === 0) this.pizz(mtof(root - 12), t, spb * 0.9, 0.22);
      else this.chord(root, tones, t, spb * 0.8);
      if (beatInBar === 0) this.pad(root, tones, t, spb * 3);

      // Harp arpeggio in eighth notes.
      if (th.harp) {
        for (let k = 0; k < 2; k++) {
          const idx = (beatInBar * 2 + k) % (tones.length + 1);
          const note = root + 12 + (idx < tones.length ? tones[idx] : 12);
          this.harp(mtof(note), t + k * spb * 0.5, 0.08);
        }
      }
      if (th.drums) {
        this.shaker(t, beatInBar === 0 ? 0.05 : 0.03);
        this.shaker(t + spb * 0.5, 0.02);
        if (beatInBar === 0 && (bar % 2 === 0 || this.mode === 'overtime')) this.timpani(mtof(root - 12), t, this.mode === 'overtime' ? 0.3 : 0.18);
      }

      // Melody notes that start on this beat.
      const lead = th.lead[this.pass % th.lead.length];
      for (const [b, m, len] of th.melody) {
        if (b >= beatInSong && b < beatInSong + 1) {
          const start = t + (b - beatInSong) * spb;
          const octave = lead === 'strings' ? -12 : 0;
          this.lead(lead, mtof(m + octave), start, len * spb);
        }
      }

      this.beat++;
      if (this.beat % (bars * 3) === 0) this.pass++;
      this.nextBeatTime += spb;
    }

    if (this.haunted && this.hauntNext < ahead) {
      const line = [74, 69, 70, 69, 65, 69];
      const m = line[this.hauntIndex % line.length];
      this.theremin(mtof(m), this.hauntNext, 1.6);
      this.hauntIndex++;
      this.hauntNext += 1.7;
    }
  }

  /* ---------------------------- instruments ---------------------------- */

  private env(start: number, attack: number, hold: number, release: number, peak: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(peak, start + attack);
    g.gain.setValueAtTime(peak, start + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + hold + release);
    g.connect(this.out);
    return g;
  }

  private osc(type: OscillatorType, freq: number, start: number, stop: number, dest: AudioNode, detune = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    o.detune.value = detune;
    o.connect(dest);
    o.start(start);
    o.stop(stop);
    return o;
  }

  /** Celesta / music box: sine with a bright inharmonic partial. */
  private bell(freq: number, start: number, len: number, vol = 0.12): void {
    const dur = Math.max(0.6, len + 0.8);
    const g = this.env(start, 0.005, 0, dur, vol);
    this.osc('sine', freq, start, start + dur + 0.05, g);
    const g2 = this.env(start, 0.002, 0, dur * 0.4, vol * 0.35);
    this.osc('sine', freq * 4.01, start, start + dur, g2);
  }

  private flute(freq: number, start: number, len: number): void {
    const g = this.env(start, 0.08, Math.max(0, len - 0.15), 0.25, 0.07);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * 3;
    lp.connect(g);
    const o = this.osc('triangle', freq, start, start + len + 0.4, lp);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 5;
    const vg = this.ctx.createGain();
    vg.gain.value = freq * 0.006;
    vib.connect(vg).connect(o.frequency);
    vib.start(start + 0.15);
    vib.stop(start + len + 0.4);
  }

  private strings(freq: number, start: number, len: number, vol = 0.05): void {
    const g = this.env(start, 0.06, Math.max(0, len - 0.1), 0.35, vol);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(6000, freq * 5);
    lp.connect(g);
    for (const d of [-7, 0, 6]) this.osc('sawtooth', freq, start, start + len + 0.5, lp, d);
  }

  private lead(kind: 'bell' | 'strings' | 'flute', freq: number, start: number, len: number): void {
    if (kind === 'bell') this.bell(freq, start, len);
    else if (kind === 'flute') this.flute(freq, start, len);
    else {
      this.strings(freq * 2, start, len, 0.045);
      this.bell(freq * 2, start, len * 0.5, 0.04);
    }
  }

  private pad(root: number, tones: number[], start: number, len: number): void {
    const g = this.env(start, len * 0.3, len * 0.4, len * 0.5, 0.025);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    lp.connect(g);
    for (const t of tones.slice(0, 3)) this.osc('sawtooth', mtof(root + t), start, start + len * 1.25, lp, (t % 2) * 6 - 3);
  }

  private chord(root: number, tones: number[], start: number, len: number): void {
    for (const t of tones.slice(0, 3)) this.pizz(mtof(root + 12 + t), start, len * 0.5, 0.05);
  }

  private pizz(freq: number, start: number, len: number, vol: number): void {
    const g = this.env(start, 0.004, 0, Math.max(0.12, len * 0.6), vol);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * 6;
    lp.connect(g);
    this.osc('triangle', freq, start, start + len + 0.2, lp);
  }

  private harp(freq: number, start: number, vol: number): void {
    const g = this.env(start, 0.003, 0, 0.9, vol);
    this.osc('triangle', freq, start, start + 1, g);
    const g2 = this.env(start, 0.002, 0, 0.25, vol * 0.4);
    this.osc('sine', freq * 2, start, start + 0.3, g2);
  }

  private shaker(start: number, vol: number): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = this.env(start, 0.002, 0, 0.07, vol);
    src.connect(hp).connect(g);
    src.start(start, Math.random());
    src.stop(start + 0.12);
  }

  private timpani(freq: number, start: number, vol: number): void {
    const g = this.env(start, 0.004, 0, 0.9, vol);
    const o = this.osc('sine', freq * 2, start, start + 1, g);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, start + 0.4);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 300;
    const ng = this.env(start, 0.002, 0, 0.2, vol * 0.6);
    src.connect(bp).connect(ng);
    src.start(start, Math.random());
    src.stop(start + 0.3);
  }

  private theremin(freq: number, start: number, len: number): void {
    const g = this.env(start, 0.35, len - 0.6, 0.5, 0.06);
    const o = this.osc('sine', freq * 0.97, start, start + len + 0.2, g);
    o.frequency.linearRampToValueAtTime(freq, start + 0.4);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 6.5;
    const vg = this.ctx.createGain();
    vg.gain.value = freq * 0.02;
    vib.connect(vg).connect(o.frequency);
    vib.start(start);
    vib.stop(start + len + 0.2);
  }

  private playFanfare(start: number): void {
    const spb = 60 / 120;
    for (const [b, m, len] of FANFARE) {
      const t = start + b * spb;
      this.strings(mtof(m), t, len * spb, 0.07);
      this.bell(mtof(m + 12), t, len * spb, 0.06);
    }
    // Final chord with timpani.
    const end = start + 4 * spb;
    for (const m of [50, 62, 66, 69]) this.strings(mtof(m), end, 2.4, 0.04);
    this.timpani(mtof(38), end, 0.35);
  }
}
