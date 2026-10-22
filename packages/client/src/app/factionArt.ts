import { FACTIONS as RULES, FACTION_IDS, type Archetype, type FactionId, type PlayerId } from '@riverfront/core';
import { colourById, nearestFreeColour } from '@riverfront/protocol';
import type { Expression } from '../factions/types';
import { TEAM_COLORS, setTeamPaletteMode } from '../materials/palettes';
import { THEMES, type ThemeId } from '../materials/themes';
import type { ThemeDirector } from '../scene/themeDirector';

/**
 * Glue between the rules' faction list (core) and the art registry
 * (factions/registry). The registry is big (kits, portraits, rivers), so it
 * is loaded on demand: menus show monograms until it arrives, and a match
 * waits for it before placing pieces.
 *
 * A faction is playable once the art side can dress it: 'pronta' factions
 * have hand-made art, 'planejada' ones use the generic kit and show as
 * "em breve". Factions missing from the registry cannot be picked.
 */

type Registry = typeof import('../factions/registry');

let registry: Registry | null = null;
let loading: Promise<Registry> | null = null;

export function loadFactionArt(): Promise<Registry> {
  loading ??= import('../factions/registry').then((m) => (registry = m));
  return loading;
}

export function factionArtReady(): boolean {
  return registry !== null;
}

export type FactionStatus = 'pronta' | 'em-breve' | 'sem-arte' | 'carregando';

export interface FactionChoice {
  readonly id: FactionId;
  readonly name: string;
  readonly wave: number;
  readonly archetype: Archetype | null;
  readonly status: FactionStatus;
  readonly playable: boolean;
  readonly brand: string;
  readonly leader: string;
  readonly special: { readonly name: string; readonly description: string } | null;
}

export function factionStatus(id: FactionId): FactionStatus {
  if (id === 'neutra') return 'pronta';
  if (!registry) return 'carregando';
  const art = registry.getFaction(id);
  if (!art) return 'sem-arte';
  return art.status === 'pronta' ? 'pronta' : 'em-breve';
}

export function factionChoices(): FactionChoice[] {
  return FACTION_IDS.map((id) => {
    const def = RULES[id];
    const status = factionStatus(id);
    return {
      id,
      name: def.name,
      wave: def.wave,
      archetype: def.archetype,
      status,
      playable: status === 'pronta' || status === 'em-breve',
      brand: def.brand,
      leader: `${def.leader.title} ${def.leader.name}`,
      special: def.specialShot ? { name: def.specialShot.name, description: def.specialShot.description } : null,
    };
  });
}

export function isPlayable(id: FactionId): boolean {
  const status = factionStatus(id);
  // While the registry loads, keep the player's saved choice.
  return status === 'pronta' || status === 'em-breve' || status === 'carregando';
}

const portraits = new Map<string, string>();

/** Data URL of a leader portrait (cached), or null without art (or before it loads). */
export function portraitUrl(id: FactionId, expression: Expression = 'neutral', size = 160): string | null {
  const art = registry?.getFaction(id);
  if (!registry || !art) return null;
  const key = `${id}:${expression}:${size}`;
  let url = portraits.get(key);
  if (!url) {
    try {
      url = registry.leaderPortrait(art, expression, size).toDataURL('image/png');
    } catch {
      return null;
    }
    portraits.set(key, url);
  }
  return url;
}

export type ThemeSetting = ThemeId | 'faccao';

export function isThemeSetting(value: string): value is ThemeSetting {
  return value === 'faccao' || value in THEMES;
}

/**
 * Sets the room and the armies for a match. The environment follows the
 * player's faction when the theme setting is "faccao"; the opponent's army
 * wears its own faction kit either way. Call after `loadFactionArt()`.
 */
export function dressMatch(themes: ThemeDirector, theme: ThemeSetting, seat: PlayerId, own: FactionId, enemy: FactionId): void {
  const base: ThemeId = theme === 'faccao' ? 'vale' : theme;
  themes.setTheme(base);
  const opponent: PlayerId = seat === 'blue' ? 'red' : 'blue';
  if (!registry) return;
  if (own !== 'neutra' && registry.getFaction(own)) registry.applyFaction(own, theme === 'faccao' ? themes : null, { teams: [seat] });
  if (enemy !== 'neutra' && registry.getFaction(enemy)) registry.applyFaction(enemy, null, { environment: false, teams: [opponent] });
}

/** The scenery for the menus. */
export function dressMenu(themes: ThemeDirector, theme: ThemeSetting, faction: FactionId): void {
  const base: ThemeId = theme === 'faccao' ? 'vale' : theme;
  themes.setTheme(base);
  if (registry && theme === 'faccao' && faction !== 'neutra' && registry.getFaction(faction)) registry.applyFaction(faction, themes, { teams: [] });
}

/**
 * Team colours from palette ids (protocol), written into the shared colour
 * objects every piece and flag uses. Colour-blind mode uses the safe pair.
 */
export function applyTeamColours(seat: PlayerId, ownColour: string, enemyColour: string, colorblind: boolean): { own: string; enemy: string } {
  setTeamPaletteMode(colorblind ? 'colorblind' : 'standard');
  const opponent: PlayerId = seat === 'blue' ? 'red' : 'blue';
  if (colorblind) {
    return { own: `#${TEAM_COLORS[seat].main.getHexString()}`, enemy: `#${TEAM_COLORS[opponent].main.getHexString()}` };
  }
  const own = colourById(ownColour)?.hex ?? '#2f6fde';
  const enemy = colourById(enemyColour)?.hex ?? '#d63a3a';
  for (const [team, hex] of [
    [seat, own],
    [opponent, enemy],
  ] as const) {
    const colours = TEAM_COLORS[team];
    colours.main.set(hex);
    colours.dark.set(hex).multiplyScalar(0.5);
    colours.glow.set(hex).lerp(colours.glow.clone().set('#ffffff'), 0.35);
  }
  return { own, enemy };
}

/** A colour for the bot that never clashes with the player's. */
export function botColour(playerColour: string): string {
  return nearestFreeColour(playerColour === 'vermelho' ? 'azul' : 'vermelho', [playerColour]);
}
