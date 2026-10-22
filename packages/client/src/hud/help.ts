import { h } from './dom';
import { openModal, type ModalHandle } from './dialogs';
import { t, type TextKey } from './i18n';

const RULES: readonly TextKey[] = ['help.goal', 'help.place', 'help.turns', 'help.extra', 'help.powers', 'help.clock', 'help.win'];

const KEYS: ReadonlyArray<[string, TextKey]> = [
  ['← ↑ → ↓', 'help.key.arrows'],
  ['Enter / Espaço', 'help.key.fire'],
  ['R', 'help.key.rotate'],
  ['1 · 2 · 3', 'help.key.views'],
  ['Esc', 'help.key.cancel'],
  ['E', 'help.key.social'],
  ['P', 'help.key.pause'],
  ['M', 'help.key.sound'],
  ['H', 'help.key.help'],
];

/** Rules, controls and the board legend. */
export function openHelp(host: HTMLElement): ModalHandle {
  const body = h(
    'div',
    { class: 'help' },
    h('ul', { class: 'help-list' }, ...RULES.map((key) => h('li', { i18n: key }))),
    h('h3', { i18n: 'help.controls' }),
    h('p', { class: 'muted', i18n: 'help.pointer' }),
    h(
      'table',
      { class: 'keys' },
      h('tbody', {}, ...KEYS.map(([keys, label]) => h('tr', {}, h('th', { scope: 'row' }, h('kbd', {}, keys)), h('td', { i18n: label })))),
    ),
    h('p', { class: 'muted', i18n: 'help.shortcutsNote' }),
    h('h3', { i18n: 'help.legend' }),
    h(
      'div',
      { class: 'legend' },
      h('span', {}, h('b', { 'aria-hidden': 'true' }, '✗ '), t('legend.earth')),
      h('span', {}, h('b', { 'aria-hidden': 'true' }, '◆ '), t('legend.rock')),
      h('span', {}, h('b', { 'aria-hidden': 'true' }, '✓ '), t('legend.hit')),
      h('span', {}, h('b', { 'aria-hidden': 'true' }, '⛨ '), t('legend.shield')),
    ),
  );
  return openModal(host, body, { title: t('help.title'), className: 'help-dialog' });
}
