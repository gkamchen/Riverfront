import type { AbilityStatus, PlayerId, RoleCount, RoleId, SpecialStatus } from '@riverfront/core';
import type { ViewPreset } from '../camera/cameraRig';
import { h, html, relabel, replay, setText } from './dom';
import { icon, type IconName } from './icons';
import { roleName, t, type TextKey } from './i18n';
import { layoutMode, toastOnTop, type LayoutMode, type Rect } from './layout';

export type MessageTone = 'info' | 'good' | 'bad' | 'neutral' | 'warn';
export type HudPhase = 'menu' | 'placing' | 'waiting' | 'playing' | 'ended';

export interface HudActions {
  openSettings(anchor: HTMLElement): void;
  togglePause(): void;
  goHome(): void;
  showHelp(): void;
  setView(preset: ViewPreset): void;
  rotateView(): void;
  aimMode(): void;
  restart(): void;
  surrender(): void;
  pickPiece(slot: number): void;
  placeRotate(): void;
  placeAuto(): void;
  placeClear(): void;
  placeConfirm(): void;
  selectAbility(id: AbilityStatus['id']): void;
  selectSpecial(): void;
  toggleAxis(): void;
  cancelTarget(): void;
  fire(): void;
  toggleHeat(): void;
  openSocial(anchor: HTMLElement): void;
  toggleMute(): void;
}

export interface TeamInfo {
  readonly name: string;
  readonly colour: string;
  readonly faction: string | null;
}

export interface LogLine {
  readonly text: string;
  /** ✓ ✗ ◆ ⛨ ... so results never rely on colour alone. */
  readonly glyph: string;
  readonly tone: MessageTone;
  readonly mine: boolean;
}

export interface PlacementTrayItem {
  readonly slot: number;
  readonly role: RoleId;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
  readonly placed: boolean;
  readonly held: boolean;
  readonly issue: string | null;
}

export interface ActionBarState {
  readonly energy: number;
  readonly energyMax: number;
  readonly abilities: readonly AbilityStatus[];
  readonly special: SpecialStatus | null;
  readonly selected: string | null;
  readonly enabled: boolean;
  readonly powers: boolean;
}

const VIEW_KEYS: ReadonlyArray<[ViewPreset, TextKey, string]> = [
  ['default', 'view.default', '1'],
  ['top', 'view.top', '2'],
  ['side', 'view.side', '3'],
];

const ABILITY_ICONS: Readonly<Record<AbilityStatus['id'], IconName>> = {
  radar: 'radar',
  bomb: 'bomb',
  shield: 'shield',
  repair: 'repair',
  spy: 'spy',
};

function iconButton(name: IconName, label: TextKey, className: string, onclick: (event: Event) => void): HTMLButtonElement {
  // Visible icon, text for assistive tech in an sr-only span (no aria-label hiding visible values).
  const button = h('button', { type: 'button', class: `icon-btn ${className}`, i18nTitle: label, onclick });
  button.innerHTML = icon(name);
  button.append(h('span', { class: 'sr-only', i18n: label }));
  return button;
}

/** Mini drawing of a piece footprint for the placement tray. */
function shapeSvg(cells: readonly { col: number; row: number }[]): string {
  const w = Math.max(...cells.map((c) => c.col)) + 1;
  const hgt = Math.max(...cells.map((c) => c.row)) + 1;
  const s = 9;
  const rects = cells.map((c) => `<rect x="${c.col * s + 1}" y="${c.row * s + 1}" width="${s - 2}" height="${s - 2}" rx="1.5"/>`).join('');
  return `<svg class="shape" viewBox="0 0 ${w * s} ${hgt * s}" width="${w * s}" height="${hgt * s}" aria-hidden="true">${rects}</svg>`;
}

/**
 * The in-game overlay. A CSS grid with named areas (menu, top, status, left,
 * stage, right, bottom, actions) so panels never overlap; the free "stage"
 * cell is measured to frame the board with the camera.
 */
export class Hud {
  readonly root: HTMLElement;
  readonly stage: HTMLElement;
  readonly #actions: HudActions;
  readonly #message: HTMLElement;
  readonly #toasts: HTMLElement;
  readonly #banner: HTMLElement;
  readonly #netBanner: HTMLElement;
  readonly #tooltip: HTMLElement;
  readonly #announcer: HTMLElement;
  readonly #teams: Record<'own' | 'enemy', { root: HTMLElement; name: HTMLElement; faction: HTMLElement; count: HTMLElement; bar: HTMLElement; strikes: HTMLElement }>;
  readonly #turnLabel: HTMLElement;
  readonly #clock: HTMLElement;
  readonly #clockValue: HTMLElement;
  readonly #clockNote: HTMLElement;
  readonly #log: HTMLDetailsElement;
  readonly #logList: HTMLOListElement;
  readonly #intel: HTMLElement;
  readonly #fleet: HTMLElement;
  readonly #coach: HTMLElement;
  readonly #notes: HTMLElement;
  readonly #speech: HTMLElement;
  readonly #tray: HTMLElement;
  readonly #trayList: HTMLElement;
  readonly #trayStatus: HTMLElement;
  readonly #confirmPlace: HTMLButtonElement;
  readonly #actionBar: HTMLElement;
  readonly #energy: HTMLElement;
  readonly #abilityButtons = new Map<string, HTMLButtonElement>();
  readonly #special: HTMLButtonElement;
  readonly #targetBar: HTMLElement;
  readonly #targetText: HTMLElement;
  readonly #axisButton: HTMLButtonElement;
  readonly #fireButton: HTMLButtonElement;
  readonly #views = new Map<ViewPreset, HTMLButtonElement>();
  readonly #pauseButton: HTMLButtonElement;
  readonly #heatButton: HTMLButtonElement;
  readonly #net: HTMLElement;
  readonly #muteButton: HTMLButtonElement;
  readonly #socialButton: HTMLButtonElement;
  readonly #pauseOverlay: HTMLElement;
  #layout: LayoutMode = 'wide';
  #toastTimer = 0;
  #bannerTimer = 0;

  constructor(host: HTMLElement, actions: HudActions) {
    this.#actions = actions;
    this.root = h('div', { class: 'hud', 'data-phase': 'menu' });
    host.append(this.root);

    // ---- menu area (top left)
    this.#pauseButton = iconButton('pause', 'hud.pause', 'pause-btn', () => actions.togglePause());
    const menu = h(
      'nav',
      { class: 'hud-area area-menu panel', i18nAria: 'hud.menuLabel' },
      iconButton('gear', 'hud.settings', 'gear-btn', (e) => actions.openSettings(e.currentTarget as HTMLElement)),
      this.#pauseButton,
      iconButton('home', 'hud.home', 'home-btn', () => actions.goHome()),
      iconButton('help', 'hud.help', 'help-btn', () => actions.showHelp()),
    );

    // ---- scoreboard (top)
    const team = (side: 'own' | 'enemy') => {
      const root = h('div', { class: `team team-${side}` });
      const name = h('span', { class: 'team-name' });
      const faction = h('span', { class: 'team-faction' });
      const count = h('span', { class: 'team-count' });
      const bar = h('span', { class: 'team-bar', 'aria-hidden': 'true' }, h('span'));
      const strikes = h('span', { class: 'team-strikes' });
      root.append(h('span', { class: 'team-dot', 'aria-hidden': 'true' }), h('span', { class: 'team-text' }, name, faction), count, bar, strikes);
      return { root, name, faction, count, bar, strikes };
    };
    this.#teams = { own: team('own'), enemy: team('enemy') };
    this.#turnLabel = h('span', { class: 'turn-label' });
    this.#clockValue = h('span', { class: 'clock-value' });
    this.#clockNote = h('span', { class: 'clock-note' });
    this.#clock = h('div', { class: 'clock', role: 'timer', 'aria-live': 'off' }, this.#clockValue, this.#clockNote);
    const top = h(
      'header',
      { class: 'hud-area area-top scoreboard panel' },
      this.#teams.own.root,
      h('div', { class: 'score-centre' }, this.#turnLabel, this.#clock),
      this.#teams.enemy.root,
    );

    // ---- status (top right)
    this.#net = h('span', { class: 'net-status', role: 'status' });
    this.#socialButton = iconButton('smile', 'hud.social', 'social-btn', (e) => actions.openSocial(e.currentTarget as HTMLElement));
    this.#muteButton = iconButton('chat', 'hud.mute', 'mute-btn', () => actions.toggleMute());
    this.#heatButton = iconButton('heat', 'hud.heat', 'heat-btn', () => actions.toggleHeat());
    const status = h(
      'div',
      { class: 'hud-area area-status panel' },
      this.#net,
      this.#heatButton,
      this.#socialButton,
      this.#muteButton,
      iconButton('log', 'hud.log', 'drawer-btn log-btn', () => this.toggleDrawer('log')),
      iconButton('info', 'hud.intel', 'drawer-btn intel-btn', () => this.toggleDrawer('intel')),
    );

    // ---- shot log (left)
    this.#logList = h('ol', { class: 'log-list', 'aria-live': 'polite' });
    this.#log = h('details', { class: 'hud-area area-left panel shot-log', open: true }, h('summary', { i18n: 'hud.log' }), this.#logList);

    // ---- intel (right)
    this.#fleet = h('ul', { class: 'fleet' });
    this.#coach = h('p', { class: 'coach', hidden: true });
    this.#notes = h('ul', { class: 'notes' });
    this.#speech = h('div', { class: 'speech', hidden: true, 'aria-live': 'polite' });
    this.#intel = h(
      'aside',
      { class: 'hud-area area-right panel intel' },
      h('h2', { class: 'panel-title', i18n: 'hud.enemyFleet' }),
      this.#fleet,
      this.#notes,
      this.#coach,
      this.#speech,
    );

    this.stage = h('div', { class: 'hud-stage', 'aria-hidden': 'true' });

    // ---- bottom: message, placement tray, targeting
    this.#message = h('div', { class: 'message', role: 'status', 'aria-live': 'polite' });
    this.#trayList = h('div', { class: 'tray-list', role: 'listbox', i18nAria: 'place.pieces' });
    this.#trayStatus = h('p', { class: 'tray-status' });
    this.#confirmPlace = h('button', { type: 'button', class: 'primary big', i18n: 'place.confirm', onclick: () => actions.placeConfirm() });
    this.#tray = h(
      'section',
      { class: 'tray panel', hidden: true },
      h('div', { class: 'tray-head' }, h('h2', { class: 'panel-title', i18n: 'place.title' }), this.#trayStatus),
      this.#trayList,
      h(
        'div',
        { class: 'tray-actions' },
        this.#withIcon('rotate', 'place.rotate', () => actions.placeRotate()),
        this.#withIcon('dice', 'place.auto', () => actions.placeAuto()),
        this.#withIcon('trash', 'place.clear', () => actions.placeClear()),
        this.#confirmPlace,
      ),
    );
    this.#targetText = h('span', { class: 'target-text' });
    this.#axisButton = h('button', { type: 'button', class: 'chip', i18n: 'target.axisRow', onclick: () => actions.toggleAxis() });
    this.#fireButton = h('button', { type: 'button', class: 'primary big fire-btn', i18n: 'target.fire', hidden: true, onclick: () => actions.fire() });
    this.#targetBar = h(
      'div',
      { class: 'target-bar panel', hidden: true },
      this.#targetText,
      this.#axisButton,
      h('button', { type: 'button', class: 'chip', i18n: 'target.cancel', onclick: () => actions.cancelTarget() }),
    );
    const bottom = h('div', { class: 'hud-area area-bottom' }, this.#targetBar, this.#fireButton, this.#message, this.#tray);

    // ---- actions (bottom right): energy, abilities, special, views
    this.#energy = h('div', { class: 'energy', role: 'meter', 'aria-valuemin': '0' });
    const abilities = h('div', { class: 'abilities', role: 'group', i18nAria: 'hud.abilities' });
    for (const id of ['radar', 'bomb', 'shield', 'repair', 'spy'] as const) {
      const button = h('button', { type: 'button', class: 'ability', 'data-ability': id, onclick: () => actions.selectAbility(id) });
      button.innerHTML = `${icon(ABILITY_ICONS[id])}<span class="ability-name"></span><span class="ability-cost"></span><span class="ability-cd" aria-hidden="true"></span><span class="sr-only ability-state"></span>`;
      this.#abilityButtons.set(id, button);
      abilities.append(button);
    }
    this.#special = h('button', { type: 'button', class: 'ability special', onclick: () => actions.selectSpecial() });
    this.#special.innerHTML = `${icon('star')}<span class="ability-name"></span><span class="ability-cost"></span><span class="ability-cd" aria-hidden="true"></span><span class="sr-only ability-state"></span>`;
    abilities.append(this.#special);
    this.#actionBar = h('div', { class: 'action-bar' }, this.#energy, abilities);

    const views = h('div', { class: 'hud-area area-views panel views', role: 'group', i18nAria: 'view.label' });
    for (const [preset, label, key] of VIEW_KEYS) {
      const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': String(preset === 'default'), onclick: () => actions.setView(preset) });
      button.append(h('span', { i18n: label }), h('kbd', { 'aria-hidden': 'true' }, key));
      this.#views.set(preset, button);
      views.append(button);
    }
    views.append(iconButton('rotate', 'view.rotate', 'chip rotate', () => actions.rotateView()));
    views.append(iconButton('target', 'view.aim', 'chip aim', () => actions.aimMode()));
    const actionsArea = h('div', { class: 'hud-area area-actions panel' }, this.#actionBar);

    // ---- floating layers
    this.#toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });
    this.#banner = h('div', { class: 'turn-banner', 'aria-hidden': 'true' });
    this.#netBanner = h('div', { class: 'net-banner', role: 'alert', hidden: true });
    this.#tooltip = h('div', { class: 'cell-tip', 'aria-hidden': 'true', hidden: true });
    this.#announcer = h('div', { class: 'sr-only', 'aria-live': 'assertive' });
    this.#pauseOverlay = h(
      'div',
      { class: 'pause-overlay', hidden: true },
      h(
        'div',
        { class: 'pause-card panel', role: 'dialog', 'aria-modal': 'false', i18nAria: 'pause.title' },
        h('p', { class: 'pause-title', i18n: 'pause.title' }),
        h('p', { class: 'pause-hint', i18n: 'pause.hint' }),
        h('button', { type: 'button', class: 'primary big', i18n: 'pause.resume', onclick: () => actions.togglePause() }),
      ),
    );

    // Intel and actions share the right column on wide screens (display: contents elsewhere).
    const right = h('div', { class: 'side-right' }, this.#intel, actionsArea);
    this.root.append(menu, top, status, this.#log, this.stage, right, views, bottom);
    host.append(this.#toasts, this.#banner, this.#netBanner, this.#tooltip, this.#announcer, this.#pauseOverlay);
    this.updateLayout();
  }

  // ------------------------------------------------------------ layout

  /** Recomputes the layout mode from the window and returns the free board rectangle. */
  updateLayout(): Rect {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.#layout = layoutMode(width, height);
    this.root.dataset.layout = this.#layout;
    this.root.dataset.toast = toastOnTop(this.#layout, height) ? 'top' : 'bottom';
    document.documentElement.dataset.layout = this.#layout;
    if (this.#layout.startsWith('phone')) this.#log.open = false;
    return this.stageRect();
  }

  get layout(): LayoutMode {
    return this.#layout;
  }

  stageRect(): Rect {
    if (this.root.dataset.phase === 'menu') return { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const r = this.stage.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }

  setPhase(phase: HudPhase): void {
    this.root.dataset.phase = phase;
    this.#tray.hidden = phase !== 'placing';
    if (phase !== 'playing') this.setTargeting(null);
    if (phase === 'menu') {
      this.#netBanner.hidden = true;
      this.setPaused(false);
      this.#logList.replaceChildren();
      this.#speech.hidden = true;
    }
  }

  /** Sets data flags the stylesheet keys on (online, pointer, powers...). */
  setFlag(name: string, value: string | boolean): void {
    if (value === false) delete this.root.dataset[name];
    else this.root.dataset[name] = String(value);
  }

  toggleDrawer(which: 'log' | 'intel'): void {
    const key = `drawer`;
    this.root.dataset[key] = this.root.dataset[key] === which ? '' : which;
    if (which === 'log') this.#log.open = true;
  }

  relabel(): void {
    relabel(this.root);
    relabel(this.#pauseOverlay);
  }

  // ------------------------------------------------------------ scoreboard

  setTeams(own: TeamInfo, enemy: TeamInfo): void {
    for (const [side, info] of [
      ['own', own],
      ['enemy', enemy],
    ] as const) {
      const team = this.#teams[side];
      setText(team.name, info.name);
      setText(team.faction, info.faction ?? '');
      team.faction.hidden = !info.faction;
      team.root.style.setProperty('--team', info.colour);
      document.documentElement.style.setProperty(`--team-${side}`, info.colour);
    }
  }

  setUnits(side: 'own' | 'enemy', left: number, total: number): void {
    const team = this.#teams[side];
    const text = String(left);
    if (team.count.textContent !== text && team.count.textContent !== '') replay(team.root, 'bump');
    setText(team.count, text);
    team.count.title = t('score.units', { n: left, total });
    team.bar.style.setProperty('--fill', String(total > 0 ? left / total : 0));
  }

  setStrikes(side: 'own' | 'enemy', strikes: number, max: number): void {
    const node = this.#teams[side].strikes;
    node.hidden = strikes === 0;
    setText(node, strikes > 0 ? t('score.strikes', { n: strikes, max }) : '');
  }

  setTurn(turn: 'own' | 'enemy' | null, turnNumber: number, extra = '', who?: string): void {
    this.#teams.own.root.classList.toggle('active', turn === 'own');
    this.#teams.enemy.root.classList.toggle('active', turn === 'enemy');
    this.root.dataset.turn = turn ?? '';
    if (turn === null && turnNumber <= 0) {
      setText(this.#turnLabel, extra);
      return;
    }
    const label = turn === null ? t('score.turn', { n: turnNumber }) : `${who ?? t(turn === 'own' ? 'score.yourTurn' : 'score.theirTurn')} · ${t('score.turn', { n: turnNumber })}`;
    setText(this.#turnLabel, extra ? `${label} · ${extra}` : label);
  }

  setClock(text: string, note: string, warn: 0 | 10 | 5, side: 'own' | 'enemy' | null): void {
    setText(this.#clockValue, text);
    setText(this.#clockNote, note);
    this.#clock.dataset.warn = String(warn);
    this.#clock.dataset.side = side ?? '';
    this.#clock.hidden = text === '';
  }

  // ------------------------------------------------------------ messages

  setMessage(text: string, tone: MessageTone = 'info'): void {
    if (this.#message.textContent === text) return;
    this.#message.dataset.tone = tone;
    this.#message.textContent = text;
    replay(this.#message, 'swap');
  }

  /** Short-lived notice at the top (rule errors, tide warnings, connection). */
  toast(text: string, tone: MessageTone = 'info', seconds = 3.2): void {
    const node = h('div', { class: 'toast', 'data-tone': tone }, text);
    this.#toasts.append(node);
    while (this.#toasts.children.length > 3) this.#toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      node.classList.add('out');
      window.setTimeout(() => node.remove(), 400);
    }, seconds * 1000);
    window.clearTimeout(this.#toastTimer);
  }

  /** Big "SUA VEZ" style banner in the middle of the board. */
  banner(text: string, tone: MessageTone = 'info'): void {
    this.#banner.textContent = text;
    this.#banner.dataset.tone = tone;
    replay(this.#banner, 'show');
    window.clearTimeout(this.#bannerTimer);
    this.#bannerTimer = window.setTimeout(() => this.#banner.classList.remove('show'), 1600);
  }

  /** Connection banner (null hides it). */
  setNetBanner(text: string | null, tone: MessageTone = 'warn'): void {
    this.#netBanner.hidden = text === null;
    if (text !== null) {
      setText(this.#netBanner, text);
      this.#netBanner.dataset.tone = tone;
    }
  }

  setNetStatus(text: string, tone: MessageTone = 'neutral'): void {
    setText(this.#net, text);
    this.#net.dataset.tone = tone;
    this.#net.hidden = text === '';
  }

  announce(text: string): void {
    this.#announcer.textContent = text;
  }

  tooltip(x: number, y: number, text: string | null): void {
    this.#tooltip.hidden = text === null;
    if (text === null) return;
    setText(this.#tooltip, text);
    this.#tooltip.style.transform = `translate(${Math.round(x + 16)}px, ${Math.round(y + 18)}px)`;
  }

  // ------------------------------------------------------------ log and intel

  addLog(line: LogLine): void {
    const item = h(
      'li',
      { class: `log-item${line.mine ? ' mine' : ''}`, 'data-tone': line.tone },
      h('span', { class: 'log-glyph', 'aria-hidden': 'true' }, line.glyph),
      h('span', { class: 'log-text' }, line.text),
    );
    this.#logList.prepend(item);
    while (this.#logList.children.length > 5) this.#logList.lastElementChild?.remove();
  }

  clearLog(): void {
    this.#logList.replaceChildren();
  }

  setFleet(remaining: readonly RoleCount[], destroyed: readonly RoleId[]): void {
    const items = remaining.map((r) =>
      h('li', { class: r.count === 0 ? 'gone' : '' }, h('span', { class: 'fleet-name' }, roleName(r.role)), h('span', { class: 'fleet-count' }, `×${r.count}`)),
    );
    if (items.length === 0) items.push(h('li', { class: 'muted' }, t('hud.fleetUnknown')));
    this.#fleet.replaceChildren(...items);
    this.#fleet.title = destroyed.length > 0 ? t('hud.destroyedList', { list: destroyed.map(roleName).join(', ') }) : '';
  }

  setNotes(notes: readonly { text: string; tone: MessageTone }[]): void {
    this.#notes.replaceChildren(...notes.map((n) => h('li', { 'data-tone': n.tone }, n.text)));
  }

  setCoach(text: string | null): void {
    this.#coach.hidden = text === null;
    if (text !== null) setText(this.#coach, text);
  }

  setHeatAvailable(available: boolean, on: boolean): void {
    this.#heatButton.hidden = !available;
    this.#heatButton.setAttribute('aria-pressed', String(on));
  }

  /** Bot leader line, with an optional portrait image. */
  say(name: string, text: string, portrait: string | null): void {
    const img = portrait ? h('img', { src: portrait, alt: '', width: 48, height: 48 }) : h('span', { class: 'speech-mono', 'aria-hidden': 'true' }, name.slice(0, 1));
    this.#speech.replaceChildren(img, h('div', {}, h('strong', {}, name), h('p', {}, text)));
    this.#speech.hidden = false;
    replay(this.#speech, 'pop');
  }

  // ------------------------------------------------------------ placement

  setTray(items: readonly PlacementTrayItem[], status: string, canConfirm: boolean): void {
    const buttons = items.map((item) => {
      const button = h('button', {
        type: 'button',
        class: `tray-piece${item.placed ? ' placed' : ''}${item.held ? ' held' : ''}${item.issue ? ' issue' : ''}`,
        role: 'option',
        'aria-selected': String(item.held),
        title: item.issue ?? '',
        onclick: () => this.#actions.pickPiece(item.slot),
      });
      button.innerHTML = shapeSvg(item.cells);
      button.append(h('span', { class: 'tray-name' }, roleName(item.role)), h('span', { class: 'tray-mark', 'aria-hidden': 'true' }, item.issue ? '!' : item.placed ? '✓' : ''));
      if (item.placed || item.issue) button.append(h('span', { class: 'sr-only' }, item.issue ?? t('place.placed')));
      return button;
    });
    this.#trayList.replaceChildren(...buttons);
    setText(this.#trayStatus, status);
    this.#confirmPlace.disabled = !canConfirm;
  }

  setWaiting(waiting: boolean): void {
    this.#confirmPlace.disabled = waiting || this.#confirmPlace.disabled;
    this.root.dataset.waiting = String(waiting);
  }

  // ------------------------------------------------------------ actions

  setActionBar(state: ActionBarState | null): void {
    this.#actionBar.hidden = state === null || !state.powers;
    if (!state || !state.powers) return;
    const pips: HTMLElement[] = [];
    for (let i = 0; i < state.energyMax; i++) pips.push(h('span', { class: `pip${i < state.energy ? ' on' : ''}` }));
    this.#energy.replaceChildren(h('span', { class: 'energy-label' }, `⚡ ${state.energy}/${state.energyMax}`), h('span', { class: 'pips', 'aria-hidden': 'true' }, ...pips));
    this.#energy.setAttribute('aria-valuenow', String(state.energy));
    this.#energy.setAttribute('aria-valuemax', String(state.energyMax));
    this.#energy.setAttribute('aria-label', t('hud.energy'));

    const configured = new Set(state.abilities.map((a) => a.id));
    for (const [id, button] of this.#abilityButtons) {
      const status = state.abilities.find((a) => a.id === id);
      button.hidden = !configured.has(id as AbilityStatus['id']);
      if (!status) continue;
      this.#fillAbility(button, t(`ability.${status.id}` as TextKey), status.cost, status.cooldownLeft, status.ready && state.enabled, status.blocker, state.selected === id);
    }
    const special = state.special;
    this.#special.hidden = special === null;
    if (special) {
      const cost = special.charges !== null && special.charges > 0 ? null : special.energy;
      this.#fillAbility(this.#special, special.name, cost, special.cooldownLeft, special.ready && state.enabled, special.blocker, state.selected === 'special', special.charges);
    }
  }

  #fillAbility(
    button: HTMLButtonElement,
    name: string,
    cost: number | null,
    cooldown: number,
    ready: boolean,
    blocker: string | null,
    selected: boolean,
    charges: number | null = null,
  ): void {
    setText(button.querySelector('.ability-name')!, name);
    const costText = charges !== null && charges > 0 ? `${charges}×` : cost !== null ? `⚡${cost}` : '';
    setText(button.querySelector('.ability-cost')!, costText);
    setText(button.querySelector('.ability-cd')!, cooldown > 0 ? String(cooldown) : '');
    const reason = !ready && blocker ? t(`blocker.${blocker}` as TextKey) : '';
    setText(button.querySelector('.ability-state')!, reason ? `(${reason})` : '');
    button.title = reason ? `${name}: ${reason}` : name;
    button.disabled = !ready;
    button.setAttribute('aria-pressed', String(selected));
    button.dataset.cooldown = String(cooldown);
  }

  /** Targeting hint (null hides the bar). */
  setTargeting(text: string | null, axis: 'row' | 'col' | null = null): void {
    this.#targetBar.hidden = text === null;
    if (text !== null) setText(this.#targetText, text);
    this.#axisButton.hidden = axis === null;
    if (axis) {
      this.#axisButton.dataset.i18n = axis === 'row' ? 'target.axisRow' : 'target.axisCol';
      setText(this.#axisButton, t(axis === 'row' ? 'target.axisRow' : 'target.axisCol'));
    }
  }

  /** Big confirm button for touch screens; null hides it. */
  setFire(label: string | null): void {
    this.#fireButton.hidden = label === null;
    if (label !== null) setText(this.#fireButton, label);
  }

  setView(preset: ViewPreset): void {
    for (const [id, button] of this.#views) button.setAttribute('aria-pressed', String(id === preset));
  }

  setPaused(paused: boolean, canPause = true): void {
    this.#pauseOverlay.hidden = !paused;
    this.#pauseButton.hidden = !canPause;
    this.#pauseButton.innerHTML = icon(paused ? 'play' : 'pause');
    this.#pauseButton.append(h('span', { class: 'sr-only', i18n: paused ? 'pause.resume' : 'hud.pause' }));
    this.root.dataset.paused = String(paused);
    if (paused) this.#pauseOverlay.querySelector<HTMLButtonElement>('button')?.focus();
  }

  /** Keyboard shortcut: the same popover as the smiley button. */
  openSocialFromKey(): void {
    this.#actions.openSocial(this.#socialButton);
  }

  setMuted(muted: boolean): void {
    this.#muteButton.innerHTML = icon(muted ? 'mute' : 'chat');
    this.#muteButton.append(h('span', { class: 'sr-only', i18n: muted ? 'social.unmute' : 'social.mute' }));
    this.#muteButton.setAttribute('aria-pressed', String(muted));
  }

  #withIcon(name: IconName, label: TextKey, onclick: () => void): HTMLButtonElement {
    const button = html('button', 'chip with-icon', icon(name));
    button.type = 'button';
    button.append(h('span', { i18n: label }));
    button.addEventListener('click', onclick);
    return button;
  }
}

export function sideOf(player: PlayerId, seat: PlayerId): 'own' | 'enemy' {
  return player === seat ? 'own' : 'enemy';
}
