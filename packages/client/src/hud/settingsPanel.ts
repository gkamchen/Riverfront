import type { Settings } from '../app/settings';
import { h } from './dom';
import { openPopover, type PopoverHandle } from './dialogs';
import { t, type TextKey } from './i18n';

type Option<V extends string> = readonly [V, TextKey];

/**
 * Every setting in one gear popover: look, sound, language and accessibility.
 * Each change is reported at once (no "save" step).
 */
export function openSettings(anchor: HTMLElement, settings: Settings, onChange: (patch: Partial<Settings>) => void): PopoverHandle {
  const select = <V extends string>(label: TextKey, value: V, options: readonly Option<V>[], apply: (v: V) => void) => {
    const input = h('select', { class: 'select', onchange: (e: Event) => apply((e.target as HTMLSelectElement).value as V) });
    for (const [id, text] of options) {
      const option = h('option', { value: id }, t(text));
      if (id === value) option.selected = true;
      input.append(option);
    }
    return h('label', { class: 'field' }, h('span', { i18n: label }), input);
  };
  const toggle = (label: TextKey, hint: TextKey | null, value: boolean, apply: (v: boolean) => void) =>
    h(
      'label',
      { class: 'toggle' },
      h('input', { type: 'checkbox', checked: value, onchange: (e: Event) => apply((e.target as HTMLInputElement).checked) }),
      h('span', {}, h('strong', { i18n: label }), hint ? h('small', { i18n: hint }) : null),
    );

  const volume = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.05,
    value: settings.volume,
    class: 'range',
    oninput: (e: Event) => onChange({ volume: Number((e.target as HTMLInputElement).value) }),
  });

  const content = h(
    'div',
    { class: 'settings' },
    h('h2', { class: 'panel-title', i18n: 'settings.title' }),
    h('section', {},
      h('h3', { i18n: 'settings.look' }),
      select('settings.theme', settings.theme, [
        ['faccao', 'theme.faccao'],
        ['vale', 'theme.vale'],
        ['vulcao', 'theme.vulcao'],
        ['tundra', 'theme.tundra'],
      ], (theme) => onChange({ theme })),
      select('settings.quality', settings.quality, [
        ['auto', 'quality.auto'],
        ['high', 'quality.high'],
        ['low', 'quality.low'],
      ], (quality) => onChange({ quality })),
      select('settings.coordinates', settings.coordinates, [
        ['engraved', 'coords.engraved'],
        ['overlay', 'coords.overlay'],
        ['off', 'coords.off'],
      ], (coordinates) => onChange({ coordinates })),
    ),
    h('section', {},
      h('h3', { i18n: 'settings.sound' }),
      toggle('settings.soundOn', null, !settings.muted, (on) => onChange({ muted: !on })),
      h('label', { class: 'field' }, h('span', { i18n: 'settings.volume' }), volume),
    ),
    h('section', {},
      h('h3', { i18n: 'settings.language' }),
      select('settings.language', settings.locale, [
        ['pt', 'lang.pt'],
        ['en', 'lang.en'],
      ], (locale) => onChange({ locale })),
    ),
    h('section', {},
      h('h3', { i18n: 'settings.access' }),
      toggle('settings.colorblind', 'settings.colorblindHint', settings.colorblind, (colorblind) => onChange({ colorblind })),
      select('settings.motion', settings.motion, [
        ['system', 'motion.system'],
        ['reduced', 'motion.reduced'],
        ['full', 'motion.full'],
      ], (motion) => onChange({ motion })),
      select('settings.confirm', settings.confirmShots, [
        ['auto', 'confirm.auto'],
        ['always', 'confirm.always'],
        ['never', 'confirm.never'],
      ], (confirmShots) => onChange({ confirmShots })),
      toggle('settings.shortcuts', 'settings.shortcutsHint', settings.singleKeyShortcuts, (singleKeyShortcuts) => onChange({ singleKeyShortcuts })),
      toggle('settings.heat', 'settings.heatHint', settings.heatMap, (heatMap) => onChange({ heatMap })),
    ),
  );
  return openPopover(anchor, content, 'settings.title', 'settings-pop');
}
