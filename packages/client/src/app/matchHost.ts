import {
  Match,
  TeamMatch,
  partnerOf,
  seatsOf,
  teamOf,
  type AbilityRequest,
  type SeatId,
  type TeamView,
  type Coord,
  type MatchError,
  type Placement,
  type PlayerId,
  type PlayerView,
  type SpecialShotRequest,
} from '@riverfront/core';
import type { Bot, BotAction } from '@riverfront/ai';
import { opponentLayoutSeed, type MatchEvent } from '@riverfront/protocol';
import type { AiModule } from './aiLoader';
import type { OnlineSession, RemoteMatchHost } from '../net';
import { resolveModeConfig, type MatchSetup } from './modes';

export type HostResult = { readonly ok: true } | { readonly ok: false; readonly error: string; readonly message?: string };

export type HostUpdate =
  /** Whole state (start, reconnection): redraw without animation. */
  | { readonly kind: 'state'; readonly view: PlayerView }
  /** Something happened; `view` is the state after it. */
  | { readonly kind: 'event'; readonly view: PlayerView; readonly event: MatchEvent | null };

/**
 * What the game controller may ask of a match, local or on a server. Actions
 * only say whether they were accepted; results always arrive through
 * `onUpdate`, so local and online matches animate the same way.
 */
export interface GameHost {
  readonly online: boolean;
  readonly seat: PlayerId;
  view(): PlayerView | null;
  /** Current time in the clock domain of `view().clock`. */
  now(): number;
  onUpdate(listener: (update: HostUpdate) => void): () => void;
  submitLayout(placements: readonly Placement[], confirm: boolean): Promise<HostResult>;
  attack(target: Coord): Promise<HostResult>;
  ability(request: AbilityRequest): Promise<HostResult>;
  special(request: SpecialShotRequest): Promise<HostResult>;
  surrender(): Promise<HostResult>;
  dispose(): void;
}

/**
 * Local hosts where bots hold some seats. The controller paces them: one bot
 * decision per call, animated before the next.
 */
export interface BotDriven {
  /** Voice of the opponent (taunts and lines). */
  readonly bot: Bot;
  placeBot(): void;
  botStep(): BotAction | null;
  advance(ms: number): void;
}

export function isBotDriven(host: GameHost | null | undefined): host is GameHost & BotDriven {
  return !!host && typeof (host as Partial<BotDriven>).botStep === 'function';
}

type Listener = (update: HostUpdate) => void;

const fail = (error: MatchError | string): HostResult => ({ ok: false, error });

/**
 * A match played in the browser against a bot. Time is virtual: it only
 * advances through `advance(ms)`, so pausing simply stops calling it.
 */
export class LocalHost implements GameHost, BotDriven {
  readonly online = false;
  readonly seat: PlayerId = 'blue';
  readonly opponent: PlayerId = 'red';
  readonly match: Match;
  readonly bot: Bot;
  readonly #listeners = new Set<Listener>();
  #clock = 0;
  #botPlaced = false;
  #botFlags = { allowAbility: true, allowSpecial: true, turn: 0 };
  /** Desafio e campanha: o servidor confere o layout do bot, que sai de uma semente fixa. */
  readonly #verified: boolean;

  constructor(setup: MatchSetup, bot: Bot) {
    this.bot = bot;
    this.#verified = setup.play === 'daily' || setup.play === 'campaign';
    this.match = new Match({
      seed: setup.seed,
      config: resolveModeConfig(setup.mode),
      clock: setup.clock,
      startTime: 0,
      factions: { [this.seat]: setup.faction, [this.opponent]: setup.botFaction },
      mutators: setup.mutators,
    });
  }

  view(): PlayerView {
    return this.match.viewFor(this.seat);
  }

  opponentView(): PlayerView {
    return this.match.viewFor(this.opponent);
  }

  now(): number {
    return this.#clock;
  }

  /** Moves the virtual clock; timeouts it causes are published as events. */
  advance(ms: number): void {
    if (ms <= 0) return;
    this.#clock += ms;
    const events = this.match.tick(this.#clock);
    if (events.length > 0) this.#emit({ kind: 'event', view: this.view(), event: null });
  }

  onUpdate(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The bot lays out its army (once). */
  placeBot(): void {
    if (this.#botPlaced) return;
    this.#botPlaced = true;
    if (this.#verified) {
      // Layout do adversário que o servidor sabe refazer (ver opponentLayoutSeed).
      this.match.autoPlace(this.opponent, opponentLayoutSeed(this.match.seed));
    } else {
      const layout = this.bot.placeLayout(this.opponentView());
      if (!this.match.setLayout(this.opponent, layout).ok) this.match.autoPlace(this.opponent);
    }
    this.match.confirm(this.opponent);
  }

  async submitLayout(placements: readonly Placement[], confirm: boolean): Promise<HostResult> {
    this.match.tick(this.#clock);
    const set = this.match.setLayout(this.seat, placements);
    if (!set.ok) return fail(set.error);
    if (!confirm) return { ok: true };
    const confirmed = this.match.confirm(this.seat);
    if (!confirmed.ok) return fail(confirmed.error);
    this.#emit({ kind: 'event', view: this.view(), event: { kind: 'confirmed', by: this.seat } });
    return { ok: true };
  }

  async attack(target: Coord): Promise<HostResult> {
    this.match.tick(this.#clock);
    const result = this.match.attack(this.seat, target);
    if (!result.ok) return fail(result.error);
    this.#emit({ kind: 'event', view: this.view(), event: { kind: 'shot', outcome: result.outcome } });
    return { ok: true };
  }

  async ability(request: AbilityRequest): Promise<HostResult> {
    this.match.tick(this.#clock);
    const result = this.match.useAbility(this.seat, request);
    if (!result.ok) return fail(result.error);
    this.#emit({ kind: 'event', view: this.view(), event: { kind: 'ability', by: this.seat, ability: request.ability, outcome: result.outcome } });
    return { ok: true };
  }

  async special(request: SpecialShotRequest): Promise<HostResult> {
    this.match.tick(this.#clock);
    const result = this.match.special(this.seat, request);
    if (!result.ok) return fail(result.error);
    this.#emit({ kind: 'event', view: this.view(), event: { kind: 'special', by: this.seat, special: result.outcome.special, outcome: result.outcome } });
    return { ok: true };
  }

  async surrender(): Promise<HostResult> {
    const result = this.match.surrender(this.seat);
    if (!result.ok) return fail(result.error);
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return { ok: true };
  }

  /**
   * One bot decision (a shot, an ability or a special). Returns what it did,
   * or null when it is not the bot's turn. The controller animates in between.
   */
  botStep(): BotAction | null {
    const m = this.match;
    if (m.phase !== 'playing' || m.turn !== this.opponent) return null;
    m.tick(this.#clock);
    if (m.phase !== 'playing' || m.turn !== this.opponent) return null;
    if (this.#botFlags.turn !== m.turnNumber) this.#botFlags = { allowAbility: true, allowSpecial: true, turn: m.turnNumber };
    const view = this.opponentView();
    const action = this.bot.decide(view, { allowAbility: this.#botFlags.allowAbility, allowSpecial: this.#botFlags.allowSpecial });
    let ok = false;
    if (action.type === 'ability') {
      ok = m.useAbility(this.opponent, action.request).ok;
      if (!ok) this.#botFlags.allowAbility = false;
    } else if (action.type === 'special') {
      ok = m.special(this.opponent, action.request).ok;
      if (!ok) this.#botFlags.allowSpecial = false;
    } else {
      ok = m.attack(this.opponent, action.target).ok;
      if (!ok) {
        // Never stall: fall back to the first cell the match accepts.
        const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
        ok = open.some((c) => m.attack(this.opponent, { col: c.col, row: c.row }).ok);
        if (!ok) m.surrender(this.opponent);
      }
    }
    if (!ok && action.type !== 'attack') return this.botStep();
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return action;
  }

  dispose(): void {
    this.#listeners.clear();
  }

  #emit(update: HostUpdate): void {
    for (const listener of [...this.#listeners]) listener(update);
  }
}

/** Server match: thin adapter over the net module's RemoteMatchHost. */
export class RemoteHost implements GameHost {
  readonly online = true;
  readonly session: OnlineSession;
  readonly remote: RemoteMatchHost;
  readonly #fallbackSeat: PlayerId;
  #offset = 0;

  constructor(session: OnlineSession, remote: RemoteMatchHost, seat: PlayerId) {
    this.session = session;
    this.remote = remote;
    this.#fallbackSeat = seat;
  }

  get seat(): PlayerId {
    return this.remote.seat ?? this.#fallbackSeat;
  }

  view(): PlayerView | null {
    return this.remote.view();
  }

  /** Server time as seen locally, so `view.clock` fields can be compared with it. */
  now(): number {
    const view = this.remote.view();
    const local = this.remote.localDeadline();
    if (view?.clock.deadline != null && local !== null) this.#offset = view.clock.deadline - local;
    else this.#offset = this.session.connection.serverNow() - Date.now();
    return Date.now() + this.#offset;
  }

  onUpdate(listener: Listener): () => void {
    return this.remote.onUpdate((update) =>
      listener(update.kind === 'state' ? { kind: 'state', view: update.view } : { kind: 'event', view: update.view, event: update.event }),
    );
  }

  async submitLayout(placements: readonly Placement[], confirm: boolean): Promise<HostResult> {
    return net(await this.remote.submitPlacement(placements, confirm));
  }

  async attack(target: Coord): Promise<HostResult> {
    return net(await this.remote.attack(target));
  }

  async ability(request: AbilityRequest): Promise<HostResult> {
    return net(await this.remote.useAbility(request));
  }

  async special(request: SpecialShotRequest): Promise<HostResult> {
    return net(await this.remote.special(request));
  }

  async surrender(): Promise<HostResult> {
    return net(await this.remote.surrender());
  }

  dispose(): void {
    // The session outlives the match (rematch, lobby); nothing to free here.
  }
}

function net(result: { ok: true } | { ok: false; code: string; message: string }): HostResult {
  return result.ok ? { ok: true } : { ok: false, error: result.code, message: result.message };
}

export interface DoublesSeats {
  /** The human seat. */
  readonly seat: SeatId;
  /** Display names of every seat (the human's too). */
  readonly names: Readonly<Record<SeatId, string>>;
}

/**
 * Doubles (2 against 2) in the browser: the player holds one seat, bots hold
 * the partner seat and both enemy seats. The view is the team's view of the
 * human seat (`TeamView`), so the controller sees the partner's pieces and
 * intel and knows whose seat is on turn. An online doubles host only needs to
 * produce the same `TeamView`s.
 */
export class LocalTeamHost implements GameHost, BotDriven {
  readonly online = false;
  readonly seat: PlayerId;
  readonly mySeat: SeatId;
  readonly match: TeamMatch;
  readonly names: Readonly<Record<SeatId, string>>;
  readonly #bots: Partial<Record<SeatId, Bot>>;
  readonly #ai: AiModule;
  readonly #listeners = new Set<Listener>();
  #clock = 0;
  #placed = false;
  #flags = { allowAbility: true, allowSpecial: true, turn: 0 };

  constructor(setup: MatchSetup, seats: DoublesSeats, bots: Partial<Record<SeatId, Bot>>, ai: AiModule) {
    this.mySeat = seats.seat;
    this.seat = teamOf(seats.seat);
    this.names = seats.names;
    this.#bots = bots;
    this.#ai = ai;
    const enemy = this.seat === 'blue' ? 'red' : 'blue';
    this.match = new TeamMatch({
      seed: setup.seed,
      config: resolveModeConfig(setup.mode),
      clock: setup.clock,
      startTime: 0,
      firstTeam: 'blue',
      factions: { [this.seat]: setup.faction, [enemy]: setup.botFaction },
      mutators: setup.mutators,
    });
  }

  /** The first enemy bot speaks for the other team. */
  get bot(): Bot {
    const enemy = this.seat === 'blue' ? 'red' : 'blue';
    return this.#bots[seatsOf(enemy)[0]]!;
  }

  view(): TeamView {
    return this.match.viewFor(this.mySeat);
  }

  now(): number {
    return this.#clock;
  }

  advance(ms: number): void {
    if (ms <= 0) return;
    this.#clock += ms;
    if (this.match.tick(this.#clock).length > 0) this.#emit({ kind: 'event', view: this.view(), event: null });
  }

  onUpdate(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Enemy seats place at once; the partner too when it is seat 1 (seat 2 fits around the player). */
  placeBot(): void {
    if (this.#placed) return;
    this.#placed = true;
    const enemy = this.seat === 'blue' ? 'red' : 'blue';
    for (const seat of seatsOf(enemy)) this.#ai.placeSeat(this.match, seat, this.#bots[seat]!);
    const partner = partnerOf(this.mySeat);
    if (partner.endsWith('-1')) this.#ai.placeSeat(this.match, partner, this.#bots[partner]!);
  }

  async submitLayout(placements: readonly Placement[], confirm: boolean): Promise<HostResult> {
    const m = this.match;
    m.tick(this.#clock);
    const mine = new Set(m.piecesOfSeat(this.mySeat).map((p) => p.id));
    for (const id of mine) m.remove(this.mySeat, id);
    for (const p of placements) {
      if (!mine.has(p.pieceId)) continue;
      const r = m.place(this.mySeat, p.pieceId, p.anchor, p.rotation);
      if (!r.ok) return fail(r.error);
    }
    if (!confirm) return { ok: true };
    const r = m.confirm(this.mySeat);
    if (!r.ok) return fail(r.error);
    const partner = partnerOf(this.mySeat);
    if (!m.viewFor(partner).doubles.team.find((s) => s.seat === partner)?.confirmed) this.#ai.placeSeat(m, partner, this.#bots[partner]!);
    this.#emit({ kind: 'event', view: this.view(), event: { kind: 'confirmed', by: this.seat } });
    return { ok: true };
  }

  async attack(target: Coord): Promise<HostResult> {
    this.match.tick(this.#clock);
    const r = this.match.attack(this.mySeat, target);
    if (!r.ok) return fail(r.error);
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return { ok: true };
  }

  async ability(request: AbilityRequest): Promise<HostResult> {
    this.match.tick(this.#clock);
    const r = this.match.useAbility(this.mySeat, request);
    if (!r.ok) return fail(r.error);
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return { ok: true };
  }

  async special(request: SpecialShotRequest): Promise<HostResult> {
    this.match.tick(this.#clock);
    const r = this.match.special(this.mySeat, request);
    if (!r.ok) return fail(r.error);
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return { ok: true };
  }

  async surrender(): Promise<HostResult> {
    const r = this.match.surrender(this.mySeat);
    if (!r.ok) return fail(r.error);
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return { ok: true };
  }

  /** One decision of the bot whose seat is on turn (partner or enemy). */
  botStep(): BotAction | null {
    const m = this.match;
    m.tick(this.#clock);
    const seat = m.seatOnTurn;
    if (m.phase !== 'playing' || !seat || seat === this.mySeat) return null;
    const bot = this.#bots[seat];
    if (!bot) return null;
    if (this.#flags.turn !== m.turnNumber) this.#flags = { allowAbility: true, allowSpecial: true, turn: m.turnNumber };
    const view = m.viewFor(seat);
    const action = bot.decide(view, { allowAbility: this.#flags.allowAbility, allowSpecial: this.#flags.allowSpecial });
    let ok: boolean;
    if (action.type === 'ability') {
      ok = m.useAbility(seat, action.request).ok;
      if (!ok) this.#flags.allowAbility = false;
    } else if (action.type === 'special') {
      ok = m.special(seat, action.request).ok;
      if (!ok) this.#flags.allowSpecial = false;
    } else {
      ok = m.attack(seat, action.target).ok;
      if (!ok) {
        const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
        ok = open.some((c) => m.attack(seat, { col: c.col, row: c.row }).ok);
        if (!ok) m.surrender(seat);
      }
    }
    if (!ok && action.type !== 'attack') return this.botStep();
    this.#emit({ kind: 'event', view: this.view(), event: null });
    return action;
  }

  dispose(): void {
    this.#listeners.clear();
  }

  #emit(update: HostUpdate): void {
    for (const listener of [...this.#listeners]) listener(update);
  }
}