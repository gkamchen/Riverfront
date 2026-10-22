import { randomInt } from 'node:crypto';
import {
  Match,
  opponentOf,
  type AbilityRequest,
  type ClockPresetId,
  type Coord,
  type FactionId,
  type HistoryEntry,
  type PlayerView,
  type MutatorId,
  type SpecialShotRequest,
  type MatchRecord,
  type Placement,
} from '@riverfront/core';
import {
  EMOTE,
  nearestFreeColour,
  packView,
  type FieldSize,
  type PackedView,
  type EmoteAudience,
  type EmoteKind,
  type ErrorCode,
  type GameMode,
  type MatchEvent,
  type PublicProfile,
  type RoomInfo,
  type RoomState,
  type Seat,
} from '@riverfront/protocol';
import { fogHistory } from './fog.ts';
import type { GameRoom, RoomHub, RoomResult, RoomSettings } from './game-room.ts';
import { SlidingWindow } from './rate.ts';
import type { StoredMatch } from './store/types.ts';

export type { RoomHub, RoomResult, RoomSettings } from './game-room.ts';

interface SeatState {
  readonly userId: string;
  profile: PublicProfile;
  colour: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  wantsRematch: boolean;
  mutedOpponent: boolean;
  lastEmojiAt: number;
  readonly emojiWindow: SlidingWindow;
  lastTauntAt: number;
  faction: FactionId;
}

const OK: RoomResult = { ok: true };
// Funções em vez de comparações diretas: o TypeScript não sabe que tick() pode mudar a fase.
const isFinished = (m: Match) => m.phase === 'finished';
const err = (code: ErrorCode, detail?: string): RoomResult => (detail === undefined ? { ok: false, code } : { ok: false, code, detail });

export class Room implements GameRoom {
  readonly code: string;
  readonly format = 'duel' as const;
  readonly mode: GameMode;
  readonly clock: ClockPresetId;
  readonly mutators: readonly MutatorId[];
  readonly size: FieldSize | null;
  readonly #hub: RoomHub;
  readonly #settings: RoomSettings;
  readonly #seats: Record<Seat, SeatState | null> = { blue: null, red: null };
  #match: Match | null = null;
  #matchNumber = 0;
  #firstTurn: Seat = 'blue';
  #expiresAt: number | null;
  #placementDeadline: number | null = null;
  #finishedAt: number | null = null;
  #closed = false;
  #lastRecord: StoredMatch | null = null;
  /** Quantos itens do histórico cada lado já recebeu (o resto vai junto no próximo envio). */
  readonly #historySent: Record<Seat, number> = { blue: 0, red: 0 };
  /** Itens do histórico já convertidos em eventos de torre/maré. */
  #historyScanned = 0;
  readonly emoteLog: { from: string; emote: string; at: number }[] = [];

  constructor(
    code: string,
    mode: GameMode,
    clock: ClockPresetId,
    hub: RoomHub,
    settings: RoomSettings,
    options: { mutators?: readonly MutatorId[]; size?: FieldSize | null } = {},
  ) {
    this.code = code;
    this.mutators = [...new Set(options.mutators ?? [])];
    this.size = options.size ?? null;
    this.mode = mode;
    this.clock = clock;
    this.#hub = hub;
    this.#settings = settings;
    this.#expiresAt = hub.now() + settings.expiryMs;
  }

  // ------------------------------------------------------------ estado

  get state(): RoomState {
    if (this.#match) {
      if (this.#match.phase === 'finished') return 'finished';
      return this.#match.phase === 'placing' ? 'placing' : 'playing';
    }
    return this.#seats.blue && this.#seats.red ? 'lobby' : 'waiting';
  }

  get closed(): boolean {
    return this.#closed;
  }

  get match(): Match | null {
    return this.#match;
  }

  get players(): string[] {
    return (['blue', 'red'] as const).flatMap((s) => (this.#seats[s] ? [this.#seats[s].userId] : []));
  }

  seatOf(userId: string): Seat | null {
    if (this.#seats.blue?.userId === userId) return 'blue';
    if (this.#seats.red?.userId === userId) return 'red';
    return null;
  }

  /** Partida atual (ou a última) como registro completo. Só para uso do servidor. */
  recordFor(): StoredMatch | null {
    if (this.#match && this.#seats.blue && this.#seats.red) return this.#stored(this.#match.toRecord());
    return this.#lastRecord;
  }

  infoFor(userId: string): RoomInfo | null {
    const seat = this.seatOf(userId);
    return seat ? this.info(seat) : null;
  }

  /** Lugares fixos no 1×1. */
  chooseSeat(): RoomResult {
    return err('wrong-state');
  }

  info(seat: Seat): RoomInfo {
    return {
      code: this.code,
      format: this.format,
      state: this.state,
      mode: this.mode,
      clock: this.clock,
      mutators: this.mutators,
      size: this.size,
      you: seat,
      players: (['blue', 'red'] as const).flatMap((s) => {
        const p = this.#seats[s];
        if (!p) return [];
        return [{ seat: s, profile: p.profile, colour: p.colour, faction: p.faction, ready: p.ready, connected: p.connected, wantsRematch: p.wantsRematch }];
      }),
      expiresAt: this.#match ? null : this.#expiresAt,
      placementDeadline: this.#match?.phase === 'placing' ? this.#placementDeadline : null,
      matchNumber: this.#matchNumber,
      firstTurn: this.#firstTurn,
    };
  }

  // ------------------------------------------------------------ jogadores

  join(profile: PublicProfile): RoomResult & { seat?: Seat } {
    if (this.#closed) return err('room-not-found');
    const existing = this.seatOf(profile.userId);
    if (existing) return { ok: true, seat: existing };
    const seat: Seat | null = !this.#seats.blue ? 'blue' : !this.#seats.red ? 'red' : null;
    if (!seat || this.#match) return err('room-full');
    const other = this.#seats[opponentOf(seat)];
    if (other && this.#hub.blocked(other.userId, profile.userId)) return err('unavailable');
    const colour = other ? nearestFreeColour(profile.colour, [other.colour]) : profile.colour;
    this.#seats[seat] = {
      userId: profile.userId,
      profile,
      colour,
      ready: false,
      connected: true,
      disconnectedAt: null,
      wantsRematch: false,
      mutedOpponent: false,
      lastEmojiAt: -Infinity,
      emojiWindow: new SlidingWindow(EMOTE.emojiPerWindow, EMOTE.emojiWindowMs),
      lastTauntAt: -Infinity,
      faction: 'neutra',
    };
    if (colour !== profile.colour) this.#hub.send(profile.userId, { t: 'colour.adjusted', wanted: profile.colour, given: colour });
    this.broadcastRoom();
    return { ok: true, seat };
  }

  /** Saída voluntária. Durante a partida conta como desistência. */
  leave(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const match = this.#match;
    if (match && match.phase !== 'finished') {
      match.tick(this.#hub.now());
      if (!isFinished(match)) match.surrender(seat);
      this.#afterAction();
    }
    this.#seats[seat] = null;
    this.#hub.left(this, userId);
    const other = this.#seats[opponentOf(seat)];
    if (match || !other) {
      // Depois de uma partida a sala não volta para o saguão: fecha para os dois.
      if (other) this.#hub.send(other.userId, { t: 'room.closed', reason: 'opponent-left' });
      this.close(null);
      return;
    }
    // Saguão: quem ficou volta a esperar; se quem saiu era o azul, o vermelho assume o lugar.
    if (seat === 'blue') {
      this.#seats.blue = other;
      this.#seats.red = null;
    }
    other.ready = false;
    this.#expiresAt = this.#hub.now() + this.#settings.expiryMs;
    this.broadcastRoom();
  }

  updateProfile(profile: PublicProfile): void {
    const seat = this.seatOf(profile.userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    const other = this.#seats[opponentOf(seat)];
    me.profile = profile;
    const colour = other ? nearestFreeColour(profile.colour, [other.colour]) : profile.colour;
    if (colour !== profile.colour) this.#hub.send(profile.userId, { t: 'colour.adjusted', wanted: profile.colour, given: colour });
    me.colour = colour;
    this.broadcastRoom();
  }

  connect(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    me.connected = true;
    me.disconnectedAt = null;
    const match = this.#match;
    if (match && match.phase !== 'finished') {
      this.#applyClock(match.tick(this.#hub.now()));
      if (!isFinished(match)) match.reconnect(seat);
    }
    this.#notifyOpponentStatus(seat);
    this.broadcastRoom();
    for (const id of this.players) this.sendState(id);
  }

  disconnect(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    me.connected = false;
    me.disconnectedAt = this.#hub.now();
    const match = this.#match;
    if (match && match.phase !== 'finished') {
      this.#applyClock(match.tick(this.#hub.now()));
      if (!isFinished(match)) match.disconnect(seat);
    }
    this.#notifyOpponentStatus(seat);
    this.broadcastRoom();
    // O adversário vê na hora o relógio congelado e a tolerância correndo.
    const other = this.#seats[opponentOf(seat)];
    if (other) this.sendState(other.userId);
  }

  #notifyOpponentStatus(seat: Seat): void {
    const other = this.#seats[opponentOf(seat)];
    const me = this.#seats[seat];
    if (!other || !me) return;
    const graceLeftMs = this.#match && this.#match.phase === 'playing' ? this.#match.viewFor(seat).own.clock.graceLeftMs : null;
    this.#hub.send(other.userId, { t: 'opponent', connected: me.connected, graceLeftMs: me.connected ? null : graceLeftMs });
  }

  setReady(userId: string, ready: boolean): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    if (this.#match) return err('wrong-state');
    (this.#seats[seat] as SeatState).ready = ready;
    if (this.#seats.blue?.ready && this.#seats.red?.ready) this.#startMatch();
    else this.broadcastRoom();
    return OK;
  }

  /** Facção da próxima partida. Só fora de partida em andamento. */
  setFaction(userId: string, faction: FactionId): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const state = this.state;
    if (state === 'placing' || state === 'playing') return err('wrong-state');
    const me = this.#seats[seat] as SeatState;
    if (me.ready) return err('wrong-state');
    me.faction = faction;
    this.broadcastRoom();
    return OK;
  }

  setMuted(userId: string, muted: boolean, _who: 'opponents' | 'partner' = 'opponents'): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    (this.#seats[seat] as SeatState).mutedOpponent = muted;
    return OK;
  }

  rematch(userId: string, accept: boolean): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    if (this.state !== 'finished') return err('wrong-state');
    const me = this.#seats[seat] as SeatState;
    const other = this.#seats[opponentOf(seat)];
    if (!other) return err('wrong-state');
    me.wantsRematch = accept;
    if (accept && other.wantsRematch) {
      this.#firstTurn = opponentOf(this.#firstTurn);
      this.#startMatch();
      return OK;
    }
    if (accept) this.#hub.send(other.userId, { t: 'rematch', offeredBy: seat });
    this.broadcastRoom();
    return OK;
  }

  #startMatch(): void {
    const now = this.#hub.now();
    this.#matchNumber++;
    for (const s of ['blue', 'red'] as const) {
      const p = this.#seats[s] as SeatState;
      p.ready = false;
      p.wantsRematch = false;
    }
    try {
      this.#match = new Match({
        seed: this.#settings.seed?.() ?? randomInt(0, 2 ** 32),
        config: this.mode,
        factions: { blue: (this.#seats.blue as SeatState).faction, red: (this.#seats.red as SeatState).faction },
        ...(this.mutators.length > 0 ? { mutators: this.mutators } : {}),
        ...(this.size ? { size: this.size } : {}),
        firstTurn: this.#firstTurn,
        clock: this.#settings.clocks[this.clock] ?? this.clock,
        startTime: now,
      });
    } catch {
      // Exército de alguma facção não cabe neste campo: volta para o saguão.
      this.#matchNumber--;
      this.#match = null;
      for (const id of this.players) {
        this.#hub.send(id, { t: 'error', ref: null, code: 'room-options', detail: 'faction', message: 'As facções escolhidas não cabem neste campo. Troque de facção ou de modo.' });
      }
      this.broadcastRoom();
      return;
    }
    this.#historyScanned = 0;
    this.#finishedAt = null;
    const placement = this.#settings.placementMs[this.clock];
    this.#placementDeadline = placement === null ? null : now + placement;
    for (const s of ['blue', 'red'] as const) {
      const p = this.#seats[s] as SeatState;
      if (!p.connected) this.#match.disconnect(s);
    }
    this.#hub.stateChanged(this);
    this.broadcastRoom();
    for (const id of this.players) this.sendState(id);
  }

  // ------------------------------------------------------------ partida

  submitPlacement(userId: string, placements: readonly Placement[], confirm: boolean): RoomResult {
    const ctx = this.#placingContext(userId);
    if (!ctx.ok) return ctx;
    const { match, seat } = ctx;
    if (placements.length > 0) {
      const set = match.setLayout(seat, placements);
      if (!set.ok) return err('match-error', set.error);
    }
    if (confirm) {
      const done = match.confirm(seat);
      if (!done.ok) return err('match-error', done.error);
      this.#afterConfirm(seat);
    } else {
      this.sendState(userId);
    }
    return OK;
  }

  autoPlace(userId: string): RoomResult {
    const ctx = this.#placingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.autoPlace(ctx.seat);
    if (!r.ok) return err('match-error', r.error);
    this.sendState(userId);
    return OK;
  }

  #placingContext(userId: string): ({ ok: true; match: Match; seat: Seat }) | { ok: false; code: ErrorCode; detail?: string } {
    const seat = this.seatOf(userId);
    if (!seat) return { ok: false, code: 'not-in-room' };
    const match = this.#match;
    if (!match || match.phase !== 'placing') return { ok: false, code: 'wrong-state' };
    return { ok: true, match, seat };
  }

  #afterConfirm(seat: Seat): void {
    const match = this.#match as Match;
    if (match.phase === 'playing') {
      this.#placementDeadline = null;
      this.#broadcastEvent(() => ({ kind: 'start' }));
      this.#scanHistory();
      this.#hub.stateChanged(this);
      this.broadcastRoom();
    } else {
      this.#broadcastEvent(() => ({ kind: 'confirmed', by: seat }));
    }
  }

  attack(userId: string, target: Coord): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.attack(ctx.seat, target);
    if (!r.ok) return err('match-error', r.error);
    this.#broadcastEvent(() => ({ kind: 'shot', outcome: r.outcome }));
    this.#afterAction();
    return OK;
  }

  ability(userId: string, request: AbilityRequest): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.useAbility(ctx.seat, request);
    if (!r.ok) return err('match-error', r.error);
    const by = ctx.seat;
    const isPublic = r.outcome.ability === 'bomb';
    this.#broadcastEvent((seat) => ({
      kind: 'ability',
      by,
      ability: request.ability,
      outcome: seat === by || isPublic ? r.outcome : null,
    }));
    this.#afterAction();
    return OK;
  }

  special(userId: string, request: SpecialShotRequest): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.special(ctx.seat, request);
    if (!r.ok) return err('match-error', r.error);
    const by = ctx.seat;
    const isPrivate = r.outcome.kind === 'probe';
    this.#broadcastEvent((seat) => ({
      kind: 'special',
      by,
      special: r.outcome.special,
      outcome: seat === by || !isPrivate ? r.outcome : null,
    }));
    this.#afterAction();
    return OK;
  }

  surrender(userId: string): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const match = this.#match;
    if (!match || match.phase === 'finished') return err('wrong-state');
    match.tick(this.#hub.now());
    if (!isFinished(match)) match.surrender(seat);
    this.#afterAction();
    return OK;
  }

  #playingContext(userId: string): ({ ok: true; match: Match; seat: Seat }) | { ok: false; code: ErrorCode; detail?: string } {
    const seat = this.seatOf(userId);
    if (!seat) return { ok: false, code: 'not-in-room' };
    const match = this.#match;
    if (!match) return { ok: false, code: 'wrong-state' };
    // Aplica o relógio antes da jogada: se o tempo já tinha estourado, a jogada chega tarde.
    this.#applyClock(match.tick(this.#hub.now()));
    if (match.phase !== 'playing') return { ok: false, code: 'match-error', detail: match.phase === 'finished' ? 'finished' : 'wrong-phase' };
    return { ok: true, match, seat };
  }

  #applyClock(events: ReturnType<Match['tick']>): void {
    const match = this.#match;
    if (!match || events.length === 0) return;
    for (const event of events) {
      if (event.type === 'timeout') {
        const strikes = match.viewFor(event.player).own.clock.strikes;
        this.#broadcastEvent(() => ({ kind: 'timeout', player: event.player, forfeit: event.forfeit, strikes }));
      }
    }
    this.#afterAction();
  }

  /**
   * A torre automática e a maré não têm ação própria: aparecem no histórico
   * dentro da jogada que passou a vez. Aqui viram eventos para os dois lados
   * (os dois tipos são públicos no core).
   */
  #scanHistory(): void {
    const match = this.#match;
    if (!match) return;
    const history = match.viewFor('blue').history;
    for (; this.#historyScanned < history.length; this.#historyScanned++) {
      const entry = history[this.#historyScanned] as HistoryEntry;
      if (entry.kind === 'tower') {
        const { by, report } = entry;
        this.#broadcastEvent(() => ({ kind: 'tower', by, report }));
      } else if (entry.kind === 'tide') {
        const { submerged } = entry;
        this.#broadcastEvent(() => ({ kind: 'tide', submerged }));
      }
    }
  }

  /** Detecta o fim da partida e avisa todo mundo uma vez só. */
  #afterAction(): void {
    this.#scanHistory();
    const match = this.#match;
    if (!match || match.phase !== 'finished' || this.#finishedAt !== null) return;
    this.#finishedAt = this.#hub.now();
    this.#placementDeadline = null;
    const winner = match.winner as Seat;
    const reason = match.winReason ?? 'destroyed';
    this.#broadcastEvent(() => ({ kind: 'end', winner, reason }));
    if (this.#seats.blue && this.#seats.red) {
      this.#lastRecord = this.#stored(match.toRecord());
      this.#hub.matchEnded(this, this.#lastRecord);
    }
    this.#hub.stateChanged(this);
    this.broadcastRoom();
  }

  #stored(record: MatchRecord): StoredMatch {
    const match = this.#match as Match;
    return {
      id: `${this.code}-${this.#matchNumber}`,
      room: this.code,
      endedAt: this.#hub.now(),
      players: { blue: this.#seats.blue?.userId ?? '', red: this.#seats.red?.userId ?? '' },
      winner: match.winner,
      reason: match.winReason,
      record,
    };
  }

  // ------------------------------------------------------------ emotes

  emote(userId: string, kind: EmoteKind, emote: string, _to: EmoteAudience = 'all'): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const me = this.#seats[seat] as SeatState;
    const now = this.#hub.now();
    if (kind === 'emoji') {
      if (now - me.lastEmojiAt < EMOTE.emojiCooldownMs) return err('emote-cooldown');
      if (!me.emojiWindow.allow(now)) return err('emote-cooldown');
      me.lastEmojiAt = now;
    } else {
      if (now - me.lastTauntAt < EMOTE.tauntCooldownMs) return err('emote-cooldown');
      me.lastTauntAt = now;
    }
    this.emoteLog.push({ from: userId, emote: `${kind}:${emote}`, at: now });
    if (this.emoteLog.length > 200) this.emoteLog.shift();
    const other = this.#seats[opponentOf(seat)];
    if (other && !other.mutedOpponent && !this.#hub.blocked(other.userId, userId)) {
      this.#hub.send(other.userId, { t: 'emote', from: seat, kind, emote });
    }
    return OK;
  }

  // ------------------------------------------------------------ relógio da sala

  tick(): void {
    if (this.#closed) return;
    const now = this.#hub.now();
    const match = this.#match;

    if (!match) {
      if (this.#expiresAt !== null && now >= this.#expiresAt) {
        this.close('expired');
        return;
      }
      for (const s of ['blue', 'red'] as const) {
        const p = this.#seats[s];
        if (p && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= this.#settings.lobbyGraceMs) {
          this.leave(p.userId);
          if (this.#closed) return;
        }
      }
      return;
    }

    if (match.phase === 'placing') {
      if (this.#placementDeadline !== null && now >= this.#placementDeadline) this.#forcePlacement();
      // Sem jogo rolando o core não conta a tolerância; quem some por tempo demais perde.
      for (const s of ['blue', 'red'] as const) {
        const p = this.#seats[s];
        if (match.phase === 'placing' && p && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= this.#settings.lobbyGraceMs) {
          match.surrender(s);
          this.#afterAction();
        }
      }
      return;
    }

    if (match.phase === 'playing') {
      this.#applyClock(match.tick(now));
      return;
    }

    // Encerrada: espera a revanche por um tempo, ou fecha se os dois sumiram.
    const anyone = this.#seats.blue?.connected || this.#seats.red?.connected;
    if (!anyone || (this.#finishedAt !== null && now - this.#finishedAt >= this.#settings.finishedTtlMs)) this.close('expired');
  }

  /** Tempo de posicionamento esgotado: quem não confirmou recebe um layout automático. */
  #forcePlacement(): void {
    const match = this.#match as Match;
    this.#placementDeadline = null;
    for (const seat of ['blue', 'red'] as const) {
      if (match.phase !== 'placing') break;
      const view = match.viewFor(seat);
      if (view.own.confirmed) continue;
      if (!match.confirm(seat).ok) {
        match.autoPlace(seat);
        match.confirm(seat);
      }
      this.#afterConfirm(seat);
    }
  }

  // ------------------------------------------------------------ envio

  broadcastRoom(): void {
    for (const s of ['blue', 'red'] as const) {
      const p = this.#seats[s];
      if (p) this.#hub.send(p.userId, { t: 'room', room: this.info(s) });
    }
  }

  /** Estado completo da partida, só com o que o jogador pode ver. */
  sendState(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat || !this.#match) return;
    const view = this.#match.viewFor(seat);
    this.#historySent[seat] = view.history.length;
    this.#hub.send(userId, { t: 'match.state', view: this.#pack(view, 0), serverTime: this.#hub.now() });
  }

  /** Com neblina, o histórico vai sempre inteiro e sem os erros que a neblina já apagou do mapa. */
  #pack(view: PlayerView, historyStart: number): PackedView {
    if (!this.mutators.includes('neblina')) return packView(view, historyStart);
    return packView({ ...view, history: fogHistory(view) }, 0);
  }

  #broadcastEvent(build: (seat: Seat) => MatchEvent): void {
    const match = this.#match;
    if (!match) return;
    for (const s of ['blue', 'red'] as const) {
      const p = this.#seats[s];
      if (!p) continue;
      const view = match.viewFor(s);
      const packed = this.#pack(view, this.#historySent[s]);
      this.#historySent[s] = view.history.length;
      this.#hub.send(p.userId, { t: 'match.event', event: build(s), view: packed, serverTime: this.#hub.now() });
    }
  }

  close(reason: 'expired' | 'shutdown' | 'deleted' | null): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const s of ['blue', 'red'] as const) {
      const p = this.#seats[s];
      if (p && reason) this.#hub.send(p.userId, { t: 'room.closed', reason });
    }
    this.#hub.closed(this);
  }
}
