import { FACTIONS, type Archetype, type FactionId } from '@riverfront/core';
import type { FactionChoice } from '../app/factionArt';
import { h } from './dom';
import { factionName, t, type TextKey } from './i18n';

export interface FactionPickerData {
  choices(): readonly FactionChoice[];
  portrait(id: FactionId, size?: number): string | null;
  /** Resolves once the art registry (portraits, status) is loaded. */
  artReady(): Promise<unknown>;
}

const ARCHETYPES: readonly Archetype[] = ['informacao', 'defesa', 'ataque', 'tempo', 'energia'];

/**
 * Faction choice: every faction of the rules, with the leader portrait, its
 * status (pronta / em breve), filters by wave and archetype, and a detail
 * card with the archetype and the special shot.
 */
export function factionPicker(data: FactionPickerData, current: FactionId, onPick: (id: FactionId) => void): HTMLElement {
  let wave = 0;
  let archetype: Archetype | 'all' = 'all';
  let selected = current;
  const root = h('div', { class: 'faction-picker' });

  const draw = () => {
    const all = data.choices();
    const shown = all.filter((f) => (wave === 0 || f.wave === wave || f.id === 'neutra') && (archetype === 'all' || f.archetype === archetype || f.id === 'neutra'));
    const waves = h('div', { class: 'segmented compact', role: 'radiogroup', i18nAria: 'faction.wave' });
    for (const w of [0, 1, 2, 3, 4]) {
      waves.append(
        h('button', { type: 'button', role: 'radio', 'aria-checked': String(wave === w), onclick: () => ((wave = w), draw()) }, w === 0 ? t('faction.allWaves') : t('faction.waveN', { n: w })),
      );
    }
    const select = h('select', { class: 'select', i18nAria: 'faction.archetype', onchange: (e: Event) => ((archetype = (e.target as HTMLSelectElement).value as Archetype | 'all'), draw()) });
    select.append(h('option', { value: 'all' }, t('faction.allArchetypes')));
    for (const a of ARCHETYPES) {
      const option = h('option', { value: a }, t(`archetype.${a}` as TextKey));
      if (a === archetype) option.selected = true;
      select.append(option);
    }

    const grid = h('div', { class: 'choice-grid factions', role: 'radiogroup', i18nAria: 'faction.label' });
    for (const f of shown) {
      const portrait = f.id === 'neutra' ? null : data.portrait(f.id, 72);
      const badge = statusText(f);
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: `choice faction status-${f.status}`,
            role: 'radio',
            'aria-checked': String(selected === f.id),
            'aria-disabled': String(!f.playable),
            onclick: () => {
              selected = f.id;
              if (f.playable) onPick(f.id);
              draw();
            },
          },
          portrait ? h('img', { src: portrait, alt: '', width: 44, height: 44, loading: 'lazy' }) : h('span', { class: 'portrait-mono', 'aria-hidden': 'true' }, f.name.slice(0, 1)),
          h('span', { class: 'choice-title' }, factionName(f.id)),
          h('span', { class: 'choice-text' }, f.archetype ? t(`archetype.${f.archetype}` as TextKey) : t('faction.neutral')),
          badge ? h('span', { class: `badge badge-${f.status}` }, badge) : null,
        ),
      );
    }
    root.replaceChildren(h('div', { class: 'picker-filters' }, waves, h('label', { class: 'field inline' }, h('span', { i18n: 'faction.archetype' }), select)), grid, detail(all.find((f) => f.id === selected) ?? all[0]!, data));
  };

  draw();
  void data.artReady().then(() => root.isConnected && draw());
  return root;
}

function statusText(f: FactionChoice): string | null {
  switch (f.status) {
    case 'pronta':
      return f.id === 'neutra' ? null : t('faction.ready');
    case 'em-breve':
      return t('faction.soon');
    case 'sem-arte':
      return t('faction.unavailable');
    case 'carregando':
      return '…';
  }
}

function detail(f: FactionChoice, data: FactionPickerData): HTMLElement {
  const def = FACTIONS[f.id];
  const portrait = f.id === 'neutra' ? null : data.portrait(f.id, 120);
  return h(
    'article',
    { class: 'faction-detail', 'aria-live': 'polite' },
    portrait ? h('img', { src: portrait, alt: t('faction.portraitOf', { name: f.leader }), width: 96, height: 96 }) : null,
    h(
      'div',
      {},
      h('h4', {}, `${factionName(f.id)}${statusText(f) ? ` · ${statusText(f)}` : ''}`),
      f.id === 'neutra' ? h('p', { class: 'muted', i18n: 'faction.neutralHint' }) : h('p', { class: 'muted' }, `${f.leader} · ${def.region} · ${def.river}`),
      f.id === 'neutra' ? null : h('p', {}, f.brand),
      f.archetype ? h('p', {}, h('strong', {}, `${t(`archetype.${f.archetype}` as TextKey)}: `), t(`archetype.${f.archetype}.desc` as TextKey)) : null,
      f.special ? h('p', {}, h('strong', {}, `${f.special.name}: `), f.special.description) : null,
      f.status === 'em-breve' ? h('p', { class: 'muted', i18n: 'faction.soonHint' }) : null,
    ),
  );
}
