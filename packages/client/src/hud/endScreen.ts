import { accuracy, type SideStats } from '../app/stats';
import type { EndSummary } from '../app/game';
import { formatElapsed } from '../app/clockDisplay';
import { h } from './dom';
import { openModal, type ModalHandle } from './dialogs';
import { t, type TextKey } from './i18n';

export interface EndActions {
  rematch(): void;
  levelUp(): void;
  home(): void;
  /** Close the card to look at the board (a small button brings it back). */
  viewBoard(): void;
}

export interface EndOptions {
  readonly canLevelUp: boolean;
  readonly online: boolean;
  /** Seconds the rematch offer stays open (online). */
  readonly rematchWindow: number;
  /** Extra line (daily score, campaign stars). */
  readonly extra?: string | null;
  /** Extra button (next mission). */
  readonly next?: { readonly label: TextKey; readonly action: () => void } | null;
}

/** Result card: title, reason, stats and what to do next. */
export class EndScreen {
  readonly #host: HTMLElement;
  #handle: ModalHandle | null = null;
  #rematchButton: HTMLButtonElement | null = null;
  #rematchNote: HTMLElement | null = null;
  #timer = 0;
  #summary: EndSummary | null = null;
  #options: EndOptions | null = null;
  #actions: EndActions | null = null;
  #deadline = 0;
  #reopen: HTMLButtonElement;
  #note = '';

  constructor(host: HTMLElement) {
    this.#host = host;
    this.#reopen = h('button', { type: 'button', class: 'primary reopen-result', i18n: 'end.showResult', hidden: true, onclick: () => this.#open() });
    host.append(this.#reopen);
  }

  get open(): boolean {
    return this.#handle !== null;
  }

  show(summary: EndSummary, options: EndOptions, actions: EndActions): void {
    this.#summary = summary;
    this.#options = options;
    this.#actions = actions;
    this.#deadline = performance.now() + options.rematchWindow * 1000;
    this.#open();
  }

  /** The opponent asked for a rematch (online). */
  opponentWantsRematch(): void {
    if (this.#rematchNote) this.#rematchNote.textContent = t('end.opponentRematch');
    this.#rematchButton?.classList.add('pulse');
  }

  setRematchState(text: string): void {
    // May arrive before the card opens (server answers are fast): kept and shown on open.
    this.#note = text;
    if (this.#rematchNote) this.#rematchNote.textContent = text;
  }

  close(): void {
    window.clearInterval(this.#timer);
    this.#note = '';
    const handle = this.#handle;
    this.#handle = null;
    handle?.close();
    this.#reopen.hidden = true;
    this.#summary = null;
  }

  #open(): void {
    const summary = this.#summary;
    const options = this.#options;
    const actions = this.#actions;
    if (!summary || !options || !actions) return;
    this.#reopen.hidden = true;
    const row = (label: TextKey, own: string | number, enemy: string | number) =>
      h('tr', {}, h('th', { scope: 'row', i18n: label }), h('td', {}, String(own)), h('td', {}, String(enemy)));
    const pct = (s: SideStats) => {
      const a = accuracy(s);
      return a === null ? '—' : `${Math.round(a * 100)}%`;
    };
    const { own, enemy } = summary.stats;
    const table = h(
      'table',
      { class: 'stats-table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', i18n: 'stats.player' }), h('th', { scope: 'col', class: 'own', i18n: 'stats.you' }), h('th', { scope: 'col', class: 'enemy', i18n: 'stats.opponent' }))),
      h(
        'tbody',
        {},
        row('stats.shots', own.shots, enemy.shots),
        row('stats.hits', own.hits, enemy.hits),
        row('stats.accuracy', pct(own), pct(enemy)),
        row('stats.destroyed', own.destroyed, enemy.destroyed),
        row('stats.abilities', own.abilities + own.specials, enemy.abilities + enemy.specials),
        row('stats.timeouts', own.timeouts, enemy.timeouts),
      ),
    );

    this.#rematchNote = h('p', { class: 'rematch-note', 'aria-live': 'polite' }, this.#note);
    this.#rematchButton = h('button', { type: 'button', class: 'primary', onclick: () => actions.rematch() });
    const buttons: HTMLElement[] = [this.#rematchButton];
    if (options.next) buttons.push(h('button', { type: 'button', class: 'primary', i18n: options.next.label, onclick: () => options.next!.action() }));
    if (options.canLevelUp) buttons.push(h('button', { type: 'button', class: 'primary', i18n: 'end.levelUp', onclick: () => actions.levelUp() }));
    buttons.push(
      h('button', { type: 'button', class: 'secondary', i18n: 'end.viewBoard', onclick: () => {
        this.#hide();
        actions.viewBoard();
      } }),
      h('button', { type: 'button', class: 'secondary', i18n: 'end.menu', onclick: () => actions.home() }),
    );

    const body = h(
      'div',
      { class: `end-card ${summary.victory ? 'victory' : 'defeat'}` },
      h('p', { class: 'end-reason' }, summary.reason),
      h('p', { class: 'end-meta' }, t('end.meta', { turns: summary.stats.turns, time: formatElapsed(summary.durationMs) })),
      options.extra ? h('p', { class: 'end-extra' }, options.extra) : null,
      table,
      this.#rematchNote,
      h('div', { class: 'dialog-actions end-actions' }, ...buttons),
    );
    this.#handle = openModal(this.#host, body, {
      title: t(summary.victory ? 'end.victory' : 'end.defeat'),
      className: `end-dialog ${summary.victory ? 'victory' : 'defeat'}`,
      onDismiss: () => {
        this.#hide();
        actions.viewBoard();
      },
    });
    this.#tick();
    window.clearInterval(this.#timer);
    this.#timer = window.setInterval(() => this.#tick(), 250);
  }

  #hide(): void {
    window.clearInterval(this.#timer);
    const handle = this.#handle;
    this.#handle = null;
    handle?.close();
    this.#reopen.hidden = this.#summary === null;
    this.#reopen.focus();
  }

  #tick(): void {
    const button = this.#rematchButton;
    const options = this.#options;
    if (!button || !options) return;
    if (!options.online) {
      button.textContent = t('end.rematch');
      return;
    }
    const left = Math.max(0, Math.ceil((this.#deadline - performance.now()) / 1000));
    button.disabled = left === 0;
    button.textContent = left > 0 ? t('end.rematchIn', { n: left }) : t('end.rematchClosed');
  }
}
