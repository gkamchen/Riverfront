import { SCALES, type MotifStyle, type SfxPreset } from '../../audio/presets';
import type { WaterParams } from '../../board/water';
import { ROLE_LABELS, UNIT_ROLES, type UnitRole } from '../../units/roles';
import type { UnitSkin } from '../types';

/** River surface from two colours; the sky and foam follow sensible defaults. */
export function water(deep: string, shallow: string, extra: Partial<WaterParams> = {}): WaterParams {
  return {
    mode: 'water',
    deep,
    shallow,
    skyLow: '#4a4a44',
    skyHigh: '#c8d8e2',
    foam: '#f2f4ee',
    flow: 0.22,
    clarity: 1,
    ...extra,
  };
}

/** Skins from names in role order (recruit … workshop, tower), plus optional hand-made pieces. */
export function skins(names: readonly string[], custom: Partial<Record<UnitRole, Omit<UnitSkin, 'name'>>> = {}): Record<UnitRole, UnitSkin> {
  const out = {} as Record<UnitRole, UnitSkin>;
  UNIT_ROLES.forEach((role, i) => {
    out[role] = { name: names[i] ?? ROLE_LABELS[role], ...custom[role] };
  });
  return out;
}

/** A faction sound preset: a theme-like bed plus the signature motif. */
export function sfx(
  id: string,
  style: MotifStyle,
  root: number,
  scale: keyof typeof SCALES,
  phrase: readonly number[],
  step = 0.18,
  extra: Partial<SfxPreset> = {},
): SfxPreset {
  return {
    id,
    boomHz: 105,
    rumble: 1.6,
    brightness: 1,
    reverb: 0.22,
    reverbTime: 2,
    surface: 'water',
    ambience: 'river',
    motif: { style, root, scale: SCALES[scale], phrase, step },
    ...extra,
  };
}
