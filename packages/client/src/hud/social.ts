import { EMOJI_GLYPHS, TAUNTS, type EmojiId, type TauntId } from '@riverfront/protocol';
import { h } from './dom';
import { openPopover, type PopoverHandle } from './dialogs';
import { t, type TextKey } from './i18n';

/** Eight slots of the emoji wheel (the protocol has a few more ids). */
export const WHEEL: readonly EmojiId[] = ['ola', 'joinha', 'risada', 'susto', 'pensando', 'fogo', 'aplausos', 'gg'];

export interface SocialActions {
  emoji(id: EmojiId): Promise<boolean>;
  taunt(id: TauntId): Promise<boolean>;
  cooldowns(): { emoji: number; taunt: number };
  /** Online only: emotes from the other side are muted. */
  muted: boolean | null;
  toggleMute(): void;
  /** Online doubles only: send to the partner only, and mute the partner. */
  teamOnly?: boolean | null;
  toggleTeamOnly?(): void;
  mutedPartner?: boolean | null;
  togglePartnerMute?(): void;
}

/** Emoji wheel plus quick phrases. Buttons stay disabled for the same cooldowns the server applies. */
export function openSocial(anchor: HTMLElement, actions: SocialActions): PopoverHandle {
  const wheel = h('div', { class: 'wheel', role: 'group', i18nAria: 'social.emojis' });
  const emojiButtons: HTMLButtonElement[] = [];
  WHEEL.forEach((id, i) => {
    const angle = (i / WHEEL.length) * Math.PI * 2 - Math.PI / 2;
    const button = h(
      'button',
      {
        type: 'button',
        class: 'wheel-slot',
        style: `--x:${Math.cos(angle).toFixed(3)};--y:${Math.sin(angle).toFixed(3)}`,
        title: t(`emoji.${id}` as TextKey),
        onclick: async () => {
          if (await actions.emoji(id)) handle.close();
        },
      },
      h('span', { 'aria-hidden': 'true' }, EMOJI_GLYPHS[id]),
      h('span', { class: 'sr-only' }, t(`emoji.${id}` as TextKey)),
    );
    emojiButtons.push(button);
    wheel.append(button);
  });
  wheel.append(h('span', { class: 'wheel-hub', 'aria-hidden': 'true' }));

  const tauntButtons = TAUNTS.map((id) =>
    h('button', { type: 'button', class: 'chip taunt', onclick: async () => {
      if (await actions.taunt(id)) handle.close();
    } }, t(`taunt.${id}` as TextKey)),
  );
  const cooldown = h('p', { class: 'muted cooldown', 'aria-live': 'polite' });
  const toggle = (value: boolean | null | undefined, label: TextKey, hint: TextKey | null, onchange: (() => void) | undefined) =>
    value === null || value === undefined || !onchange
      ? null
      : h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: value, onchange }), h('span', {}, h('strong', { i18n: label }), hint ? h('small', { i18n: hint }) : null));
  const doubles = actions.teamOnly !== null && actions.teamOnly !== undefined;
  const team = toggle(actions.teamOnly, 'social.teamOnly', 'social.teamOnlyHint', actions.toggleTeamOnly);
  const mute = toggle(actions.muted, doubles ? 'social.muteOpponents' : 'social.muteLabel', null, () => actions.toggleMute());
  const mutePartner = toggle(actions.mutedPartner, 'social.mutePartner', null, actions.togglePartnerMute);

  const content = h('div', { class: 'social' }, wheel, h('div', { class: 'taunts', role: 'group', i18nAria: 'social.taunts' }, ...tauntButtons), cooldown, team, mute, mutePartner);
  const handle = openPopover(anchor, content, 'hud.social', 'social-pop');

  const refresh = () => {
    if (!handle.root.isConnected) {
      window.clearInterval(timer);
      return;
    }
    const cd = actions.cooldowns();
    for (const b of emojiButtons) b.disabled = cd.emoji > 0;
    for (const b of tauntButtons) b.disabled = cd.taunt > 0;
    cooldown.textContent = cd.taunt > 0 ? t('social.tauntWait', { n: Math.ceil(cd.taunt) }) : '';
  };
  const timer = window.setInterval(refresh, 250);
  refresh();
  return handle;
}
