import type { ClockPresetId } from './clock.ts';
import type { PresetId } from './config.ts';
import { FACTIONS, type FactionId } from './factions.ts';
import type { Match, MatchOptions } from './match.ts';
import type { MutatorId } from './mutators.ts';
import { createRng, dailySeed } from './rng.ts';
import type { PlayerId } from './types.ts';

/**
 * Daily challenge: everyone gets the same seed, mode, mutators, factions and
 * opponent level on the same UTC day. The player is always blue and starts.
 */
export interface DailyChallenge {
  /** UTC day, "2026-10-20". */
  readonly id: string;
  readonly seed: number;
  readonly preset: PresetId;
  readonly mutators: readonly MutatorId[];
  readonly playerFaction: FactionId;
  readonly opponentFaction: FactionId;
  /** Level of the bot to face (the bot itself lives in @riverfront/ai). */
  readonly botLevel: 1 | 2 | 3 | 4 | 5;
  readonly clock: ClockPresetId;
  /** Short pt-BR summary for the menu. */
  readonly description: string;
}

const DAILY_PRESETS: readonly PresetId[] = ['full', 'rapido-poderes', 'classic', 'rapido', 'full', 'rapido-poderes'];
const DAILY_MUTATORS: readonly (readonly MutatorId[])[] = [[], ['mare'], ['neblina'], ['tiro-duplo'], ['mare', 'neblina'], ['mare', 'tiro-duplo']];
const WAVE1: readonly FactionId[] = ['egito', 'roma', 'grecia'];
const POWERED: readonly PresetId[] = ['full', 'rapido-poderes'];

const PRESET_NAMES: Readonly<Partial<Record<PresetId, string>>> = {
  full: 'Completo',
  classic: 'Clássico',
  rapido: 'Rápido',
  'rapido-poderes': 'Rápido com poderes',
};

export function dailyChallenge(date: Date | string): DailyChallenge {
  const seed = dailySeed(date);
  const id = typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);
  const rng = createRng(seed);
  const preset = rng.pick(DAILY_PRESETS);
  const mutators = [...rng.pick(DAILY_MUTATORS)];
  const powered = POWERED.includes(preset);
  const playerFaction: FactionId = powered ? rng.pick(WAVE1) : 'neutra';
  const opponentFaction: FactionId = powered ? rng.pick(WAVE1) : 'neutra';
  const botLevel = (3 + rng.int(2)) as 3 | 4;
  const parts = [`Modo ${PRESET_NAMES[preset] ?? preset}`];
  if (powered) parts.push(`você joga com ${FACTIONS[playerFaction].name} contra ${FACTIONS[opponentFaction].name}`);
  if (mutators.length) parts.push(`mutadores: ${mutators.join(', ')}`);
  parts.push(`adversário nível ${botLevel}`);
  return { id, seed, preset, mutators, playerFaction, opponentFaction, botLevel, clock: 'padrao', description: `${parts.join('; ')}.` };
}

/** Options for `new Match` (the player is blue). */
export function dailyMatchOptions(challenge: DailyChallenge, startTime = 0): MatchOptions {
  return {
    seed: challenge.seed,
    config: challenge.preset,
    firstTurn: 'blue',
    clock: challenge.clock,
    startTime,
    factions: { blue: challenge.playerFaction, red: challenge.opponentFaction },
    mutators: challenge.mutators,
  };
}

export interface DailyResult {
  readonly name: string;
  readonly won: boolean;
  /** Shots fired (attacks and attacking special shots). */
  readonly shots: number;
  readonly timeMs: number;
  /** Enemy unit cells destroyed (what a loss still scores). */
  readonly destroyed: number;
}

export interface DailyEntry extends DailyResult {
  readonly score: number;
}

/**
 * Score: a win is worth 5000 minus 20 per shot and 1 per second (never under
 * 1000); a loss scores 25 per enemy cell destroyed. Fewer shots beat less time.
 */
export function dailyScore(result: Omit<DailyResult, 'name'>): number {
  if (!result.won) return Math.max(0, Math.round(result.destroyed * 25));
  return Math.max(1000, Math.round(5000 - result.shots * 20 - result.timeMs / 1000));
}

/** Reads a finished daily match from the player's side (blue by default). */
export function dailyResultFromMatch(match: Match, name: string, timeMs: number, player: PlayerId = 'blue'): DailyResult {
  const view = match.viewFor(player);
  const shots = match.log.filter((e) => (e.type === 'attack' || e.type === 'special') && e.player === player).length;
  return {
    name,
    won: match.winner === player,
    shots,
    timeMs: Math.max(0, Math.round(timeMs)),
    destroyed: view.enemy.unitCellsTotal - view.enemy.unitCellsLeft,
  };
}

/** Result table of one day. Plain JSON. */
export interface DailyBoard {
  readonly challengeId: string;
  readonly entries: readonly DailyEntry[];
}

export const DAILY_BOARD_SIZE = 100;

export function emptyDailyBoard(challengeId: string): DailyBoard {
  return { challengeId, entries: [] };
}

function better(a: DailyEntry, b: DailyEntry): number {
  return b.score - a.score || a.shots - b.shots || a.timeMs - b.timeMs || a.name.localeCompare(b.name);
}

/** Adds a result, keeping the best one per name, sorted and capped. Returns a new board. */
export function addDailyResult(board: DailyBoard, result: DailyResult): DailyBoard {
  const entry: DailyEntry = { ...result, score: dailyScore(result) };
  const previous = board.entries.find((e) => e.name === result.name);
  if (previous && better(previous, entry) <= 0) return board;
  const entries = [...board.entries.filter((e) => e.name !== result.name), entry].sort(better).slice(0, DAILY_BOARD_SIZE);
  return { challengeId: board.challengeId, entries };
}

/** Position (1-based) of a name in the board, or null. */
export function dailyRank(board: DailyBoard, name: string): number | null {
  const i = board.entries.findIndex((e) => e.name === name);
  return i >= 0 ? i + 1 : null;
}

/** Validates a board read from storage or the network. */
export function parseDailyBoard(data: unknown): DailyBoard | null {
  if (!data || typeof data !== 'object') return null;
  const board = data as Partial<DailyBoard>;
  if (typeof board.challengeId !== 'string' || !Array.isArray(board.entries)) return null;
  const entries: DailyEntry[] = [];
  for (const e of board.entries as unknown[]) {
    const x = e as Partial<DailyEntry>;
    if (typeof x?.name !== 'string' || typeof x.won !== 'boolean') return null;
    for (const n of [x.shots, x.timeMs, x.destroyed]) if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
    const result: DailyResult = { name: x.name, won: x.won, shots: x.shots!, timeMs: x.timeMs!, destroyed: x.destroyed! };
    entries.push({ ...result, score: dailyScore(result) });
  }
  return { challengeId: board.challengeId, entries: entries.sort(better).slice(0, DAILY_BOARD_SIZE) };
}
