import { GameAudio } from './audio/audio';
import { CONFIG } from './config';
import { Simulation, type SimEvent } from './game/simulation';
import { defaultCalibration, loadCalibrations, saveCalibrations, type Calibration } from './input/calibration';
import { CalibrationFlow } from './input/calibrationFlow';
import { KEY_BINDINGS, KeyboardHub, KeyboardSource } from './input/keyboard';
import { MicrobitSource } from './input/microbit';
import { neutralCommand, type InputSource, type PlayerCommand, type SourceStatus } from './input/types';
import { GameRenderer } from './render/renderer';
import { ProtocolRouter } from './serial/protocol';
import { isWebSerialSupported, SerialConnection } from './serial/webserial';
import { loadSettings, saveSettings, type Settings } from './settings';
import { STRINGS } from './strings';
import { Hud } from './ui/hud';
import * as Screens from './ui/screens';

type Screen = 'title' | 'mode' | 'connect' | 'lobby' | 'calibrate' | 'practice' | 'countdown' | 'playing' | 'results';
type Overlay = 'none' | 'pause' | 'disconnect';

/**
 * Top-level controller: screens, input sources, the single animation loop.
 * Everything is created exactly once; restarts only reset state.
 */
export class App {
  readonly sim = new Simulation();
  readonly renderer: GameRenderer;
  readonly audio = new GameAudio();
  readonly hud: Hud;
  readonly keyboard = new KeyboardHub();
  readonly router = new ProtocolRouter();
  readonly serial = new SerialConnection();
  settings: Settings = loadSettings();

  screen: Screen = 'title';
  overlay: Overlay = 'none';
  private readonly keyboardSources: [KeyboardSource, KeyboardSource];
  /** Single player on the keyboard can use WASD and the arrows. */
  private readonly soloKeyboard: KeyboardSource;
  /** Controller buttons seen by menus (separate from in-game boost counting). */
  private readonly menuA = [0, 0];
  private readonly menuB = [false, false];
  private readonly joined: [boolean, boolean] = [false, false];
  private comboHold = 0;
  private resultsShownAt = 0;
  private backOnline = 0;
  private readonly sources: [InputSource, InputSource];
  /** Which players use the micro:bit (decided on the connect screen). */
  private readonly wantsHardware: [boolean, boolean] = [false, false];
  private calibrations: (Calibration | null)[] = loadCalibrations();
  private flows: [CalibrationFlow | null, CalibrationFlow | null] = [null, null];
  private afterCalibration: 'practice' | 'countdown' = 'practice';

  private readonly cmds: [PlayerCommand, PlayerCommand] = [neutralCommand(), neutralCommand()];
  private readonly statuses: [SourceStatus, SourceStatus] = ['ok', 'ok'];
  private readonly kinds: [string, string] = ['keyboard', 'keyboard'];
  private accumulator = 0;
  private lastFrame = 0;
  private rafId = 0;
  loopCount = 0;
  private readonly screensEl: HTMLElement;
  private practiceGoTimer = -1;

  constructor(canvas: HTMLCanvasElement, hudEl: HTMLElement, screensEl: HTMLElement) {
    this.screensEl = screensEl;
    this.renderer = new GameRenderer(canvas, this.settings.lowQuality);
    this.renderer.reducedMotion = this.settings.reduceMotion;
    this.hud = new Hud(hudEl);
    this.hud.setReducedMotion(this.settings.reduceMotion);
    this.audio.setVolume(this.settings.volume);
    this.audio.setMusicVolume(this.settings.musicVolume);
    this.keyboardSources = [new KeyboardSource(this.keyboard, KEY_BINDINGS[0]), new KeyboardSource(this.keyboard, KEY_BINDINGS[1])];
    this.sources = [this.keyboardSources[0], this.keyboardSources[1]];
    this.soloKeyboard = new KeyboardSource(this.keyboard, KEY_BINDINGS);

    this.serial.onRecord = (obj) => this.router.handle(obj, performance.now());
    this.serial.onStateChange = (state) => {
      if (state === 'open' && this.screen === 'connect') this.showLobby(-1);
      else if (this.screen === 'title' && this.overlay === 'none') this.showScreen('title');
      this.refreshDynamicScreen();
    };
    // Reopen a receiver this browser was already allowed to use: no clicks needed.
    if (isWebSerialSupported()) {
      void this.serial.reconnect();
      navigator.serial?.addEventListener('connect', () => {
        if (!this.serial.isOpen) void this.serial.reconnect();
      });
    }

    // One delegated listener for every screen button / setting (never re-added).
    screensEl.addEventListener('click', (e) => this.onClick(e));
    screensEl.addEventListener('input', (e) => this.onSettingInput(e));
    this.keyboard.onPress = (code, e) => this.onKey(code, e);
    this.keyboard.onFocusLost = () => {
      for (const s of this.sources) s.reset();
      if (this.inMatch() && this.overlay === 'none') this.openPause();
    };
    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.sim.startAttract();
    this.renderer.snapCameras(this.sim);
    this.showScreen('title');
  }

  /** Starts the one and only animation loop. */
  start(): void {
    if (this.rafId) return;
    this.loopCount++;
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      this.rafId = requestAnimationFrame(frame);
      this.frame(now);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private resize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  private inMatch(): boolean {
    return this.screen === 'practice' || this.screen === 'countdown' || this.screen === 'playing';
  }

  /* ------------------------------ loop ------------------------------ */

  private frame(now: number): void {
    const dt = Math.min(CONFIG.sim.maxFrameDelta, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    // Sample every input source once per frame (shared by all sim steps).
    for (let i = 0; i < 2; i++) {
      const src = this.sources[i];
      const c = src.sample(dt, now);
      const out = this.cmds[i];
      const sens = this.settings.sensitivity[i];
      out.turn = Math.max(-1.5, Math.min(1.5, c.turn * sens));
      out.climb = Math.max(-1, Math.min(1, c.climb * sens * (this.settings.invertPitch[i] ? -1 : 1)));
      out.brake = c.brake;
      out.dark = c.dark;
      out.boostPresses = c.boostPresses;
      this.statuses[i] = src.status(now);
      this.kinds[i] = src.kind;
    }

    if (this.inMatch() && this.overlay === 'none') this.checkDisconnect();
    this.pollControllers(dt, now);

    const simDt = this.overlay === 'none' ? dt : 0;
    if (simDt > 0) {
      this.accumulator += simDt;
      let steps = 0;
      const step = CONFIG.sim.step;
      while (this.accumulator >= step && steps < CONFIG.sim.maxStepsPerFrame) {
        this.renderer.capture(this.sim);
        this.sim.step(step, this.cmds);
        this.accumulator -= step;
        steps++;
      }
      if (steps === CONFIG.sim.maxStepsPerFrame) this.accumulator = 0;
    }
    this.processEvents(this.sim.events);
    this.sim.events.length = 0;

    if (this.screen === 'practice' && this.overlay === 'none') {
      if (this.sim.practiceComplete) {
        if (this.practiceGoTimer < 0) {
          this.practiceGoTimer = 1.2;
          this.hud.centerText(STRINGS.tutorialReady, 1.2);
        }
        this.practiceGoTimer -= dt;
        if (this.practiceGoTimer <= 0) this.startCountdown();
      }
    }

    const alpha = Math.min(1, this.accumulator / CONFIG.sim.step);
    const visualDt = this.overlay === 'none' ? dt : 0;
    this.renderer.sync(this.sim, alpha, visualDt);
    this.renderer.updateCameras(this.sim, dt);
    const split =
      this.screen !== 'title' && this.screen !== 'mode' && this.screen !== 'connect' && this.screen !== 'calibrate' && this.screen !== 'lobby';
    this.renderer.render(this.sim, split);
    this.hud.update(this.sim, visualDt, this.statuses, this.kinds, this.renderer.viewInfo);

    const activePlayers = this.sim.players.filter((_, i) => this.sim.active[i]);
    const avgSpeed = split
      ? activePlayers.reduce((a, p) => a + p.speed, 0) / activePlayers.length / (CONFIG.flight.cruiseSpeed + CONFIG.flight.diveBonus)
      : 0.15;
    this.audio.setAmbience(Math.min(1, avgSpeed), split ? 0.6 : 0.3);
    const sn = this.sim.snitch;
    const near = (i: number) =>
      split && sn.visible ? Math.max(0, 1 - this.sim.players[i].pos.distanceTo(sn.pos) / CONFIG.audio.snitchHearRadius) : 0;
    this.audio.setSnitchBuzz(near(0), near(1));
    const darkCount = split ? activePlayers.filter((p) => p.dark).length * (activePlayers.length === 1 ? 2 : 1) : 0;
    this.audio.setMusicMood(darkCount, split && this.sim.ghosts.haunted);
    const st = this.sim.storm;
    this.audio.setRain(split && this.sim.phase === 'playing' ? st.rain : 0, st.victim);

    if (this.screen === 'connect' || this.screen === 'calibrate' || this.overlay === 'disconnect') {
      this.updateCalibration(now);
      this.refreshDynamicScreen();
    }
  }

  private processEvents(events: readonly SimEvent[]): void {
    this.renderer.handleEvents(events, this.sim);
    for (const e of events) {
      switch (e.type) {
        case 'countdownTick':
          this.hud.centerText(String(e.value), 0.9);
          this.audio.playCountdown(false);
          break;
        case 'go':
          this.audio.setMusic('match');
          this.audio.playCheer(0.8);
          this.hud.centerText(STRINGS.go, 0.9);
          this.audio.playCountdown(true);
          for (const src of this.sources) if (src instanceof MicrobitSource) src.endNeutralCapture();
          this.setScreen('playing');
          break;
        case 'catch': {
          const other = e.player === 0 ? 1 : 0;
          this.hud.message(e.player, STRINGS.youCaught, 2);
          this.hud.message(other, STRINGS.opponentCaught(STRINGS.playerName(e.player)), 2);
          this.audio.playCatch(e.player);
          this.audio.playCheer(1);
          break;
        }
        case 'practiceCatch':
          this.hud.message(e.player, STRINGS.youCaught, 1.5);
          this.audio.playCatch(e.player);
          break;
        case 'tie':
          this.hud.message(0, STRINGS.snitchEscaped, 2);
          this.hud.message(1, STRINGS.snitchEscaped, 2);
          this.audio.playMiss(0);
          break;
        case 'boost':
          this.audio.playBoost(e.player);
          break;
        case 'ring':
          this.audio.playRing(e.player);
          this.renderer.cheerBurst(0.45);
          if (this.sim.phase === 'playing') this.audio.playCheer(0.35);
          break;
        case 'bump':
          this.audio.playBump(e.player);
          break;
        case 'hint':
          this.audio.playHint();
          break;
        case 'overtime':
          this.audio.setMusic('overtime');
          this.hud.bannerText(STRINGS.overtime, 3);
          this.hud.setStickyBanner(STRINGS.overtimeShort);
          this.audio.playWhistle();
          break;
        case 'matchEnd':
          this.audio.playWhistle();
          this.audio.playApplause();
          this.audio.setMusic('results');
          this.hud.setStickyBanner('');
          window.setTimeout(() => {
            if (this.screen === 'playing' && this.sim.phase === 'ended') this.showResults();
          }, 1400);
          break;
        case 'dumbledoreTrigger':
          this.hud.message(e.caster, STRINGS.dumbledoreJoined, 2.5);
          this.audio.playMagic();
          break;
        case 'spellCast':
          this.audio.playMagic();
          break;
        case 'spellHit':
          this.audio.playSpellHit(e.victim);
          this.audio.playOoh();
          break;
        case 'seated': {
          const other = e.player === 0 ? 1 : 0;
          if (!this.sim.singlePlayer) this.hud.message(other, STRINGS.crowdPenaltyOther(STRINGS.playerName(e.player)), 2.5);
          this.audio.playBump(e.player);
          this.audio.playOoh();
          this.audio.playCheer(0.6);
          break;
        }
        case 'unseated':
          this.hud.message(e.player, STRINGS.crowdPenaltyOver, 1.5);
          this.audio.playBoost(e.player);
          break;
        case 'hoopProgress':
          this.audio.playHoopProgress(e.count, e.player);
          break;
        case 'stormSummon':
          this.hud.message(e.caster, STRINGS.stormSummoned, 2.5);
          this.audio.playThunder(0.8);
          break;
        case 'rainStart':
          this.audio.playThunder(1);
          this.audio.playOoh();
          break;
        case 'haunt':
          if (e.withSound) {
            this.audio.playGhosts();
            this.hud.bannerText(STRINGS.haunted, CONFIG.ghosts.messageTime);
          }
          break;
        default:
          break;
      }
    }
  }

  /* ----------------------------- screens ----------------------------- */

  private setScreen(s: Screen): void {
    this.screen = s;
    if (s === 'title' || s === 'mode' || s === 'connect' || s === 'lobby' || s === 'calibrate' || s === 'practice' || s === 'countdown')
      this.audio.setMusic('title');
    this.hud.show(s === 'practice' || s === 'countdown' || s === 'playing' || s === 'results');
  }

  private showScreen(s: Screen): void {
    this.setScreen(s);
    this.overlay = 'none';
    this.audio.setPaused(false);
    let html = '';
    switch (s) {
      case 'title':
        html = Screens.titleScreen(this.serial.isOpen, isWebSerialSupported());
        break;
      case 'lobby':
        html = Screens.lobbyScreen();
        break;
      case 'mode':
        html = Screens.modeScreen(isWebSerialSupported());
        break;
      case 'connect':
        html = Screens.connectScreen();
        break;
      case 'calibrate':
        html = Screens.calibrateScreen(this.wantsHardware, [!!this.calibrations[0], !!this.calibrations[1]]);
        break;
      case 'practice':
        html = Screens.practiceBar(this.usesController());
        break;
      default:
        html = '';
    }
    this.screensEl.innerHTML = html;
    this.focusFirst();
    this.refreshDynamicScreen();
  }

  private focusFirst(): void {
    const el = this.screensEl.querySelector<HTMLElement>('[autofocus], .btn, .mode');
    el?.focus({ preventScroll: true });
  }

  private startPractice(): void {
    this.hud.reset();
    for (const k of this.keyboardSources) k.setDark(false);
    this.resetSources();
    this.sim.startPractice();
    this.renderer.snapCameras(this.sim);
    this.practiceGoTimer = -1;
    this.showScreen('practice');
  }

  startCountdown(): void {
    this.hud.reset();
    for (const k of this.keyboardSources) k.setDark(false);
    this.resetSources();
    this.sim.startCountdown();
    this.renderer.snapCameras(this.sim);
    // The countdown doubles as the "hold your controller comfortably" moment.
    for (const src of this.sources) if (src instanceof MicrobitSource) src.beginNeutralCapture();
    this.showScreen('countdown');
  }

  private showResults(): void {
    this.setScreen('results');
    this.resultsShownAt = performance.now();
    this.screensEl.innerHTML = Screens.resultsScreen(
      [this.sim.players[0].score, this.sim.players[1].score],
      this.sim.winner,
      this.sim.singlePlayer ? this.sim.soloIndex : -1,
      this.usesController(),
    );
    this.focusFirst();
  }

  private toTitle(): void {
    this.sim.startAttract();
    this.renderer.snapCameras(this.sim);
    this.hud.reset();
    this.showScreen('title');
  }

  private resetSources(): void {
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      this.sources[i].reset();
      this.sim.syncPresses(i, this.sources[i].sample(0, performance.now()).boostPresses);
    }
  }

  private openPause(): void {
    this.overlay = 'pause';
    this.keyboard.clear();
    this.audio.setPaused(true);
    this.screensEl.innerHTML = Screens.pauseScreen(this.settings, this.sources.some((s) => s.kind === 'microbit'));
    this.focusFirst();
  }

  private closeOverlay(): void {
    this.overlay = 'none';
    this.audio.setPaused(false);
    this.resetSources();
    this.lastFrame = performance.now();
    this.screensEl.innerHTML = this.screen === 'practice' ? Screens.practiceBar(this.usesController()) : '';
  }

  private checkDisconnect(): void {
    const lost: number[] = [];
    for (let i = 0; i < 2; i++) if (this.sources[i].kind === 'microbit' && this.statuses[i] === 'lost') lost.push(i);
    if (lost.length === 0) return;
    this.overlay = 'disconnect';
    this.keyboard.clear();
    this.audio.setPaused(true);
    this.screensEl.innerHTML = Screens.disconnectScreen(lost);
    this.backOnline = 0;
  }

  /* ------------------------------ input ------------------------------ */

  private onKey(code: string, e: KeyboardEvent): void {
    this.audio.unlock();
    if (code === 'Escape') {
      e.preventDefault();
      if (this.overlay === 'pause') this.closeOverlay();
      else if (this.overlay === 'none' && this.inMatch()) this.openPause();
      else if (this.screen === 'mode') this.toTitle();
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (this.screen === 'title') {
        this.showScreen('mode');
        e.preventDefault();
      } else if (this.screen === 'practice' && this.overlay === 'none') {
        e.preventDefault();
        this.startCountdown();
      }
    }
  }

  private onClick(e: Event): void {
    this.audio.unlock();
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!target || (target as HTMLButtonElement).disabled) return;
    const action = target.dataset.action;
    const player = Number(target.dataset.player ?? -1) as 0 | 1;
    this.audio.playClick();
    switch (action) {
      case 'title-start':
        this.showScreen('mode');
        break;
      case 'title-connect':
        e.stopPropagation();
        this.connectSerial(false);
        break;
      case 'to-title':
        this.toTitle();
        break;
      case 'to-mode':
        void this.serial.close();
        this.showScreen('mode');
        break;
      case 'mode-keyboard':
        this.useKeyboard(0);
        this.useKeyboard(1);
        this.sim.setActive(true, true);
        this.startPractice();
        break;
      case 'mode-solo':
        this.useKeyboard(1);
        this.sources[0] = this.soloKeyboard;
        this.soloKeyboard.reset();
        this.sim.setActive(true, false);
        this.startPractice();
        break;
      case 'mode-microbit':
        this.wantsHardware[0] = this.wantsHardware[1] = true;
        if (this.serial.isOpen) this.showLobby(-1);
        else this.showScreen('connect');
        break;
      case 'serial-connect':
        this.connectSerial(false);
        break;
      case 'serial-reconnect':
        this.connectSerial(true);
        break;
      case 'toggle-keyboard':
        this.wantsHardware[player] = !this.wantsHardware[player];
        this.refreshDynamicScreen();
        break;
      case 'connect-continue':
        this.beginCalibration('practice');
        break;
      case 'cal-retry':
        this.flows[player]?.restart();
        break;
      case 'cal-saved': {
        const saved = this.calibrations[player];
        const flow = this.flows[player];
        if (saved && flow) {
          Object.assign(flow.result, saved);
          flow.step = 'done';
        }
        break;
      }
      case 'cal-keyboard':
        this.wantsHardware[player] = false;
        this.flows[player] = null;
        this.showScreen('calibrate');
        break;
      case 'cal-continue':
        this.finishCalibration();
        break;
      case 'skip-practice':
        this.startCountdown();
        break;
      case 'resume':
        this.closeOverlay();
        break;
      case 'restart':
        this.closeOverlay();
        this.startCountdown();
        break;
      case 'recalibrate':
        this.wantsHardware[0] = this.sources[0].kind === 'microbit';
        this.wantsHardware[1] = this.sources[1].kind === 'microbit';
        this.overlay = 'none';
        this.audio.setPaused(false);
        this.beginCalibration('countdown');
        break;
      case 'disconnect-resume':
        this.closeOverlay();
        break;
      case 'switch-keyboard':
        this.useKeyboard(player);
        if (!this.sources.some((s, i) => s.kind === 'microbit' && this.sources[i].status(performance.now()) === 'lost')) this.closeOverlay();
        else this.screensEl.querySelector(`[data-action=switch-keyboard][data-player="${player}"]`)?.remove();
        break;
      case 'play-again':
        this.startCountdown();
        break;
      case 'lobby-start':
        if (this.joined[0] || this.joined[1]) this.startFromLobby();
        break;
      default:
        break;
    }
  }

  private onSettingInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.setting;
    if (!key) return;
    const i = Number(el.dataset.player ?? 0);
    const s = this.settings;
    switch (key) {
      case 'sensitivity':
        s.sensitivity[i] = Number(el.value);
        break;
      case 'invert':
        s.invertPitch[i] = el.checked;
        break;
      case 'volume':
        s.volume = Number(el.value);
        this.audio.setVolume(s.volume);
        break;
      case 'musicVolume':
        s.musicVolume = Number(el.value);
        this.audio.setMusicVolume(s.musicVolume);
        break;
      case 'reduceMotion':
        s.reduceMotion = el.checked;
        this.renderer.reducedMotion = el.checked;
        this.hud.setReducedMotion(el.checked);
        break;
      case 'lowQuality':
        s.lowQuality = el.checked;
        this.renderer.setLowQuality(el.checked);
        this.resize();
        break;
    }
    saveSettings(s);
  }

  private useKeyboard(i: 0 | 1): void {
    this.sources[i] = this.keyboardSources[i];
    this.wantsHardware[i] = false;
    this.sources[i].reset();
    this.sim.syncPresses(i, this.sources[i].sample(0, performance.now()).boostPresses);
  }

  /* ---------------------------- hardware ----------------------------- */

  private usesController(): boolean {
    return this.sources.some((s, i) => s.kind === 'microbit' && this.sim.active[i]);
  }

  /** Saved calibration if this browser has one, otherwise sensible defaults. */
  private controllerFor(i: 0 | 1): MicrobitSource {
    const cal = this.calibrations[i] ?? defaultCalibration();
    return new MicrobitSource(this.router.links[i], { ...cal });
  }

  private showLobby(joinedPlayer: number): void {
    this.joined[0] = joinedPlayer === 0;
    this.joined[1] = joinedPlayer === 1;
    this.showScreen('lobby');
  }

  private startFromLobby(): void {
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      if (this.joined[i]) this.sources[i] = this.controllerFor(i);
      else this.useKeyboard(i);
    }
    this.sim.setActive(this.joined[0], this.joined[1]);
    this.audio.playCheer(0.5);
    this.startPractice();
  }

  /**
   * Lets the whole game be driven from the controllers: A / B work as menu
   * buttons on the title, lobby, practice, results and disconnect screens.
   */
  private pollControllers(dt: number, now: number): void {
    const pressedA = [false, false];
    const pressedB = [false, false];
    const holdingAB = [false, false];
    for (let i = 0; i < 2; i++) {
      const link = this.router.links[i];
      const fresh = !!link.latest && link.ageMs(now) < 600;
      if (link.aTotal > this.menuA[i]) pressedA[i] = fresh;
      this.menuA[i] = link.aTotal;
      const b = fresh && !!link.latest?.buttonB;
      if (b && !this.menuB[i]) pressedB[i] = true;
      this.menuB[i] = b;
      holdingAB[i] = fresh && !!link.latest?.buttonA && b;
    }
    if (pressedA[0] || pressedA[1] || pressedB[0] || pressedB[1]) this.audio.unlock();
    const anyA = pressedA[0] || pressedA[1];

    if (this.overlay === 'disconnect') {
      const ok = this.sources.every((s) => s.kind !== 'microbit' || s.status(now) === 'ok');
      this.backOnline = ok ? this.backOnline + dt : 0;
      if (this.backOnline > 1) this.closeOverlay();
      return;
    }
    if (this.overlay !== 'none') return;

    switch (this.screen) {
      case 'title':
      case 'mode':
      case 'connect':
        if (anyA) this.showLobby(pressedA[0] ? 0 : 1);
        break;
      case 'lobby':
        for (let i = 0; i < 2; i++) if (pressedA[i]) this.joined[i] = true;
        for (let i = 0; i < 2; i++) {
          if (pressedB[i] && this.joined[i]) {
            this.startFromLobby();
            return;
          }
        }
        this.refreshLobby(now);
        break;
      case 'practice':
        if (holdingAB.some((h, i) => h && this.sim.active[i] && this.sources[i].kind === 'microbit')) {
          this.comboHold += dt;
          if (this.comboHold > 0.6) {
            this.comboHold = 0;
            this.startCountdown();
          }
        } else this.comboHold = 0;
        break;
      case 'results': {
        if (now - this.resultsShownAt < 1500) break;
        const mine = (arr: boolean[]) => arr.some((v, i) => v && this.sim.active[i]);
        if (mine(pressedA)) this.startCountdown();
        else if (mine(pressedB)) this.toTitle();
        break;
      }
      default:
        break;
    }
  }

  private refreshLobby(now: number): void {
    const q = (role: string) => this.screensEl.querySelector<HTMLElement>(`[data-role="${role}"]`);
    for (let i = 0; i < 2; i++) {
      const link = this.router.links[i];
      const seen = !!link.latest && link.ageMs(now) < 1000;
      const card = q(`j${i}`);
      card?.classList.toggle('joined', this.joined[i]);
      const st = q(`j${i}-state`);
      if (st) st.textContent = !seen ? STRINGS.lobbyNoSignal : this.joined[i] ? `✓ ${STRINGS.lobbyJoined}` : STRINGS.lobbyJoin;
      const dot = q(`j${i}-dot`);
      if (dot && link.latest) {
        const x = Math.max(-1, Math.min(1, link.latest.roll / 35)) * 34;
        const y = Math.max(-1, Math.min(1, link.latest.pitch / 35)) * 34;
        dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
    const start = q('lobby-start');
    if (start) {
      const n = (this.joined[0] ? 1 : 0) + (this.joined[1] ? 1 : 0);
      start.textContent = n === 0 ? '' : n === 1 ? STRINGS.lobbyStartSolo : STRINGS.lobbyStartDuo;
    }
  }

  private connectSerial(reconnect: boolean): void {
    const run = async () => {
      if (reconnect) {
        const ok = await this.serial.reconnect();
        if (ok) return;
      }
      await this.serial.connect();
    };
    run()
      .then(() => this.refreshDynamicScreen())
      .catch(() => this.refreshDynamicScreen());
  }

  private beginCalibration(next: 'practice' | 'countdown'): void {
    this.afterCalibration = next;
    for (let i = 0; i < 2; i++) this.flows[i] = this.wantsHardware[i] ? new CalibrationFlow(this.router.links[i]) : null;
    this.showScreen('calibrate');
  }

  private updateCalibration(now: number): void {
    if (this.screen !== 'calibrate') return;
    for (const f of this.flows) f?.update(now);
  }

  private finishCalibration(): void {
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      const flow = this.flows[i];
      if (this.wantsHardware[i] && flow && flow.step === 'done') {
        const cal = { ...flow.result };
        this.calibrations[i] = cal;
        const src = this.sources[i];
        if (src instanceof MicrobitSource) src.setCalibration(cal);
        else this.sources[i] = new MicrobitSource(this.router.links[i], cal);
      } else {
        this.useKeyboard(i);
      }
    }
    saveCalibrations(this.calibrations);
    if (this.afterCalibration === 'practice') this.startPractice();
    else this.startCountdown();
  }

  /** Updates live text on the connect / calibrate / disconnect screens. */
  private refreshDynamicScreen(): void {
    const q = (role: string) => this.screensEl.querySelector<HTMLElement>(`[data-role="${role}"]`);
    const now = performance.now();
    if (this.screen === 'connect' && this.overlay === 'none') {
      const st = q('serial-status');
      if (st) {
        const s = this.serial.state;
        st.textContent =
          s === 'open'
            ? STRINGS.connected
            : s === 'connecting'
              ? STRINGS.connecting
              : s === 'error'
                ? STRINGS.connectFailed(this.serial.lastError)
                : '';
        st.classList.toggle('error', s === 'error');
      }
      let ready = true;
      for (let i = 0; i < 2; i++) {
        const link = this.router.links[i];
        const seen = !!link.latest && link.ageMs(now) < 1000;
        const status = q(`p${i}-status`);
        const live = q(`p${i}-live`);
        const toggle = q(`p${i}-toggle`);
        if (status)
          status.textContent = this.wantsHardware[i] ? (seen ? `✓ ${STRINGS.controllerSeen}` : STRINGS.waitingForController) : `⌨ ${STRINGS.inputKeyboard}`;
        if (live) live.textContent = this.wantsHardware[i] && link.latest ? STRINGS.liveReadout(link.latest.pitch, link.latest.roll, link.latest.light) : '';
        if (toggle) toggle.textContent = this.wantsHardware[i] ? STRINGS.useKeyboardForPlayer : STRINGS.useControllerForPlayer;
        if (this.wantsHardware[i] && (!seen || !this.serial.isOpen)) ready = false;
      }
      const c = q('continue') as HTMLButtonElement | null;
      if (c) c.disabled = !ready;
    } else if (this.screen === 'calibrate' && this.overlay === 'none') {
      let allDone = true;
      for (let i = 0; i < 2; i++) {
        const flow = this.flows[i];
        if (!this.wantsHardware[i] || !flow) continue;
        if (flow.step !== 'done') allDone = false;
        const link = this.router.links[i];
        const steps = q(`c${i}-steps`);
        if (steps) steps.textContent = STRINGS.calStep(Math.min(5, flow.stepIndex + 1), 5);
        const text = q(`c${i}-text`);
        if (text) text.textContent = flow.instruction;
        const meter = q(`c${i}-meter`);
        if (meter) meter.style.width = `${Math.round((flow.sampling ? flow.progress : flow.step === 'done' ? 1 : 0) * 100)}%`;
        const err = q(`c${i}-error`);
        if (err)
          err.textContent =
            flow.step === 'failed' ? STRINGS.calLight(Math.round(flow.result.lightOpen), Math.round(flow.result.lightCovered)) : flow.error;
        const live = q(`c${i}-live`);
        if (live)
          live.textContent = link.latest
            ? STRINGS.liveReadout(link.latest.pitch, link.latest.roll, link.latest.light)
            : STRINGS.waitingForController;
      }
      const c = q('continue') as HTMLButtonElement | null;
      if (c) c.disabled = !allDone;
    } else if (this.overlay === 'disconnect') {
      const ok = this.sources.every((s, i) => s.kind !== 'microbit' || this.sources[i].status(now) !== 'lost');
      const r = q('resume') as HTMLButtonElement | null;
      if (r) r.disabled = !ok;
    }
  }

  /** Test/debug handle (read-mostly). */
  debugInfo(): Record<string, unknown> {
    return {
      screen: this.screen,
      overlay: this.overlay,
      phase: this.sim.phase,
      loops: this.loopCount,
      scores: this.sim.players.map((p) => p.score),
    };
  }
}
