import { Color } from 'three';
import type { Tint } from '../../units/parts';
import type { ArchitectureMotifs, FactionPalette, KitParams, TeamSlot } from '../types';

/** Everything a kit factory needs, resolved once per faction. */
export interface KitStyle {
  /** Prefix for the shared geometry cache (faction id plus a variant). */
  key: string;
  params: KitParams;
  motifs: ArchitectureMotifs;
  color: {
    primary: Color;
    secondary: Color;
    accent: Color;
    stone: Color;
    stoneDark: Color;
    wood: Color;
    woodDark: Color;
    metal: Color;
    metalDark: Color;
    cloth: Color;
    skin: Color;
    rope: Color;
    dark: Color;
    flame: Color;
  };
  /** Team-aware tints of the four kit surfaces. */
  tint: {
    cloth: Tint;
    shield: Tint;
    roof: Tint;
    trim: Tint;
  };
}

function shade(hex: string, k: number): Color {
  return new Color(hex).multiplyScalar(k);
}

function slot(rule: TeamSlot, fallback: Color): Tint {
  return rule === 'none' ? fallback : rule;
}

export function resolveKit(key: string, palette: FactionPalette, motifs: ArchitectureMotifs, params: KitParams): KitStyle {
  const color = {
    primary: new Color(palette.primary),
    secondary: new Color(palette.secondary),
    accent: new Color(palette.accent),
    stone: new Color(palette.stone),
    stoneDark: shade(palette.stone, 0.72),
    wood: new Color(palette.wood),
    woodDark: shade(palette.wood, 0.6),
    metal: new Color(palette.metal),
    metalDark: shade(palette.metal, 0.55),
    cloth: new Color(palette.cloth),
    skin: new Color(palette.skin),
    rope: new Color('#b49a6a'),
    dark: new Color('#1c1a18'),
    flame: new Color('#ffb040'),
  };
  return {
    key,
    params,
    motifs,
    color,
    tint: {
      cloth: slot(palette.team.cloth, color.cloth),
      shield: slot(palette.team.shield, color.primary),
      roof: slot(palette.team.roof, color.secondary),
      trim: slot(palette.team.trim, color.accent),
    },
  };
}
