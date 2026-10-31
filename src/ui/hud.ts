import { CONFIG, PLAYER_CSS_COLORS } from '../config';
import type { Simulation } from '../game/simulation';
import type { SourceStatus } from '../input/types';
import type { ViewInfo } from '../render/renderer';
import { STRINGS } from '../strings';

interface HalfRefs {
  root: HTMLElement;
  pips: HTMLElement[];
  dayChip: HTMLElement;
  inputChip: HTMLElement;
  boothChip: HTMLElement;
  boostChip: HTMLElement;
  spell: HTMLElement;
  msg: HTMLElement;
  boundary: HTMLElement;
  reticle: HTMLElement;
  reticleLabel: HTMLElement;
  practice: HTMLElement;
  practiceItems: HTMLElement[];
  msgTimer: number;
}

/** Writes text only when it changed (keeps DOM work per frame tiny). */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
function setClass(el: HTMLElement, cls: string, on: boolean): void {
  if (el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export class Hud {
  private readonly halves: [HalfRefs, HalfRefs];
  private readonly timer: HTMLElement;
  private readonly timerSub: HTMLElement;
  private readonly center: HTMLElement;
  private readonly banner: HTMLElement;
  private centerTimer = 0;
  private bannerTimer = 0;
  private bannerSticky = '';
  private readonly keyHints: [string, string];

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = '';
    this.keyHints = [STRINGS.keysP1, STRINGS.keysP2];
    this.halves = [this.buildHalf(0), this.buildHalf(1)];
    const divider = document.createElement('div');
    divider.className = 'hud-divider';
    root.appendChild(divider);
    const top = document.createElement('div');
    top.className = 'hud-top';
    this.timer = document.createElement('span');
    this.timerSub = document.createElement('small');
    top.append(this.timer, this.timerSub);
    root.appendChild(top);
    this.center = div('hud-center');
    this.banner = div('hud-banner');
    root.append(this.center, this.banner);
  }

  private buildHalf(i: 0 | 1): HalfRefs {
    const root = div(`hud-half p${i + 1}`);
    const card = div('hud-card');
    const name = div('hud-name');
    const sw = div('hud-swatch');
    sw.style.background = PLAYER_CSS_COLORS[i];
    name.append(sw, document.createTextNode(STRINGS.playerName(i)));
    const score = div('hud-score');
    const pips: HTMLElement[] = [];
    for (let k = 0; k < CONFIG.match.catchesToWin; k++) {
      const pip = div('pip');
      pips.push(pip);
      score.appendChild(pip);
    }
    const row = div('hud-row');
    const dayChip = span('chip day');
    const inputChip = span('chip ok');
    const boostChip = span('chip ok');
    const boothChip = span('chip booth');
    boothChip.style.display = 'none';
    row.append(dayChip, boostChip, inputChip, boothChip);
    card.append(name, score, row);
    const spell = div('hud-spell');
    const msg = div('hud-msg');
    const boundary = div('hud-boundary');
    boundary.textContent = STRINGS.boundary;
    const reticle = div('reticle');
    const reticleLabel = div('reticle-label');
    reticleLabel.textContent = STRINGS.catchPrompt;
    const practice = div('hud-practice');
    const title = document.createElement('strong');
    title.textContent = STRINGS.tutorialTitle;
    const ul = document.createElement('ul');
    const items = [STRINGS.tutorialTurn, STRINGS.tutorialAltitude, STRINGS.tutorialDark, STRINGS.tutorialCatch].map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      ul.appendChild(li);
      return li;
    });
    const keys = div('hud-keys');
    keys.dataset.role = 'keys';
    practice.append(title, ul, keys);
    root.append(card, spell, msg, boundary, reticle, reticleLabel, practice);
    this.root.appendChild(root);
    return {
      root,
      pips,
      dayChip,
      inputChip,
      boothChip,
      boostChip,
      spell,
      msg,
      boundary,
      reticle,
      reticleLabel,
      practice,
      practiceItems: items,
      msgTimer: 0,
    };
  }

  show(on: boolean): void {
    setClass(this.root, 'on', on);
  }

  setReducedMotion(on: boolean): void {
    setClass(document.body, 'reduce-motion', on);
  }

  message(i: 0 | 1, text: string, seconds = 2): void {
    const h = this.halves[i];
    h.msg.textContent = text;
    h.msgTimer = seconds;
  }

  centerText(text: string, seconds: number): void {
    this.center.textContent = text;
    this.centerTimer = seconds;
  }

  bannerText(text: string, seconds: number): void {
    this.banner.textContent = text;
    this.bannerTimer = seconds;
  }

  /** A banner that stays until cleared (e.g. overtime). */
  setStickyBanner(text: string): void {
    this.bannerSticky = text;
  }

  reset(): void {
    for (const h of this.halves) h.msgTimer = 0;
    this.centerTimer = 0;
    this.bannerTimer = 0;
    this.bannerSticky = '';
  }

  update(
    sim: Simulation,
    dt: number,
    status: [SourceStatus, SourceStatus],
    kinds: [string, string],
    views: [ViewInfo, ViewInfo],
  ): void {
    const solo = sim.singlePlayer ? sim.soloIndex : -1;
    setClass(this.root, 'single', solo >= 0);
    this.halves[0].root.style.display = solo === 1 ? 'none' : '';
    this.halves[1].root.style.display = solo === 0 ? 'none' : '';
    const t = Math.ceil(sim.timeLeft);
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    setText(this.timer, sim.overtime ? '∞' : `${mm}:${ss}`);
    setText(this.timerSub, sim.overtime ? STRINGS.overtimeShort : sim.phase === 'practice' ? STRINGS.practiceShort : '');

    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      const p = sim.players[i];
      const h = this.halves[i];
      h.pips.forEach((pip, k) => setClass(pip, 'on', k < p.score));
      setText(h.dayChip, p.dark ? `☾ ${STRINGS.night}` : `☀ ${STRINGS.day}`);
      setClass(h.dayChip, 'night', p.dark);
      setClass(h.dayChip, 'day', !p.dark);

      setText(h.boostChip, p.boostCooldown > 0 ? STRINGS.boostWait(Math.ceil(p.boostCooldown)) : `» ${STRINGS.boostReady}`);
      setClass(h.boostChip, 'ok', p.boostCooldown <= 0);
      const st = status[i];
      const label =
        kinds[i] === 'keyboard'
          ? STRINGS.inputKeyboard
          : st === 'ok'
            ? STRINGS.inputMicrobitOk
            : st === 'weak' || st === 'stale'
              ? STRINGS.inputMicrobitWeak
              : STRINGS.inputMicrobitLost;
      setText(h.inputChip, label);
      setClass(h.inputChip, 'ok', kinds[i] === 'keyboard' || st === 'ok');
      setClass(h.inputChip, 'warn', kinds[i] !== 'keyboard' && (st === 'weak' || st === 'stale'));
      setClass(h.inputChip, 'bad', kinds[i] !== 'keyboard' && st === 'lost');

      // Booth status appears only after the first discovery.
      const d = sim.dumbledore;
      if (d.discovered && sim.phase === 'playing') {
        h.boothChip.style.display = '';
        const txt = d.caster === i && d.attached
          ? STRINGS.dumbledoreRiding
          : d.usedBy[i]
          ? STRINGS.dumbledoreUsed
          : d.cooldown > 0
            ? STRINGS.dumbledoreCooldown(Math.ceil(d.cooldown))
            : STRINGS.dumbledoreReady;
        setText(h.boothChip, `✦ ${txt}`);
      } else h.boothChip.style.display = 'none';

      const crazy = p.crazyTime > 0;
      setClass(h.spell, 'on', crazy);
      if (crazy) setText(h.spell, `${STRINGS.crazyBroom} ${Math.ceil(p.crazyTime)}`);

      if (h.msgTimer > 0) h.msgTimer -= dt;
      setClass(h.msg, 'on', h.msgTimer > 0);
      setClass(h.boundary, 'on', p.nearBoundary);

      const ret = views[i].reticle;
      const catchable = !!ret;
      setClass(h.reticle, 'catch', catchable);
      setClass(h.reticleLabel, 'on', catchable);
      if (ret) {
        h.reticle.style.left = `${ret.x}px`;
        h.reticle.style.top = `${ret.y}px`;
        h.reticleLabel.style.left = `${ret.x}px`;
        h.reticleLabel.style.top = `${ret.y}px`;
      } else {
        h.reticle.style.left = `${Math.round(views[i].aim.x)}px`;
        h.reticle.style.top = `${Math.round(views[i].aim.y)}px`;
      }

      const practicing = sim.phase === 'practice';
      setClass(h.practice, 'on', practicing);
      if (practicing) {
        const pr = sim.practice[i];
        setClass(h.practiceItems[0], 'done', pr.left && pr.right);
        setClass(h.practiceItems[1], 'done', pr.climb && pr.dive);
        setClass(h.practiceItems[2], 'done', pr.dark && pr.light);
        setClass(h.practiceItems[3], 'done', pr.boost);
        const keys = h.practice.querySelector<HTMLElement>('[data-role=keys]');
        if (keys) setText(keys, kinds[i] === 'keyboard' ? this.keyHints[i] : STRINGS.controllerHint);
      }
    }

    if (this.centerTimer > 0) this.centerTimer -= dt;
    setClass(this.center, 'on', this.centerTimer > 0);
    if (this.bannerTimer > 0) this.bannerTimer -= dt;
    if (this.bannerTimer <= 0 && this.bannerSticky) setText(this.banner, this.bannerSticky);
    setClass(this.banner, 'on', this.bannerTimer > 0 || !!this.bannerSticky);
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
function span(cls: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  return s;
}
