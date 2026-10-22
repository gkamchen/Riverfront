import {
  SEATS,
  TeamMatch,
  seatsOf,
  type FactionDef,
  type FactionId,
  type FieldConfig,
  type MutatorId,
  type PresetId,
  type SeatId,
  type TeamId,
} from '@riverfront/core';
import type { Bot } from './types.ts';

export interface SeatTurnReport {
  readonly actions: number;
  readonly rejected: number;
}

/**
 * One seat's whole turn in a doubles match. The bot sees the team view (its
 * partner's pieces and intel included), never the enemy layout.
 */
export function playSeatTurn(match: TeamMatch, seat: SeatId, bot: Bot): SeatTurnReport {
  let actions = 0;
  let rejected = 0;
  let allowAbility = true;
  let allowSpecial = true;
  const turn = match.turnNumber;
  for (let guard = 0; guard < 16 && match.phase === 'playing' && match.seatOnTurn === seat && match.turnNumber === turn; guard++) {
    const view = match.viewFor(seat);
    const action = bot.decide(view, { allowAbility, allowSpecial });
    if (action.type === 'ability') {
      if (match.useAbility(seat, action.request).ok) actions++;
      else {
        rejected++;
        allowAbility = false;
      }
      continue;
    }
    if (action.type === 'special') {
      if (match.special(seat, action.request).ok) actions++;
      else {
        rejected++;
        allowSpecial = false;
      }
      continue;
    }
    if (match.attack(seat, action.target).ok) {
      actions++;
      continue;
    }
    rejected++;
    const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
    if (!open.some((c) => match.attack(seat, { col: c.col, row: c.row }).ok)) break;
  }
  return { actions, rejected };
}

/**
 * Places one seat with its bot: the bot plans a layout for the whole team
 * and the seat keeps the part that belongs to it (falling back to an
 * automatic placement around the partner when the plan does not fit).
 */
export function placeSeat(match: TeamMatch, seat: SeatId, bot: Bot): boolean {
  const plan = bot.placeLayout(match.viewFor(seat));
  const mine = new Set(match.piecesOfSeat(seat).map((p) => p.id));
  const ok = plan.filter((p) => mine.has(p.pieceId)).every((p) => match.place(seat, p.pieceId, p.anchor, p.rotation).ok);
  if (ok && match.confirm(seat).ok) return true;
  // Plan did not fit around the partner: place automatically (reported as one refused plan).
  for (const id of mine) match.remove(seat, id);
  match.autoPlace(seat);
  match.confirm(seat);
  return false;
}

export interface TeamBotMatchResult {
  readonly winner: TeamId | null;
  readonly turns: number;
  /** Actions the match refused during play (a bot bug if ever non-zero). */
  readonly rejected: number;
  /** Seats whose own plan did not fit around the partner and were placed automatically. */
  readonly placementFallbacks: number;
  readonly match: TeamMatch;
}

/** A whole doubles match between four bots (placement included). */
export function runTeamBotMatch(options: {
  readonly seed: number;
  readonly config: FieldConfig | PresetId;
  readonly bots: Readonly<Record<SeatId, Bot>>;
  readonly firstTeam?: TeamId;
  readonly factions?: Readonly<Partial<Record<TeamId, FactionId | FactionDef>>>;
  readonly mutators?: readonly MutatorId[];
}): TeamBotMatchResult {
  const match = new TeamMatch({
    seed: options.seed,
    config: options.config,
    firstTeam: options.firstTeam ?? 'blue',
    ...(options.factions ? { factions: options.factions } : {}),
    ...(options.mutators ? { mutators: options.mutators } : {}),
  });
  let rejected = 0;
  let placementFallbacks = 0;
  // The first seat of each team places first; the partner fits around it.
  for (const team of ['blue', 'red'] as const) {
    for (const seat of seatsOf(team)) if (!placeSeat(match, seat, options.bots[seat])) placementFallbacks++;
  }
  for (let guard = 0; guard < 8000 && match.phase === 'playing'; guard++) {
    const seat = match.seatOnTurn!;
    const report = playSeatTurn(match, seat, options.bots[seat]);
    rejected += report.rejected;
    if (report.actions === 0 && match.seatOnTurn === seat && match.phase === 'playing') match.surrender(seat);
  }
  for (const seat of SEATS) options.bots[seat].gameOver(match.viewFor(seat));
  return { winner: match.winner, turns: match.turnNumber, rejected, placementFallbacks, match };
}
