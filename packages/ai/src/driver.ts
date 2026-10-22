import { Match, PLAYERS, type FactionDef, type FactionId, type FieldConfig, type MutatorId, type PlayerId, type PresetId } from '@riverfront/core';
import type { Bot, BotAction } from './types.ts';

export interface BotTurnReport {
  readonly actions: number;
  /** Actions the match refused (a bot bug if ever non-zero). */
  readonly rejected: number;
  readonly thinkMs: number;
  readonly decisions: number;
  readonly slowestMs: number;
}

/**
 * Lets a bot play its whole turn (extra shots and an ability included) on a
 * local match. Only the bot's own view is ever handed to it.
 */
export function playBotTurn(match: Match, player: PlayerId, bot: Bot, onAction?: (action: BotAction) => void): BotTurnReport {
  let actions = 0;
  let rejected = 0;
  let thinkMs = 0;
  let decisions = 0;
  let slowestMs = 0;
  let allowAbility = true;
  let allowSpecial = true;
  for (let guard = 0; guard < 16 && match.phase === 'playing' && match.turn === player; guard++) {
    const view = match.viewFor(player);
    const started = performance.now();
    const action = bot.decide(view, { allowAbility, allowSpecial });
    const spent = performance.now() - started;
    thinkMs += spent;
    slowestMs = Math.max(slowestMs, spent);
    decisions++;
    onAction?.(action);
    if (action.type === 'ability') {
      const result = match.useAbility(player, action.request);
      if (result.ok) actions++;
      else {
        rejected++;
        allowAbility = false;
      }
      continue;
    }
    if (action.type === 'special') {
      const result = match.special(player, action.request);
      if (result.ok) actions++;
      else {
        rejected++;
        allowSpecial = false;
      }
      continue;
    }
    const result = match.attack(player, action.target);
    if (result.ok) {
      actions++;
      continue;
    }
    rejected++;
    // Never stall the match: fall back to the first open cell the match accepts.
    const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
    if (!open.some((c) => match.attack(player, { col: c.col, row: c.row }).ok)) break;
  }
  return { actions, rejected, thinkMs, decisions, slowestMs };
}

export interface BotMatchResult {
  readonly winner: PlayerId | null;
  readonly turns: number;
  readonly shots: Readonly<Record<PlayerId, number>>;
  readonly thinkMs: Readonly<Record<PlayerId, number>>;
  readonly decisions: Readonly<Record<PlayerId, number>>;
  readonly slowestMs: Readonly<Record<PlayerId, number>>;
  readonly rejected: number;
  readonly match: Match;
}

/** Plays a whole bot-versus-bot match, placement included. */
export function runBotMatch(options: {
  readonly seed: number;
  readonly config: FieldConfig | PresetId;
  readonly bots: Readonly<Record<PlayerId, Bot>>;
  readonly firstTurn?: PlayerId;
  readonly factions?: Readonly<Partial<Record<PlayerId, FactionId | FactionDef>>>;
  readonly mutators?: readonly MutatorId[];
}): BotMatchResult {
  const match = new Match({
    seed: options.seed,
    config: options.config,
    firstTurn: options.firstTurn ?? 'blue',
    ...(options.factions ? { factions: options.factions } : {}),
    ...(options.mutators ? { mutators: options.mutators } : {}),
  });
  let rejected = 0;
  for (const player of PLAYERS) {
    const layout = options.bots[player].placeLayout(match.viewFor(player));
    if (!match.setLayout(player, layout).ok) {
      rejected++;
      match.autoPlace(player);
    }
    match.confirm(player);
  }

  const thinkMs: Record<PlayerId, number> = { blue: 0, red: 0 };
  const decisions: Record<PlayerId, number> = { blue: 0, red: 0 };
  const slowestMs: Record<PlayerId, number> = { blue: 0, red: 0 };
  for (let guard = 0; guard < 4000 && match.phase === 'playing'; guard++) {
    const player = match.turn;
    const report = playBotTurn(match, player, options.bots[player]);
    thinkMs[player] += report.thinkMs;
    decisions[player] += report.decisions;
    slowestMs[player] = Math.max(slowestMs[player], report.slowestMs);
    rejected += report.rejected;
    if (report.actions === 0 && match.turn === player && match.phase === 'playing') match.surrender(player);
  }

  for (const player of PLAYERS) options.bots[player].gameOver(match.viewFor(player));
  const shots: Record<PlayerId, number> = { blue: 0, red: 0 };
  for (const entry of match.log) if (entry.type === 'attack' || entry.type === 'special') shots[entry.player]++;
  return { winner: match.winner, turns: match.turnNumber, shots, thinkMs, decisions, slowestMs, rejected, match };
}
