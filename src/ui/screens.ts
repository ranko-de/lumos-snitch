import { CONFIG, PLAYER_CSS_COLORS } from '../config';
import type { Settings } from '../settings';
import { STRINGS } from '../strings';

/** HTML templates for menu screens. All actions use data-action attributes. */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function titleScreen(controllerReady: boolean, canConnect: boolean): string {
  return `
  <div class="screen title" data-action="title-start">
    <h1>${esc(STRINGS.title)}</h1>
    <div class="subtitle">${esc(STRINGS.subtitle)}</div>
    <p class="blink">${esc(STRINGS.pressToStart)}</p>
    ${controllerReady ? `<p class="ctrl-hint" data-role="ctrl-hint">${esc(STRINGS.titleControllerReady)}</p>` : ''}
    ${!controllerReady && canConnect ? `<button class="btn secondary" data-action="title-connect">${esc(STRINGS.titleConnect)}</button>` : ''}
    <p class="fan">${esc(STRINGS.fanNotice)}</p>
  </div>`;
}

export function lobbyScreen(): string {
  const card = (i: number) => `
    <div class="join-card" style="--pc:${PLAYER_CSS_COLORS[i]}" data-role="j${i}">
      <h3>${esc(STRINGS.playerName(i))}</h3>
      <div class="join-state" data-role="j${i}-state">${esc(STRINGS.lobbyJoin)}</div>
      <div class="tilt-dot"><i data-role="j${i}-dot"></i></div>
    </div>`;
  return `
  <div class="screen">
    <h2>${esc(STRINGS.lobbyTitle)}</h2>
    <p>${esc(STRINGS.lobbyHint)}</p>
    <div class="join-grid">${card(0)}${card(1)}</div>
    <p class="big-hint" data-role="lobby-start"></p>
    <button class="btn secondary" data-action="to-title">${esc(STRINGS.back)}</button>
  </div>`;
}

export function modeScreen(serialSupported: boolean): string {
  return `
  <div class="screen">
    <h2>${esc(STRINGS.chooseMode)}</h2>
    <div class="modes">
      <button class="mode" data-action="mode-keyboard" autofocus>
        <strong>⌨ ${esc(STRINGS.modeKeyboard)}</strong>
        <span>${esc(STRINGS.modeKeyboardHint)}</span>
      </button>
      <button class="mode" data-action="mode-solo">
        <strong>🧹 ${esc(STRINGS.modeSolo)}</strong>
        <span>${esc(STRINGS.modeSoloHint)}</span>
      </button>
      <button class="mode" data-action="mode-microbit" ${serialSupported ? '' : 'disabled'}>
        <strong>📡 ${esc(STRINGS.modeMicrobit)}</strong>
        <span>${esc(STRINGS.modeMicrobitHint)}</span>
      </button>
    </div>
    ${serialSupported ? '' : `<p class="note">${esc(STRINGS.webSerialMissing)}</p>`}
    ${keysTable()}
    <button class="btn secondary" data-action="to-title">${esc(STRINGS.back)}</button>
  </div>`;
}

function keysTable(): string {
  return `<div class="keys-table">
    <div><b style="color:${PLAYER_CSS_COLORS[0]}">${esc(STRINGS.playerName(0))}</b><br>
      <kbd>A</kbd>/<kbd>D</kbd> turn · <kbd>W</kbd> dive · <kbd>S</kbd> climb<br>
      <kbd>F</kbd> boost · <kbd>G</kbd> brake · <kbd>R</kbd> day/night</div>
    <div><b style="color:${PLAYER_CSS_COLORS[1]}">${esc(STRINGS.playerName(1))}</b><br>
      <kbd>←</kbd>/<kbd>→</kbd> turn · <kbd>↑</kbd> dive · <kbd>↓</kbd> climb<br>
      <kbd>K</kbd> boost · <kbd>L</kbd> brake · <kbd>O</kbd> day/night</div>
  </div>
  <p class="steps">${esc(STRINGS.catchHowTo)} · <kbd>Esc</kbd> pause</p>`;
}

export function connectScreen(): string {
  const card = (i: number) => `
    <div class="pcard" style="--pc:${PLAYER_CSS_COLORS[i]}">
      <h3>${esc(STRINGS.playerName(i))}</h3>
      <div class="status" data-role="p${i}-status">${esc(STRINGS.waitingForController)}</div>
      <div class="live" data-role="p${i}-live"></div>
      <button class="btn secondary" data-action="toggle-keyboard" data-player="${i}" data-role="p${i}-toggle">${esc(STRINGS.useKeyboardForPlayer)}</button>
    </div>`;
  return `
  <div class="screen">
    <h2>${esc(STRINGS.connectTitle)}</h2>
    <p>${esc(STRINGS.connectHint)}</p>
    <button class="btn" data-action="serial-connect">${esc(STRINGS.connectButton)}</button>
    <p class="status" data-role="serial-status"></p>
    <div class="players">${card(0)}${card(1)}</div>
    <button class="btn secondary" data-action="to-mode">${esc(STRINGS.back)}</button>
    <button class="btn" data-action="connect-continue" data-role="continue" disabled>${esc(STRINGS.continue)}</button>
  </div>`;
}

export function calibrateScreen(hardware: [boolean, boolean], hasSaved: [boolean, boolean]): string {
  const card = (i: number) => {
    if (!hardware[i])
      return `<div class="pcard" style="--pc:${PLAYER_CSS_COLORS[i]}"><h3>${esc(STRINGS.playerName(i))}</h3>
        <p class="status">${esc(STRINGS.inputKeyboard)} ✓</p></div>`;
    return `
    <div class="pcard" style="--pc:${PLAYER_CSS_COLORS[i]}">
      <h3>${esc(STRINGS.playerName(i))}</h3>
      <div class="steps" data-role="c${i}-steps"></div>
      <div class="big-instruction" data-role="c${i}-text"></div>
      <div class="meter"><i data-role="c${i}-meter"></i></div>
      <div class="status error" data-role="c${i}-error"></div>
      <div class="live" data-role="c${i}-live"></div>
      <button class="btn secondary" data-action="cal-retry" data-player="${i}">${esc(STRINGS.calRetry)}</button>
      ${hasSaved[i] ? `<button class="btn secondary" data-action="cal-saved" data-player="${i}">${esc(STRINGS.calUseSaved)}</button>` : ''}
      <button class="btn secondary" data-action="cal-keyboard" data-player="${i}">${esc(STRINGS.useKeyboardForPlayer)}</button>
    </div>`;
  };
  return `
  <div class="screen">
    <h2>${esc(STRINGS.calTitle)}</h2>
    <p>${esc(STRINGS.calGrip)}</p>
    <div class="players">${card(0)}${card(1)}</div>
    <button class="btn" data-action="cal-continue" data-role="continue" disabled>${esc(STRINGS.continue)}</button>
  </div>`;
}

export function practiceBar(controller = false): string {
  return `<div class="screen practice-bar"><button class="btn" data-action="skip-practice">${esc(STRINGS.tutorialSkip)}</button>${controller ? `<p class="ctrl-hint">${esc(STRINGS.practiceSkipController)}</p>` : ''}</div>`;
}

export function pauseScreen(s: Settings, hasHardware: boolean): string {
  const sens = (i: number) => `
    <label for="sens${i}">${esc(STRINGS.sensitivity(i))}</label>
    <input id="sens${i}" type="range" min="${CONFIG.input.minSensitivity}" max="${CONFIG.input.maxSensitivity}" step="0.05"
      value="${s.sensitivity[i]}" data-setting="sensitivity" data-player="${i}">
    <label for="inv${i}">${esc(STRINGS.invertPitch(i))}</label>
    <input id="inv${i}" type="checkbox" ${s.invertPitch[i] ? 'checked' : ''} data-setting="invert" data-player="${i}">`;
  return `
  <div class="screen">
    <h2>${esc(STRINGS.pauseTitle)}</h2>
    <div>
      <button class="btn" data-action="resume" autofocus>${esc(STRINGS.resume)}</button>
      <button class="btn secondary" data-action="restart">${esc(STRINGS.restart)}</button>
      <button class="btn secondary" data-action="to-title">${esc(STRINGS.mainMenu)}</button>
    </div>
    <div class="settings">
      ${sens(0)}${sens(1)}
      <label for="vol">${esc(STRINGS.volume)}</label>
      <input id="vol" type="range" min="0" max="1" step="0.05" value="${s.volume}" data-setting="volume">
      <label for="mus">${esc(STRINGS.musicVolume)}</label>
      <input id="mus" type="range" min="0" max="1" step="0.05" value="${s.musicVolume}" data-setting="musicVolume">
      <label for="rm">${esc(STRINGS.reduceMotion)}</label>
      <input id="rm" type="checkbox" ${s.reduceMotion ? 'checked' : ''} data-setting="reduceMotion">
      <label for="lq">${esc(STRINGS.lowQuality)}</label>
      <input id="lq" type="checkbox" ${s.lowQuality ? 'checked' : ''} data-setting="lowQuality">
    </div>
    ${hasHardware ? `<button class="btn secondary" data-action="recalibrate">${esc(STRINGS.recalibrate)}</button>` : ''}
    <p class="steps">${esc(STRINGS.pauseHint)}</p>
  </div>`;
}

export function disconnectScreen(lost: number[]): string {
  const names = lost.map((i) => STRINGS.playerName(i)).join(' & ');
  return `
  <div class="screen">
    <h2>${esc(STRINGS.disconnectTitle)}</h2>
    <p>${esc(STRINGS.disconnectBody(names))}</p>
    <button class="btn" data-action="disconnect-resume" data-role="resume" disabled>${esc(STRINGS.resume)}</button>
    <button class="btn secondary" data-action="serial-reconnect">${esc(STRINGS.reconnect)}</button>
    ${lost.map((i) => `<button class="btn secondary" data-action="switch-keyboard" data-player="${i}">${esc(STRINGS.switchToKeyboard(i))}</button>`).join('')}
    <p class="steps" data-role="disc-status">${esc(STRINGS.waitAndResume)}</p>
  </div>`;
}

export function resultsScreen(scores: [number, number], winner: number, solo: number, controller: boolean): string {
  const ctrl = controller ? `<p class="ctrl-hint">${esc(STRINGS.resultsController)}</p>` : '';
  if (solo >= 0) {
    const n = scores[solo];
    const won = n >= CONFIG.match.catchesToWin;
    return `
  <div class="screen">
    <h2>${esc(STRINGS.resultsTitle)}</h2>
    <div class="result-score"><span class="${solo === 0 ? 'a' : 'b'}">${n}</span> / ${CONFIG.match.catchesToWin}</div>
    <p style="font-size:24px;color:#fff;font-family:var(--display)">${esc(STRINGS.soloResult(n))} — ${esc(won ? STRINGS.soloWin : STRINGS.soloTry)}</p>
    <button class="btn" data-action="play-again" autofocus>${esc(STRINGS.playAgain)}</button>
    <button class="btn secondary" data-action="to-title">${esc(STRINGS.mainMenu)}</button>
    ${ctrl}
  </div>`;
  }
  const title = winner < 0 ? STRINGS.draw : STRINGS.winner(STRINGS.playerName(winner));
  return `
  <div class="screen">
    <h2>${esc(STRINGS.resultsTitle)}</h2>
    <div class="result-score"><span class="a">${scores[0]}</span> – <span class="b">${scores[1]}</span></div>
    <p style="font-size:24px;color:${winner < 0 ? '#fff' : PLAYER_CSS_COLORS[winner]};font-family:var(--display)">${esc(title)}</p>
    <button class="btn" data-action="play-again" autofocus>${esc(STRINGS.playAgain)}</button>
    <button class="btn secondary" data-action="to-title">${esc(STRINGS.mainMenu)}</button>
    ${ctrl}
  </div>`;
}
