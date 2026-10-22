import {
  CAMPAIGN,
  FACTIONS,
  arcUnlocked,
  campaignStars,
  missionStatus,
  type CampaignArc,
  type CampaignMission,
  type CampaignProgress,
  type FactionId,
} from '@riverfront/core';
import { h } from './dom';
import { openModal } from './dialogs';
import { factionName, mutatorName, mutatorText, t, type TextKey } from './i18n';

export interface CampaignData {
  progress(): CampaignProgress;
  portrait(id: FactionId, size?: number): string | null;
  artReady(): Promise<unknown>;
  /** Commander lines (from the bots' personas), when there is one. */
  persona(id: FactionId): { readonly intro: string; readonly personality: string } | null;
  /** Online: sync with the account (null hides the button). */
  sync: (() => Promise<string>) | null;
}

export interface CampaignActions {
  play(mission: CampaignMission): void;
}

const stars = (n: number, max = 3) => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));

/**
 * Campaign map: one arc per commander, grouped by release wave. Arcs of a
 * wave open after two arcs of the previous one; missions inside an arc open
 * in order. Progress lives on the device (and may be synced online).
 */
export function campaignMap(host: HTMLElement, data: CampaignData, actions: CampaignActions): HTMLElement {
  const root = h('div', { class: 'campaign' });
  const draw = () => {
    const progress = data.progress();
    const total = CAMPAIGN.length * 9;
    const note = h('p', { class: 'muted', 'aria-live': 'polite' });
    const head = h(
      'div',
      { class: 'campaign-head' },
      h('p', { class: 'stars-total' }, `★ ${campaignStars(progress)} / ${total}`),
      h('p', { class: 'muted', i18n: 'campaign.hint' }),
      data.sync
        ? h('button', {
            type: 'button',
            class: 'secondary small',
            i18n: 'campaign.sync',
            onclick: async (e: Event) => {
              const button = e.currentTarget as HTMLButtonElement;
              button.disabled = true;
              note.textContent = await data.sync!();
              button.disabled = false;
              draw();
            },
          })
        : null,
    );
    const sections = [1, 2, 3, 4].map((wave) => {
      const arcs = CAMPAIGN.filter((a) => a.wave === wave);
      return h('section', { class: 'campaign-wave' }, h('h3', {}, t('faction.waveN', { n: wave })), h('div', { class: 'arc-grid' }, ...arcs.map((arc) => arcCard(arc, progress))));
    });
    root.replaceChildren(head, note, ...sections);
  };

  const arcCard = (arc: CampaignArc, progress: CampaignProgress) => {
    const open = arcUnlocked(progress, arc.faction);
    const earned = arc.missions.reduce((s, m) => s + (progress.missions[m.id]?.stars ?? 0), 0);
    const portrait = data.portrait(arc.faction, 72);
    return h(
      'button',
      {
        type: 'button',
        class: `arc${open ? '' : ' locked'}`,
        'aria-disabled': String(!open),
        title: open ? '' : t('campaign.lockedHint'),
        onclick: () => (open ? openArc(arc) : undefined),
      },
      portrait ? h('img', { src: portrait, alt: '', width: 56, height: 56, loading: 'lazy' }) : h('span', { class: 'portrait-mono', 'aria-hidden': 'true' }, factionName(arc.faction).slice(0, 1)),
      h('span', { class: 'arc-title' }, arc.title),
      h('span', { class: 'arc-meta' }, `${factionName(arc.faction)} · ${mutatorName(arc.signature)}`),
      h('span', { class: 'arc-stars', 'aria-label': t('campaign.starsOf', { n: earned, total: 9 }) }, open ? stars(Math.round(earned / 3)) + ` ${earned}/9` : `🔒 ${t('campaign.locked')}`),
    );
  };

  const openArc = (arc: CampaignArc) => {
    const progress = data.progress();
    const portrait = data.portrait(arc.faction, 120);
    const persona = data.persona(arc.faction);
    const list = h('ol', { class: 'missions' });
    for (const mission of arc.missions) {
      const status = missionStatus(progress, mission.id);
      const record = progress.missions[mission.id];
      list.append(
        h(
          'li',
          { class: `mission status-${status}` },
          h('div', {}, h('strong', {}, `${mission.index + 1}. ${mission.title}`), h('p', { class: 'muted' }, mission.briefing)),
          h('p', { class: 'mission-meta' }, missionMeta(mission)),
          h('span', { class: 'arc-stars' }, status === 'locked' ? `🔒 ${t('campaign.locked')}` : `${stars(record?.stars ?? 0)}${record?.bestShots != null ? ` · ${t('campaign.best', { n: record.bestShots })}` : ''}`),
          h('button', {
            type: 'button',
            class: 'primary',
            disabled: status === 'locked',
            i18n: status === 'won' ? 'campaign.replay' : 'campaign.play',
            onclick: () => {
              handle.close();
              openMission(arc, mission);
            },
          }),
        ),
      );
    }
    const body = h(
      'div',
      { class: 'arc-dialog' },
      h(
        'div',
        { class: 'commander' },
        portrait ? h('img', { src: portrait, alt: t('faction.portraitOf', { name: `${arc.leader.title} ${arc.leader.name}` }), width: 96, height: 96 }) : null,
        h('div', {}, h('strong', {}, `${arc.leader.title} ${arc.leader.name}`), persona ? h('p', { class: 'muted' }, persona.personality) : null),
      ),
      h('p', {}, h('strong', {}, `${t('campaign.signature')}: ${mutatorName(arc.signature)}. `), mutatorText(arc.signature)),
      list,
    );
    const handle = openModal(host, body, { title: arc.title, className: 'campaign-dialog' });
  };

  const openMission = (arc: CampaignArc, mission: CampaignMission) => {
    const portrait = data.portrait(arc.faction, 160);
    const persona = data.persona(arc.faction);
    const opponent = FACTIONS[mission.opponentFaction];
    const body = h(
      'div',
      { class: 'mission-dialog' },
      h(
        'div',
        { class: 'commander' },
        portrait ? h('img', { src: portrait, alt: t('faction.portraitOf', { name: `${arc.leader.title} ${arc.leader.name}` }), width: 120, height: 120 }) : null,
        persona ? h('blockquote', {}, h('p', {}, persona.intro), h('cite', {}, `${arc.leader.title} ${arc.leader.name}`)) : h('strong', {}, `${arc.leader.title} ${arc.leader.name}`),
      ),
      h('p', {}, mission.briefing),
      h(
        'ul',
        { class: 'mission-facts' },
        h('li', {}, `${t('campaign.opponent')}: ${opponent.id === 'neutra' ? t('faction.neutral') : factionName(opponent.id as FactionId)} · ${t('campaign.level', { n: mission.botLevel })}`),
        h('li', {}, `${t('mode.label')}: ${t(`preset.${mission.preset}` as TextKey)}`),
        ...mission.mutators.map((m) => h('li', {}, h('strong', {}, `${mutatorName(m)}${m === arc.signature ? ` (${t('campaign.signature')})` : ''}: `), mutatorText(m))),
        h('li', {}, t('campaign.par', { n: mission.par, two: Math.floor(mission.par * 1.25) })),
      ),
      h('div', { class: 'dialog-actions' }, h('button', { type: 'button', class: 'primary big', i18n: 'campaign.start', onclick: () => {
        handle.close();
        actions.play(mission);
      } })),
    );
    const handle = openModal(host, body, { title: `${arc.title} · ${mission.index + 1}. ${mission.title}`, className: 'mission-modal' });
  };

  function missionMeta(mission: CampaignMission): string {
    return `${t(`preset.${mission.preset}` as TextKey)} · ${mission.mutators.map(mutatorName).join(', ')} · ${t('campaign.level', { n: mission.botLevel })}`;
  }

  draw();
  void data.artReady().then(() => root.isConnected && draw());
  return root;
}
