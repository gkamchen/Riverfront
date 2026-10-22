import type { AbilityRequest } from './abilities.ts';
import {
  addStrike,
  initialClock,
  registerShot,
  resolveClock,
  spendTurn,
  turnDeadline,
  type ClockConfig,
  type ClockPresetId,
  type ClockState,
} from './clock.ts';
import type { FieldConfig, PresetId } from './config.ts';
import type { FactionDef, FactionId } from './factions.ts';
import type { GridSize } from './grid.ts';
import { Match, type MatchError } from './match.ts';
import type { MutatorId } from './mutators.ts';
import { LayoutBoard, candidatesFor, type PieceSpec, type Placement } from './placement.ts';
import type { RoleId } from './roles.ts';
import { createRng, hashSeed } from './rng.ts';
import { SHOT_KINDS, type SpecialShotRequest } from './shots.ts';
import { opponentOf, type Coord, type PlayerId, type Result, type Rotation } from './types.ts';
import type { AbilityOutcome, AttackOutcome, PlayerClockView, PlayerView, SpecialOutcome, WinReason } from './view.ts';

/**
 * Doubles (2 against 2). Rules, as built here:
 *
 * - Two teams ('blue' and 'red'), two seats each: 'blue-1', 'blue-2', 'red-1', 'red-2'.
 * - Each team shares one field and one army (the preset's). The pieces are
 *   split between the partners: seat 1 gets the bunker, antenna and generator
 *   (so the support rule never depends on the partner), the rest alternates so
 *   both end with about half. Each seat places only its own pieces; the team
 *   starts once both partners confirm.
 * - Turn order interleaves seats: A1, B1, A2, B2, A1… (A = the team that starts).
 *   Every turn follows the 1v1 rules: extra shots, one ability, one special shot.
 * - Energy, cooldowns, shield, special charges and all intel are the team's:
 *   the radar, spy or probe of one partner shows on the other's map too.
 * - Each seat has its own clock: timeouts and strikes count per seat, and a
 *   seat that forfeits on time loses the match for the team.
 * - `viewFor(seat)` is the team's view (the partner sees the whole team field
 *   and intel, never the enemy layout) plus seat information.
 * - The log lists seat actions; `TeamMatch.fromRecord` replays them exactly.
 *
 * Connection drops are left to the host: it can apply timeouts or surrender.
 */
export type TeamId = PlayerId;
export type SeatId = 'blue-1' | 'blue-2' | 'red-1' | 'red-2';

export const SEATS: readonly SeatId[] = ['blue-1', 'blue-2', 'red-1', 'red-2'];

export function teamOf(seat: SeatId): TeamId {
  return seat.startsWith('blue') ? 'blue' : 'red';
}

export function partnerOf(seat: SeatId): SeatId {
  const [team, n] = seat.split('-') as [TeamId, string];
  return `${team}-${n === '1' ? '2' : '1'}` as SeatId;
}

export function seatsOf(team: TeamId): readonly [SeatId, SeatId] {
  return [`${team}-1` as SeatId, `${team}-2` as SeatId];
}

/** Seat on turn for a turn number (1-based), given the team that starts. */
export function seatForTurn(turnNumber: number, first: TeamId): SeatId {
  const team = turnNumber % 2 === 1 ? first : opponentOf(first);
  const teamTurn = Math.ceil(turnNumber / 2);
  return `${team}-${((teamTurn - 1) % 2) + 1}` as SeatId;
}

const SUPPORT_TRIO: readonly RoleId[] = ['bunker', 'antenna', 'generator'];

/** Which seat places each piece of a team army. */
export function splitPieces(pieces: readonly PieceSpec[], team: TeamId): Readonly<Record<string, SeatId>> {
  const [one, two] = seatsOf(team);
  const out: Record<string, SeatId> = {};
  let count1 = 0;
  let count2 = 0;
  for (const p of pieces) {
    if (SUPPORT_TRIO.includes(p.role)) {
      out[p.id] = one;
      count1++;
    }
  }
  for (const p of pieces) {
    if (out[p.id]) continue;
    if (count2 <= count1) {
      out[p.id] = two;
      count2++;
    } else {
      out[p.id] = one;
      count1++;
    }
  }
  return out;
}

export interface TeamMatchOptions {
  readonly seed: number;
  readonly config?: FieldConfig | PresetId;
  readonly size?: { readonly cols: number; readonly rows: number };
  /** Team that plays first. Default 'blue'. */
  readonly firstTeam?: TeamId;
  /** Clock of every seat. Default 'unlimited'. */
  readonly clock?: ClockPresetId | ClockConfig;
  readonly startTime?: number;
  readonly factions?: Readonly<Partial<Record<TeamId, FactionId | FactionDef>>>;
  readonly mutators?: readonly MutatorId[];
}

export type TeamError = MatchError | 'not-your-piece';

export type TeamLogEntry =
  | { readonly type: 'place'; readonly seat: SeatId; readonly pieceId: string; readonly anchor: Coord; readonly rotation: Rotation; readonly at: number }
  | { readonly type: 'remove'; readonly seat: SeatId; readonly pieceId: string; readonly at: number }
  | { readonly type: 'auto'; readonly seat: SeatId; readonly seed: number; readonly at: number }
  | { readonly type: 'confirm'; readonly seat: SeatId; readonly at: number }
  | { readonly type: 'attack'; readonly seat: SeatId; readonly target: Coord; readonly at: number }
  | { readonly type: 'ability'; readonly seat: SeatId; readonly request: AbilityRequest; readonly at: number }
  | { readonly type: 'special'; readonly seat: SeatId; readonly request: SpecialShotRequest; readonly at: number }
  | { readonly type: 'timeout'; readonly seat: SeatId; readonly at: number }
  | { readonly type: 'surrender'; readonly seat: SeatId; readonly at: number };

export interface TeamMatchRecord {
  readonly seed: number;
  readonly config: FieldConfig;
  readonly firstTeam: TeamId;
  readonly clock: ClockPresetId | ClockConfig;
  readonly startTime: number;
  readonly factions?: Readonly<Partial<Record<TeamId, FactionId | FactionDef>>>;
  readonly mutators?: readonly MutatorId[];
  readonly log: readonly TeamLogEntry[];
}

export interface SeatInfo {
  readonly seat: SeatId;
  readonly confirmed: boolean;
  readonly pieces: readonly string[];
  readonly clock: PlayerClockView;
}

/** A seat's view: the team's `PlayerView` plus who is who. */
export type TeamView = PlayerView & {
  readonly doubles: {
    readonly seat: SeatId;
    readonly partner: SeatId;
    readonly seatOnTurn: SeatId | null;
    readonly myTurn: boolean;
    /** Owner seat of each piece of the own team. */
    readonly pieceOwners: Readonly<Record<string, SeatId>>;
    readonly team: readonly [SeatInfo, SeatInfo];
    /** Public part of the enemy seats (no pieces). */
    readonly enemy: readonly [Omit<SeatInfo, 'pieces'>, Omit<SeatInfo, 'pieces'>];
    /** Turn deadline of the seat on turn, null without a limit. */
    readonly deadline: number | null;
  };
};

/** No limit and no strike-out: the seat clocks live in `TeamMatch`. */
const INNER_CLOCK: ClockConfig = {
  id: 'custom',
  turnMs: null,
  bankMs: 0,
  maxConsecutiveStrikes: Number.MAX_SAFE_INTEGER,
  maxStrikes: Number.MAX_SAFE_INTEGER,
  graceDropMs: Number.MAX_SAFE_INTEGER,
  graceTotalMs: Number.MAX_SAFE_INTEGER,
};

const fail = <E extends string>(error: E) => ({ ok: false as const, error });

export class TeamMatch {
  readonly #match: Match;
  readonly #first: TeamId;
  readonly #clockOption: ClockPresetId | ClockConfig;
  readonly #clock: ClockConfig;
  readonly #startTime: number;
  readonly #options: TeamMatchOptions;
  readonly #owners: Record<TeamId, Readonly<Record<string, SeatId>>>;
  readonly #confirmed: Record<SeatId, boolean> = { 'blue-1': false, 'blue-2': false, 'red-1': false, 'red-2': false };
  readonly #clocks: Record<SeatId, ClockState>;
  readonly #autoCount: Record<SeatId, number> = { 'blue-1': 0, 'blue-2': 0, 'red-1': 0, 'red-2': 0 };
  readonly #log: TeamLogEntry[] = [];
  #now: number;
  #turnStartedAt: number;
  #timedOut: { team: TeamId; reason: WinReason } | null = null;

  constructor(options: TeamMatchOptions) {
    this.#options = options;
    this.#first = options.firstTeam ?? 'blue';
    this.#clockOption = options.clock ?? 'unlimited';
    this.#clock = resolveClock(options.clock);
    this.#startTime = options.startTime ?? 0;
    this.#now = this.#startTime;
    this.#turnStartedAt = this.#startTime;
    this.#match = new Match({
      seed: options.seed,
      ...(options.config !== undefined ? { config: options.config } : {}),
      ...(options.size ? { size: options.size } : {}),
      firstTurn: this.#first,
      clock: INNER_CLOCK,
      startTime: this.#startTime,
      ...(options.factions ? { factions: options.factions } : {}),
      ...(options.mutators ? { mutators: options.mutators } : {}),
    });
    this.#owners = { blue: splitPieces(this.#match.piecesOf('blue'), 'blue'), red: splitPieces(this.#match.piecesOf('red'), 'red') };
    const fresh = initialClock(this.#clock);
    this.#clocks = { 'blue-1': fresh, 'blue-2': fresh, 'red-1': fresh, 'red-2': fresh };
  }

  static fromRecord(record: TeamMatchRecord): TeamMatch {
    const match = new TeamMatch({
      seed: record.seed,
      config: record.config,
      firstTeam: record.firstTeam,
      clock: record.clock,
      startTime: record.startTime,
      ...(record.factions ? { factions: record.factions } : {}),
      ...(record.mutators ? { mutators: record.mutators } : {}),
    });
    for (const entry of record.log) match.#replay(entry);
    return match;
  }

  // ------------------------------------------------------------ state

  get phase() {
    return this.#match.phase;
  }

  get turnNumber(): number {
    return this.#match.turnNumber;
  }

  get turnTeam(): TeamId {
    return this.#match.turn;
  }

  get seatOnTurn(): SeatId | null {
    return this.#match.phase === 'playing' ? seatForTurn(this.#match.turnNumber, this.#first) : null;
  }

  get winner(): TeamId | null {
    return this.#match.winner;
  }

  get winReason(): WinReason | null {
    return this.#timedOut?.reason ?? this.#match.winReason;
  }

  get config(): FieldConfig {
    return this.#match.config;
  }

  get now(): number {
    return this.#now;
  }

  get log(): readonly TeamLogEntry[] {
    return [...this.#log];
  }

  ownerOf(team: TeamId, pieceId: string): SeatId | null {
    return this.#owners[team][pieceId] ?? null;
  }

  piecesOfSeat(seat: SeatId): PieceSpec[] {
    const team = teamOf(seat);
    return this.#match.piecesOf(team).filter((p) => this.#owners[team][p.id] === seat);
  }

  toRecord(): TeamMatchRecord {
    return {
      seed: this.#match.seed,
      config: this.#match.config,
      firstTeam: this.#first,
      clock: this.#clockOption,
      startTime: this.#startTime,
      ...(this.#options.factions ? { factions: { ...this.#options.factions } } : {}),
      ...(this.#options.mutators?.length ? { mutators: [...this.#options.mutators] } : {}),
      log: this.log,
    };
  }

  // ------------------------------------------------------------ placement

  #placingGate(seat: SeatId, pieceId?: string): TeamError | null {
    if (this.#match.phase === 'finished') return 'finished';
    if (this.#match.phase !== 'placing') return 'wrong-phase';
    if (this.#confirmed[seat]) return 'already-confirmed';
    if (pieceId !== undefined && this.#owners[teamOf(seat)][pieceId] !== seat) {
      return this.#owners[teamOf(seat)][pieceId] ? 'not-your-piece' : 'unknown-piece';
    }
    return null;
  }

  place(seat: SeatId, pieceId: string, anchor: Coord, rotation: Rotation = 0): Result<object, TeamError> {
    const gate = this.#placingGate(seat, pieceId);
    if (gate) return fail(gate);
    const result = this.#match.place(teamOf(seat), pieceId, anchor, rotation);
    if (result.ok) this.#record({ type: 'place', seat, pieceId, anchor: { col: anchor.col, row: anchor.row }, rotation, at: this.#now });
    return result;
  }

  remove(seat: SeatId, pieceId: string): Result<object, TeamError> {
    const gate = this.#placingGate(seat, pieceId);
    if (gate) return fail(gate);
    const result = this.#match.remove(teamOf(seat), pieceId);
    if (result.ok) this.#record({ type: 'remove', seat, pieceId, at: this.#now });
    return result;
  }

  /** Places this seat's pieces at random around whatever the partner already placed. */
  autoPlace(seat: SeatId, seed?: number): Result<{ readonly placements: readonly Placement[] }, TeamError> {
    const gate = this.#placingGate(seat);
    if (gate) return fail(gate);
    const used = (seed ?? hashSeed(this.#match.seed, 'team-auto', seat, this.#autoCount[seat])) >>> 0;
    this.#autoCount[seat]++;
    const placements = this.#planSeat(seat, used);
    if (!placements) return fail('layout-incomplete');
    const team = teamOf(seat);
    for (const p of this.piecesOfSeat(seat)) this.#match.remove(team, p.id);
    for (const p of placements) {
      const r = this.#match.place(team, p.pieceId, p.anchor, p.rotation);
      if (!r.ok) return fail(r.error);
    }
    this.#record({ type: 'auto', seat, seed: used, at: this.#now });
    return { ok: true, placements };
  }

  #planSeat(seat: SeatId, seed: number): Placement[] | null {
    const team = teamOf(seat);
    const view = this.#match.viewFor(team);
    const size: GridSize = { cols: view.config.cols, rows: view.config.rows };
    const pieces = this.#match.piecesOf(team);
    const board = new LayoutBoard(size, view.own.cells.map((c) => c.terrain), pieces);
    const mine = new Set(this.piecesOfSeat(seat).map((p) => p.id));
    const partner: Placement[] = view.own.pieces.flatMap((p) => (p.placement && !mine.has(p.id) ? [p.placement] : []));
    const rng = createRng(seed);
    // Support pieces first (bunker and antenna before the generator), then the bigger ones.
    const rank = (p: PieceSpec) => (p.role === 'generator' ? 1 : SUPPORT_TRIO.includes(p.role) ? 0 : 2 + (10 - p.shape.length));
    const order = pieces.map((p, slot) => ({ p, slot })).filter((x) => mine.has(x.p.id)).sort((a, b) => rank(a.p) - rank(b.p) || a.slot - b.slot);
    for (let attempt = 0; attempt < 200; attempt++) {
      board.clearAll();
      for (const p of partner) board.place(board.slotOf(p.pieceId), p.anchor, p.rotation);
      let ok = true;
      for (const { slot } of order) {
        const candidates = candidatesFor(board, slot);
        if (candidates.length === 0) {
          ok = false;
          break;
        }
        const c = rng.pick(candidates);
        board.put(slot, c.anchor, c.rotation, c.cells);
      }
      if (ok) return board.placements().filter((p) => mine.has(p.pieceId));
    }
    return null;
  }

  confirm(seat: SeatId): Result<object, TeamError> {
    const gate = this.#placingGate(seat);
    if (gate) return fail(gate);
    const team = teamOf(seat);
    const issues = this.#match.viewFor(team).own.issues.filter((i) => this.#owners[team][i.pieceId] === seat);
    const issue = issues[0];
    if (issue) return fail(issue.error === 'not-placed' ? 'layout-incomplete' : issue.error);
    if (this.#confirmed[partnerOf(seat)]) {
      const r = this.#match.confirm(team);
      if (!r.ok) return r;
    }
    this.#confirmed[seat] = true;
    this.#record({ type: 'confirm', seat, at: this.#now });
    if (this.#match.phase === 'playing') this.#turnStartedAt = this.#now;
    return { ok: true };
  }

  // ------------------------------------------------------------ playing

  #turnGate(seat: SeatId): TeamError | null {
    if (this.#match.phase === 'finished') return 'finished';
    if (this.#match.phase !== 'playing') return 'wrong-phase';
    return this.seatOnTurn === seat ? null : 'not-your-turn';
  }

  /** Charges the seat that just played when the turn moved on. */
  #afterAction(seat: SeatId, turnBefore: number, shot: boolean): void {
    if (shot) this.#clocks[seat] = registerShot(this.#clocks[seat]);
    if (this.#match.turnNumber !== turnBefore && this.#match.phase === 'playing') {
      this.#clocks[seat] = spendTurn(this.#clock, this.#clocks[seat], this.#now - this.#turnStartedAt);
      this.#turnStartedAt = this.#now;
    }
  }

  attack(seat: SeatId, target: Coord): Result<{ readonly outcome: AttackOutcome }, TeamError> {
    const gate = this.#turnGate(seat);
    if (gate) return fail(gate);
    const before = this.#match.turnNumber;
    const result = this.#match.attack(teamOf(seat), target);
    if (result.ok) {
      this.#record({ type: 'attack', seat, target: { col: target.col, row: target.row }, at: this.#now });
      this.#afterAction(seat, before, true);
    }
    return result;
  }

  useAbility(seat: SeatId, request: AbilityRequest): Result<{ readonly outcome: AbilityOutcome }, TeamError> {
    const gate = this.#turnGate(seat);
    if (gate) return fail(gate);
    const before = this.#match.turnNumber;
    const result = this.#match.useAbility(teamOf(seat), request);
    if (result.ok) {
      this.#record({ type: 'ability', seat, request, at: this.#now });
      this.#afterAction(seat, before, false);
    }
    return result;
  }

  special(seat: SeatId, request: SpecialShotRequest): Result<{ readonly outcome: SpecialOutcome }, TeamError> {
    const gate = this.#turnGate(seat);
    if (gate) return fail(gate);
    const before = this.#match.turnNumber;
    const result = this.#match.special(teamOf(seat), request);
    if (result.ok) {
      this.#record({ type: 'special', seat, request, at: this.#now });
      this.#afterAction(seat, before, SHOT_KINDS[result.outcome.kind].isShot);
    }
    return result;
  }

  surrender(seat: SeatId): Result<object, TeamError> {
    if (this.#match.phase === 'finished') return fail('finished');
    const r = this.#match.surrender(teamOf(seat));
    if (r.ok) this.#record({ type: 'surrender', seat, at: this.#now });
    return r;
  }

  /** Advances the clocks to `now`, applying every seat timeout that expired on the way. */
  tick(now: number): { readonly seat: SeatId; readonly forfeit: boolean }[] {
    const events: { seat: SeatId; forfeit: boolean }[] = [];
    for (let guard = 0; guard < 64 && this.#match.phase === 'playing'; guard++) {
      const seat = this.seatOnTurn!;
      const deadline = turnDeadline(this.#clock, this.#clocks[seat], this.#turnStartedAt);
      if (deadline === null || now < deadline) break;
      events.push({ seat, forfeit: this.#timeout(seat, deadline) });
    }
    if (now > this.#now) {
      this.#now = now;
      this.#match.tick(now);
    }
    return events;
  }

  /** Server-side timeout of the seat on turn. */
  applyTimeout(seat: SeatId): Result<object, TeamError> {
    const gate = this.#turnGate(seat);
    if (gate) return fail(gate);
    this.#timeout(seat, this.#now);
    return { ok: true };
  }

  #timeout(seat: SeatId, at: number): boolean {
    if (at > this.#now) {
      this.#now = at;
      this.#match.tick(at);
    }
    this.#clocks[seat] = spendTurn(this.#clock, this.#clocks[seat], at - this.#turnStartedAt);
    const { state, forfeit } = addStrike(this.#clock, this.#clocks[seat]);
    this.#clocks[seat] = state;
    this.#record({ type: 'timeout', seat, at });
    if (forfeit) {
      this.#match.surrender(teamOf(seat));
      this.#timedOut = { team: opponentOf(teamOf(seat)), reason: 'timeout' };
    } else {
      this.#match.applyTimeout(teamOf(seat));
      this.#turnStartedAt = at;
    }
    return forfeit;
  }

  // ------------------------------------------------------------ log and views

  #record(entry: TeamLogEntry): void {
    this.#log.push(entry);
  }

  #replay(entry: TeamLogEntry): void {
    if (entry.type !== 'timeout') this.tick(entry.at);
    let result: { ok: boolean; error?: string } = { ok: true };
    switch (entry.type) {
      case 'place':
        result = this.place(entry.seat, entry.pieceId, entry.anchor, entry.rotation);
        break;
      case 'remove':
        result = this.remove(entry.seat, entry.pieceId);
        break;
      case 'auto':
        result = this.autoPlace(entry.seat, entry.seed);
        break;
      case 'confirm':
        result = this.confirm(entry.seat);
        break;
      case 'attack':
        result = this.attack(entry.seat, entry.target);
        break;
      case 'ability':
        result = this.useAbility(entry.seat, entry.request);
        break;
      case 'special':
        result = this.special(entry.seat, entry.request);
        break;
      case 'timeout':
        if (this.seatOnTurn !== entry.seat) result = { ok: false, error: 'not-your-turn' };
        else this.#timeout(entry.seat, entry.at);
        break;
      case 'surrender':
        result = this.surrender(entry.seat);
        break;
    }
    if (!result.ok) throw new Error(`Team log entry rejected (${entry.type}): ${result.error ?? 'unknown'}`);
  }

  #clockView(seat: SeatId): PlayerClockView {
    const c = this.#clocks[seat];
    return { bankMs: c.bankMs, strikes: c.strikes, consecutiveStrikes: c.consecutiveStrikes, connected: true, graceLeftMs: null };
  }

  viewFor(seat: SeatId): TeamView {
    const team = teamOf(seat);
    const base = this.#match.viewFor(team);
    const onTurn = this.seatOnTurn;
    const info = (s: SeatId): SeatInfo => ({
      seat: s,
      confirmed: this.#confirmed[s],
      pieces: this.piecesOfSeat(s).map((p) => p.id),
      clock: this.#clockView(s),
    });
    const publicInfo = (s: SeatId) => ({ seat: s, confirmed: this.#confirmed[s], clock: this.#clockView(s) });
    const [e1, e2] = seatsOf(opponentOf(team));
    const deadline = onTurn ? turnDeadline(this.#clock, this.#clocks[onTurn], this.#turnStartedAt) : null;
    return {
      ...base,
      winReason: this.winReason,
      own: { ...base.own, clock: this.#clockView(seat) },
      doubles: {
        seat,
        partner: partnerOf(seat),
        seatOnTurn: onTurn,
        myTurn: onTurn === seat,
        pieceOwners: { ...this.#owners[team] },
        team: [info(seatsOf(team)[0]), info(seatsOf(team)[1])],
        enemy: [publicInfo(e1), publicInfo(e2)],
        deadline,
      },
    };
  }

  /** Authoritative state for checks and debugging (both layouts inside). */
  serverState(): unknown {
    return {
      match: this.#match.serverState(),
      confirmed: { ...this.#confirmed },
      clocks: { ...this.#clocks },
      turnStartedAt: this.#turnStartedAt,
      timedOut: this.#timedOut,
      autoCount: { ...this.#autoCount },
    };
  }
}

/** Cells covered by a seat's pieces in a team view (handy for UIs and bots). */
export function seatCells(view: TeamView, seat: SeatId = view.doubles.seat): Coord[] {
  const owners = view.doubles.pieceOwners;
  return view.own.pieces.filter((p) => owners[p.id] === seat).flatMap((p) => p.cells.map((c) => ({ ...c })));
}
