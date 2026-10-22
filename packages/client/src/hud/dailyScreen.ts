import type { DailyChallenge, DailyEntry, FactionId } from '@riverfront/core';
import { formatElapsed } from '../app/clockDisplay';
import { h } from './dom';
import { factionName, mutatorName, mutatorText, t, type TextKey } from './i18n';

export interface DailyData {
  readonly challenge: DailyChallenge;
  readonly entries: readonly DailyEntry[];
  /** 'local' (this device) or 'server' (everyone). */
  readonly source: 'local' | 'server';
  readonly me: string;
  readonly botName: string;
  readonly portrait: (id: FactionId, size?: number) => string | null;
  readonly played: boolean;
}

/** Today's challenge: same seed, mode, mutators, factions and bot for everyone. */
export function dailyCard(data: DailyData, onPlay: () => void): HTMLElement {
  const c = data.challenge;
  const mine = data.entries.find((e) => e.name === data.me);
  const rank = mine ? data.entries.indexOf(mine) + 1 : null;
  const side = (id: FactionId) => {
    const portrait = id === 'neutra' ? null : data.portrait(id, 64);
    return h('div', { class: 'daily-side' }, portrait ? h('img', { src: portrait, alt: '', width: 48, height: 48 }) : null, h('span', {}, id === 'neutra' ? t('faction.neutral') : factionName(id)));
  };
  const rows = data.entries.slice(0, 10).map((e, i) =>
    h(
      'tr',
      { class: e.name === data.me ? 'me' : '' },
      h('td', {}, String(i + 1)),
      h('th', { scope: 'row' }, e.name),
      h('td', {}, String(e.score)),
      h('td', {}, e.won ? `✓ ${t('daily.won')}` : `✗ ${t('daily.lost')}`),
      h('td', {}, String(e.shots)),
      h('td', {}, formatElapsed(e.timeMs)),
    ),
  );
  return h(
    'div',
    { class: 'daily' },
    h('p', { class: 'daily-date' }, t('daily.date', { date: c.id })),
    h('div', { class: 'daily-match' }, side(c.playerFaction), h('span', { class: 'versus', 'aria-hidden': 'true' }, '×'), side(c.opponentFaction)),
    h(
      'ul',
      { class: 'mission-facts' },
      h('li', {}, `${t('mode.label')}: ${t(`preset.${c.preset}` as TextKey)}`),
      h('li', {}, `${t('daily.opponent')}: ${data.botName} (${t('campaign.level', { n: c.botLevel })})`),
      ...(c.mutators.length === 0 ? [h('li', { i18n: 'daily.noMutators' })] : c.mutators.map((m) => h('li', {}, h('strong', {}, `${mutatorName(m)}: `), mutatorText(m)))),
      h('li', { class: 'muted', i18n: 'daily.scoring' }),
    ),
    mine ? h('p', { class: 'daily-mine' }, t('daily.mine', { score: mine.score, rank: rank ?? '—' })) : null,
    h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'primary big', i18n: data.played ? 'daily.again' : 'daily.play', onclick: onPlay })),
    h('h3', { i18n: data.source === 'server' ? 'daily.boardServer' : 'daily.boardLocal' }),
    rows.length === 0
      ? h('p', { class: 'muted', i18n: 'daily.empty' })
      : h(
          'table',
          { class: 'stats-table daily-table' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, '#'), h('th', { scope: 'col', i18n: 'daily.name' }), h('th', { scope: 'col', i18n: 'daily.score' }), h('th', { scope: 'col', i18n: 'daily.result' }), h('th', { scope: 'col', i18n: 'stats.shots' }), h('th', { scope: 'col', i18n: 'daily.time' }))),
          h('tbody', {}, ...rows),
        ),
  );
}
