import { Color } from 'three';
import type { MotifStyle, SCALES } from '../../audio/presets';
import type { BankPropKind } from '../../board/bankProps';
import type { WaterParams } from '../../board/water';
import type { AmbientSpecies } from '../../board/wildlife/shared';
import type { PortraitParams } from '../portrait';
import type { SfxPreset } from '../../audio/presets';
import type { ThemePalette } from '../../materials/themes';
import type { UnitRole } from '../../units/roles';
import type { Archetype, ArchitectureMotifs, Expression, FactionDef, FactionPalette, FactionStatus, KitParams, SoilKind, UnitSkin } from '../types';
import { sfx, skins, water } from './helpers';

export interface Plan {
  id: string;
  name: string;
  people: string;
  region: string;
  wave: 2 | 3 | 4;
  status?: FactionStatus;
  archetype: Archetype;
  brand: string;
  palette: Omit<FactionPalette, 'team' | 'metal' | 'cloth'> & Partial<Pick<FactionPalette, 'team' | 'metal' | 'cloth'>>;
  motifs: ArchitectureMotifs;
  kit: KitParams;
  river: { id: string; name: string; deep: string; shallow: string; extra?: Partial<WaterParams>; bankProps: BankPropKind[]; soil: SoilKind };
  species: AmbientSpecies[];
  /** Nine piece names, in role order (recruit … workshop). */
  names: readonly string[];
  leader: { name: string; title: string; portrait: Partial<PortraitParams> & Pick<PortraitParams, 'headgear' | 'beard' | 'skin' | 'hair'> };
  music: { style: MotifStyle; root: number; scale: keyof typeof SCALES; phrase: number[]; step?: number; extra?: Partial<SfxPreset> };
  /** Ready factions: hand-made pieces, board colours, wildlife names and moments, leader lines. */
  custom?: Partial<Record<UnitRole, Omit<UnitSkin, 'name'>>>;
  board?: Partial<ThemePalette>;
  labels?: Partial<Record<AmbientSpecies, string>>;
  triggers?: ReadonlyArray<readonly [string, string]>;
  variants?: Partial<Record<Expression, Partial<PortraitParams>>>;
  lines?: Partial<Record<Expression, readonly string[]>>;
  dusk?: number;
}

const hex = (c: Color) => `#${c.getHexString()}`;

/** Fills the parts every planned faction shares, so each entry stays short. */
export function plan(p: Plan): FactionDef {
  const primary = new Color(p.palette.primary);
  const secondary = new Color(p.palette.secondary);
  return {
    id: p.id,
    name: p.name,
    people: p.people,
    region: p.region,
    wave: p.wave,
    status: p.status ?? 'planejada',
    archetype: p.archetype,
    brand: p.brand,
    palette: {
      metal: '#9a9488',
      cloth: p.palette.secondary,
      team: { cloth: 'main', shield: 'main', roof: 'dark', trim: 'main' },
      ...p.palette,
    },
    motifs: p.motifs,
    kit: p.kit,
    river: { id: p.river.id, name: p.river.name, water: water(p.river.deep, p.river.shallow, p.river.extra), bankProps: p.river.bankProps, soil: p.river.soil },
    wildlife: { species: p.species, labels: p.labels, triggers: p.triggers },
    unitSkins: skins(p.names, p.custom),
    leader: {
      name: p.leader.name,
      title: p.leader.title,
      portrait: {
        eyes: '#3a2a1e',
        garment: p.palette.primary,
        trim: p.palette.accent,
        accent: p.palette.secondary,
        backdrop: [hex(secondary.clone().lerp(new Color('#ffffff'), 0.4)), hex(primary.clone().multiplyScalar(0.45))],
        age: 0.45,
        ...p.leader.portrait,
      },
      variants: p.variants,
      lines: p.lines,
    },
    sfx: sfx(p.id, p.music.style, p.music.root, p.music.scale, p.music.phrase, p.music.step, p.music.extra),
    // Unspecified board colours are derived from the palette by the registry.
    board: p.board ?? {},
    dusk: p.dusk,
  };
}

/**
 * Factions with data only (status 'planejada'), dressed by the generic kit.
 * Every faction of the first four waves is ready; new ones start here.
 */
export const PLANNED: readonly FactionDef[] = [];
