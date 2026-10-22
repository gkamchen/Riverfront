import {
  CLASSIC_CONFIG,
  FULL_CONFIG,
  PRESETS,
  type ClockPresetId,
  type FactionId,
  type FieldConfig,
  type MutatorId,
  type PresetId,
  type SeatId,
} from '@riverfront/core';

/** Ways to start a match from the main menu. */
export type PlayMode = 'quick' | 'training' | 'bot' | 'doubles' | 'daily' | 'campaign' | 'online';

/** Rule presets a player picks before a match. */
export type GameModeId = 'classico' | 'completo' | 'rapido' | 'rapido-poderes';

export const GAME_MODE_IDS: readonly GameModeId[] = ['classico', 'completo', 'rapido', 'rapido-poderes'];

export interface GameModeDef {
  readonly id: GameModeId;
  /** Core preset ids tried in order; the first one the core knows wins. */
  readonly presets: readonly string[];
  /** Used when none of `presets` exists yet. */
  readonly fallback: FieldConfig;
  readonly clock: ClockPresetId;
  readonly powers: boolean;
}

export const GAME_MODES: Readonly<Record<GameModeId, GameModeDef>> = {
  classico: { id: 'classico', presets: ['classic'], fallback: CLASSIC_CONFIG, clock: 'padrao', powers: false },
  completo: { id: 'completo', presets: ['full'], fallback: FULL_CONFIG, clock: 'padrao', powers: true },
  rapido: { id: 'rapido', presets: ['rapido', 'rapid', 'quick'], fallback: CLASSIC_CONFIG, clock: 'relampago', powers: false },
  'rapido-poderes': {
    id: 'rapido-poderes',
    presets: ['rapido-poderes', 'rapido-full', 'rapid-full'],
    fallback: FULL_CONFIG,
    clock: 'relampago',
    powers: true,
  },
};

/** The core config a mode plays with (newer core presets are picked up when they appear). */
export function resolveModeConfig(id: GameModeId, presets: Readonly<Record<string, FieldConfig | undefined>> = PRESETS): FieldConfig {
  const def = GAME_MODES[id];
  for (const name of def.presets) {
    const config = presets[name];
    if (config) return config;
  }
  return def.fallback;
}

export function isGameModeId(value: unknown): value is GameModeId {
  return typeof value === 'string' && (GAME_MODE_IDS as readonly string[]).includes(value);
}

/** Server rooms only know these two. */
export function onlineModeOf(id: GameModeId): 'classic' | 'full' {
  return GAME_MODES[id].powers ? 'full' : 'classic';
}

export type BotLevelId = 1 | 2 | 3 | 4 | 5;

/** Everything needed to set up a local match. */
export interface MatchSetup {
  readonly play: Exclude<PlayMode, 'online'>;
  readonly mode: GameModeId;
  readonly clock: ClockPresetId;
  readonly level: BotLevelId;
  readonly faction: FactionId;
  readonly botFaction: FactionId;
  readonly mutators: readonly MutatorId[];
  readonly seed: number;
  /** Doubles: the player's seat and the partner bot's level. */
  readonly doubles?: { readonly seat: SeatId; readonly partnerLevel: BotLevelId };
  /** Daily challenge id (UTC day) or campaign mission id. */
  readonly daily?: string;
  readonly mission?: string;
}

export function quickSetup(seed: number, last?: Partial<MatchSetup>): MatchSetup {
  return {
    play: 'quick',
    mode: last?.mode ?? 'completo',
    clock: last?.clock ?? GAME_MODES[last?.mode ?? 'completo'].clock,
    level: last?.level ?? 2,
    faction: last?.faction ?? 'neutra',
    botFaction: last?.botFaction ?? 'neutra',
    mutators: last?.mutators ?? [],
    seed,
  };
}

/** Training: gentle bot, no clock, coach on. */
export function trainingSetup(seed: number, faction: FactionId = 'neutra'): MatchSetup {
  return { play: 'training', mode: 'completo', clock: 'unlimited', level: 1, faction, botFaction: 'neutra', mutators: [], seed };
}

/** Local matches can pause (no one waits on the other side); online ones cannot. */
export function canPause(play: PlayMode): boolean {
  return play !== 'online';
}

/** Next level after a win, if there is one. */
export function nextLevel(level: BotLevelId): BotLevelId | null {
  return level < 5 ? ((level + 1) as BotLevelId) : null;
}

/** Menu mode of a core preset id (daily challenge and campaign come as preset ids). */
export function modeOfPreset(preset: PresetId): GameModeId {
  switch (preset) {
    case 'classic':
    case 'classico':
      return 'classico';
    case 'rapido':
      return 'rapido';
    case 'rapido-poderes':
      return 'rapido-poderes';
    default:
      return 'completo';
  }
}