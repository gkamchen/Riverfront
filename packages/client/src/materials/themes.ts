import type { Texture } from 'three';
import type { SfxPresetId } from '../audio/presets';
import type { BankPropKind } from '../board/bankProps';
import type { AmbientSpecies } from '../board/wildlife/shared';
import type { WaterParams } from '../board/water';
import { DEFAULT_UNIT_FACTORIES, type UnitFactoryRegistry } from '../units/factories';
import { createBasaltTextures, createFrostSoilTexture, createSoilTexture } from './textures';

export type ThemeId = 'vale' | 'vulcao' | 'tundra';

/** Colours of the room, the board and the lights. */
export interface ThemePalette {
  capLight: string;
  capDark: string;
  frameTint: string;
  table: string;
  plate: string;
  bankStone: string;
  rock: string;
  /** Light rim around rock cells (default neutral); keeps them apart from the soil. */
  rockRim?: string;
  riverBed: string;
  /** Four stops of the screen backdrop, top to bottom. */
  backdrop: readonly [string, string, string, string];
  fog: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  rim: string;
  rimIntensity: number;
  exposure: number;
  environment: number;
  /** Where the light drifts to when dusk is dialled up. */
  duskSun: string;
  duskBackdrop: readonly [string, string, string, string];
}

export interface TerrainMaterials {
  /** Builds the soil of opened tiles, plus an optional emissive map (glowing cracks). */
  soil: () => { map: Texture; glow?: Texture };
  soilGlowColor?: string;
  soilGlowIntensity?: number;
  soilRoughness: number;
}

export interface ThemeDef {
  /** A built-in theme id, or a derived id such as `faccao:egito`. */
  id: string;
  name: string;
  palette: ThemePalette;
  terrain: TerrainMaterials;
  water: WaterParams;
  ambientLife: readonly AmbientSpecies[];
  /** Static scenery along the banks and at the river mouths. */
  bankProps?: readonly BankPropKind[];
  unitFactories: UnitFactoryRegistry;
  /** Snow dusting / heat glow applied to every unit. */
  unitLook: { snow: number; heat: number };
  sfxPreset: SfxPresetId;
  sky: { aurora: boolean };
  /** Starting dusk amount (0 day .. 1 evening). */
  dusk: number;
}

export const THEMES: Readonly<Record<ThemeId, ThemeDef>> = {
  vale: {
    id: 'vale',
    name: 'Vale do Rio',
    palette: {
      capLight: '#e4dccf',
      capDark: '#4a4650',
      frameTint: '#ffffff',
      table: '#a89888',
      plate: '#120d0a',
      bankStone: '#ffffff',
      rock: '#ffffff',
      riverBed: '#ffffff',
      backdrop: ['#07090d', '#1a1712', '#2a2018', '#120c08'],
      fog: '#1c140e',
      sun: '#ffe9cf',
      sunIntensity: 2.6,
      hemiSky: '#c8d8ff',
      hemiGround: '#3a2414',
      hemiIntensity: 0.55,
      rim: '#8fb0ff',
      rimIntensity: 0.7,
      exposure: 0.95,
      environment: 0.55,
      duskSun: '#ff9a52',
      duskBackdrop: ['#0b0a1a', '#2a1a28', '#4a2a22', '#140c0a'],
    },
    terrain: { soil: () => ({ map: createSoilTexture() }), soilRoughness: 0.96 },
    water: {
      mode: 'water',
      deep: '#06303d',
      shallow: '#2a7a6c',
      skyLow: '#3b3a36',
      skyHigh: '#9fb6c4',
      foam: '#eaf2f0',
      flow: 0.25,
      clarity: 1,
    },
    ambientLife: ['fish', 'lilypads', 'heron', 'dragonflies', 'drifters', 'fireflies', 'birdsong'],
    bankProps: ['reeds'],
    unitFactories: DEFAULT_UNIT_FACTORIES,
    unitLook: { snow: 0, heat: 0 },
    sfxPreset: 'vale',
    sky: { aurora: false },
    dusk: 0,
  },
  vulcao: {
    id: 'vulcao',
    name: 'Vulcão',
    // Lighter rock and caps than the first pass: the board read as a black slab.
    palette: {
      capLight: '#c4b8b2',
      capDark: '#5c4a46',
      frameTint: '#8a7068',
      table: '#5e4a42',
      plate: '#0d0807',
      bankStone: '#c4b6ae',
      rock: '#d2c4bc',
      rockRim: '#ffa060',
      riverBed: '#3a2a24',
      backdrop: ['#0a0303', '#2a0c06', '#4a1608', '#120404'],
      fog: '#200a05',
      sun: '#ffbe8a',
      sunIntensity: 2.4,
      hemiSky: '#ff9a6a',
      hemiGround: '#3a1a10',
      hemiIntensity: 0.7,
      rim: '#ff6a2a',
      rimIntensity: 1.0,
      exposure: 1.0,
      environment: 0.5,
      duskSun: '#ff5a2a',
      duskBackdrop: ['#050101', '#200604', '#3a0e04', '#0a0202'],
    },
    terrain: {
      soil: () => createBasaltTextures(),
      soilGlowColor: '#ff7a2a',
      soilGlowIntensity: 1.0,
      soilRoughness: 0.85,
    },
    water: {
      mode: 'lava',
      deep: '#2a0c06',
      shallow: '#e85414',
      skyLow: '#2a0c06',
      skyHigh: '#ff8a3a',
      foam: '#ffb24a',
      flow: 0.06,
      clarity: 1,
    },
    ambientLife: ['salamanders', 'embers'],
    bankProps: ['boulders'],
    unitFactories: DEFAULT_UNIT_FACTORIES,
    unitLook: { snow: 0, heat: 1 },
    sfxPreset: 'vulcao',
    sky: { aurora: false },
    dusk: 0,
  },
  tundra: {
    id: 'tundra',
    name: 'Tundra',
    palette: {
      capLight: '#eef3f8',
      capDark: '#5a6a80',
      frameTint: '#c8d0dc',
      table: '#7a8696',
      plate: '#0c1016',
      bankStone: '#c8d4e2',
      rock: '#9aa6b6',
      rockRim: '#d8ecff',
      riverBed: '#4a5a6a',
      backdrop: ['#030612', '#0a1630', '#1a2a44', '#06080e'],
      fog: '#0c1424',
      sun: '#dce8ff',
      sunIntensity: 2.2,
      hemiSky: '#bcd4ff',
      hemiGround: '#2a3444',
      hemiIntensity: 0.7,
      rim: '#7affd0',
      rimIntensity: 0.6,
      exposure: 0.9,
      environment: 0.6,
      duskSun: '#9ab0ff',
      duskBackdrop: ['#010208', '#060c20', '#0e1630', '#020306'],
    },
    terrain: { soil: () => ({ map: createFrostSoilTexture() }), soilRoughness: 0.7 },
    water: {
      mode: 'ice',
      deep: '#3a6a8c',
      shallow: '#bfe0f2',
      skyLow: '#2a3a5a',
      skyHigh: '#dfeaff',
      foam: '#f4f8ff',
      flow: 0,
      clarity: 1,
    },
    ambientLife: ['seals', 'penguins', 'snow'],
    bankProps: ['pines'],
    unitFactories: DEFAULT_UNIT_FACTORIES,
    unitLook: { snow: 0.6, heat: 0 },
    sfxPreset: 'tundra',
    sky: { aurora: true },
    dusk: 0.4,
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];
