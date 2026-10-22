import { Color } from 'three';
import { registerSfxPreset } from '../audio/presets';
import { createBasaltTextures, createCobbleTexture, createFrostSoilTexture, createSoilTexture, SOIL_LOOKS } from '../materials/textures';
import { THEMES, type TerrainMaterials, type ThemeDef, type ThemePalette } from '../materials/themes';
import type { ThemeDirector } from '../scene/themeDirector';
import { setTeamUnitFactories, type UnitFactoryRegistry } from '../units/factories';
import { UNIT_ROLES, type TeamId, type UnitRole } from '../units/roles';
import { WAVE1 } from './data/wave1';
import { WAVE2 } from './data/wave2';
import { WAVE3 } from './data/wave3';
import { WAVE4 } from './data/wave4';
import { PLANNED } from './data/planned';
import { createKitFactories, resolveKit, type KitStyle } from './kit';
import { renderPortrait, type PortraitParams } from './portrait';
import type { Expression, FactionDef, FactionId, SoilKind } from './types';

/** Every faction: the finished waves first, then the planned ones in roadmap order. */
export const FACTION_LIST: readonly FactionDef[] = [...WAVE1, ...WAVE2, ...WAVE3, ...WAVE4, ...PLANNED];

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = Object.fromEntries(FACTION_LIST.map((f) => [f.id, f]));

export const FACTION_IDS: readonly FactionId[] = FACTION_LIST.map((f) => f.id);

for (const faction of FACTION_LIST) registerSfxPreset(faction.sfx);

export function getFaction(id: FactionId): FactionDef | undefined {
  return FACTIONS[id];
}

/** Short stable hash so different kit parameters never share cached geometry. */
function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

const kitCache = new Map<string, KitStyle>();

/** The faction's resolved kit, optionally with per-role parameter tweaks. */
export function factionKit(faction: FactionDef, role?: UnitRole): KitStyle {
  const params = { ...faction.kit, ...(role ? faction.unitSkins[role].kit : undefined) };
  const key = `${faction.id}:${hash(JSON.stringify([faction.palette, faction.motifs, params]))}`;
  let style = kitCache.get(key);
  if (!style) {
    style = resolveKit(key, faction.palette, faction.motifs, params);
    kitCache.set(key, style);
  }
  return style;
}

const registryCache = new Map<FactionId, UnitFactoryRegistry>();

/** One factory per role: hand-made pieces where the faction has them, the generic kit elsewhere. */
export function factionUnitFactories(faction: FactionDef): UnitFactoryRegistry {
  const cached = registryCache.get(faction.id);
  if (cached) return cached;
  const base = createKitFactories(factionKit(faction));
  const registry = { ...base };
  for (const role of UNIT_ROLES) {
    const skin = faction.unitSkins[role];
    if (skin.factory) registry[role] = skin.factory(factionKit(faction, role));
    else if (skin.kit) registry[role] = createKitFactories(factionKit(faction, role))[role];
  }
  registryCache.set(faction.id, registry);
  return registry;
}

function soil(kind: SoilKind): TerrainMaterials {
  switch (kind) {
    case 'cobble':
      return { soil: () => ({ map: createCobbleTexture() }), soilRoughness: 0.8 };
    case 'frost':
      return { soil: () => ({ map: createFrostSoilTexture() }), soilRoughness: 0.7 };
    case 'basalt':
      return { soil: () => createBasaltTextures(), soilGlowColor: '#ff7a2a', soilGlowIntensity: 1, soilRoughness: 0.85 };
    default:
      return { soil: () => ({ map: createSoilTexture(512, SOIL_LOOKS[kind]) }), soilRoughness: 0.94 };
  }
}

const hex = (c: Color) => `#${c.getHexString()}`;

/** Board colours a planned faction does not spell out, derived from its palette. */
function derivedBoard(faction: FactionDef): Partial<ThemePalette> {
  const primary = new Color(faction.palette.primary);
  const secondary = new Color(faction.palette.secondary);
  const stone = new Color(faction.palette.stone);
  const lightSoil = faction.river.soil === 'sand' || faction.river.soil === 'frost';
  return {
    capLight: hex(secondary.clone().lerp(new Color('#ffffff'), 0.35)),
    capDark: hex(primary.clone().multiplyScalar(0.62).lerp(new Color('#3a3a40'), 0.35)),
    frameTint: hex(stone.clone().lerp(new Color('#ffffff'), 0.5)),
    bankStone: hex(stone),
    // Rocks must stand apart from the soil: dark on light ground, light on dark ground.
    rock: hex(lightSoil ? stone.clone().multiplyScalar(0.55) : stone.clone().lerp(new Color('#ffffff'), 0.25)),
    riverBed: hex(stone.clone().multiplyScalar(0.85)),
  };
}

/** The visual theme a faction brings: its base theme with river, soil, light and life replaced. */
export function factionTheme(faction: FactionDef): ThemeDef {
  const base = THEMES[faction.baseTheme ?? 'vale'];
  return {
    ...base,
    id: `faccao:${faction.id}`,
    name: `${faction.name} · ${faction.river.name}`,
    palette: { ...base.palette, ...derivedBoard(faction), ...faction.board },
    terrain: soil(faction.river.soil),
    water: faction.river.water,
    ambientLife: faction.wildlife.species,
    bankProps: faction.river.bankProps,
    unitFactories: factionUnitFactories(faction),
    unitLook: { snow: 0, heat: 0 },
    sfxPreset: faction.sfx.id,
    sky: { aurora: faction.sky?.aurora ?? base.sky.aurora },
    dusk: faction.dusk ?? base.dusk,
  };
}

export interface ApplyFactionOptions {
  /** Also switch river, light, soil, wildlife and sound (default true). */
  environment?: boolean;
  /** Teams whose pieces use this faction (default both). Pieces placed afterwards pick it up. */
  teams?: readonly TeamId[];
}

/**
 * Makes a faction active. Typical use: `applyFaction('egito', themes)` for a
 * themed match, or `applyFaction('roma', themes, { environment: false, teams: ['red'] })`
 * to dress only the opponent's army. Existing pieces keep their old models;
 * re-place them (board.reset + populate) after switching.
 */
export function applyFaction(id: FactionId, director: ThemeDirector | null, options: ApplyFactionOptions = {}): FactionDef {
  const faction = FACTIONS[id];
  if (!faction) throw new Error(`Facção desconhecida: ${id}`);
  if (director && options.environment !== false) director.applyTheme(factionTheme(faction));
  const registry = factionUnitFactories(faction);
  for (const team of options.teams ?? (['blue', 'red'] as const)) setTeamUnitFactories(team, registry);
  return faction;
}

/** Portrait canvas of a faction's leader in one of the five expressions. */
export function leaderPortrait(faction: FactionDef, expression: Expression = 'neutral', size = 256): HTMLCanvasElement {
  const params: PortraitParams = { ...faction.leader.portrait, ...faction.leader.variants?.[expression] };
  return renderPortrait(params, expression, size);
}
