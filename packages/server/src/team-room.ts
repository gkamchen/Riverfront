import { randomInt } from 'node:crypto';
import {
  opponentOf,
  partnerOf,
  resolveClock,
  SEATS,
  teamOf,
  TeamMatch,
  type AbilityRequest,
  type ClockPresetId,
  type Coord,
  type FactionId,
  type HistoryEntry,
  type MutatorId,
  type Placement,
  type PlayerId,
  type SeatId,
  type SpecialShotRequest,
  type TeamView,
  type WinReason,
} from '@riverfront/core';
import {
  EMOTE,
  nearestFreeColour,
  packView,
  type EmoteAudience,
  type EmoteKind,
  type ErrorCode,
  type FieldSize,
  type GameMode,
  type MatchEvent,
  type PackedView,
  type PublicProfile,
  type RoomInfo,
  type RoomState,
} from '@riverfront/protocol';
import { fogHistory } from './fog.ts';
import type { GameRoom, RoomHub, RoomResult, RoomSettings } from './game-room.ts';
import { SlidingWindow } from './rate.ts';
import type { StoredMatch } from './store/types.ts';

interface SeatState {
  readonly userId: string;
  profile: PublicProfile;
  colour: string;
  ready: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  /** Tolerância já gasta nesta partida (ms). */
  graceUsedMs: number;
  wantsRematch: boolean;
  mutedOpponents: boolean;
  mutedPartner: boolean;
  lastEmojiAt: number;
  readonly emojiWindow: SlidingWindow;
  lastTauntAt: number;
}

const OK: RoomResult = { ok: true };
const err = (code: ErrorCode, detail?: string): RoomResult => (detail === undefined ? { ok: false, code } : { ok: false, code, detail });
const isFinished = (m: TeamMatch) => m.phase === 'finished';

/** Ordem em que os lugares são ocupados ao entrar: um de cada time por vez. */
const JOIN_ORDER: readonly SeatId[] = ['blue-1', 'red-1', 'blue-2', 'red-2'];

/**
 * Sala de duplas (2 contra 2) sobre o `TeamMatch` do core. Cada lugar recebe
 * só `viewFor(lugar)`: o time inteiro vê o próprio campo, ninguém vê o campo
 * inimigo. O core não trata queda de conexão nas duplas; aqui cada lugar tem
 * a mesma tolerância do 1×1 (por queda e no total) e, estourada, o time perde
 * por abandono. Enquanto alguém está fora, o relógio do lugar dele continua
 * (o turno dele pode estourar e contar falta).
 */
export class TeamRoom implements GameRoom {
  readonly code: string;
  readonly format = 'doubles' as const;
  readonly mode: GameMode;
  readonly clock: ClockPresetId;
  readonly mutators: readonly MutatorId[];
  readonly size: FieldSize | null;
  readonly #hub: RoomHub;
  readonly #settings: RoomSettings;
  readonly #seats: Record<SeatId, SeatState | null> = { 'blue-1': null, 'blue-2': null, 'red-1': null, 'red-2': null };
  readonly #factions: Record<PlayerId, FactionId> = { blue: 'neutra', red: 'neutra' };
  #match: TeamMatch | null = null;
  #matchNumber = 0;
  #firstTeam: PlayerId = 'blue';
  #expiresAt: number | null;
  #placementDeadline: number | null = null;
  #finishedAt: number | null = null;
  #abandoned: PlayerId | null = null;
  #closed = false;
  #lastRecord: StoredMatch | null = null;
  readonly #historySent: Record<SeatId, number> = { 'blue-1': 0, 'blue-2': 0, 'red-1': 0, 'red-2': 0 };
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
    this.mode = mode;
    this.clock = clock;
    this.mutators = [...new Set(options.mutators ?? [])];
    this.size = options.size ?? null;
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
    return SEATS.every((s) => this.#seats[s]) ? 'lobby' : 'waiting';
  }

  get closed(): boolean {
    return this.#closed;
  }

  get match(): TeamMatch | null {
    return this.#match;
  }

  get players(): string[] {
    return SEATS.flatMap((s) => (this.#seats[s] ? [this.#seats[s].userId] : []));
  }

  seatOf(userId: string): SeatId | null {
    return SEATS.find((s) => this.#seats[s]?.userId === userId) ?? null;
  }

  #present(): [SeatId, SeatState][] {
    return SEATS.flatMap((s) => (this.#seats[s] ? [[s, this.#seats[s]] as [SeatId, SeatState]] : []));
  }

  infoFor(userId: string): RoomInfo | null {
    const seat = this.seatOf(userId);
    return seat ? this.#info(seat) : null;
  }

  #info(seat: SeatId): RoomInfo {
    return {
      code: this.code,
      format: this.format,
      state: this.state,
      mode: this.mode,
      clock: this.clock,
      mutators: this.mutators,
      size: this.size,
      you: seat,
      players: this.#present().map(([s, p]) => ({
        seat: s,
        profile: p.profile,
        colour: p.colour,
        faction: this.#factions[teamOf(s)],
        ready: p.ready,
        connected: p.connected,
        wantsRematch: p.wantsRematch,
      })),
      expiresAt: this.#match ? null : this.#expiresAt,
      placementDeadline: this.#match?.phase === 'placing' ? this.#placementDeadline : null,
      matchNumber: this.#matchNumber,
      firstTurn: this.#firstTeam,
    };
  }

  recordFor(): StoredMatch | null {
    if (this.#match && this.#present().length === 4) return this.#stored();
    return this.#lastRecord;
  }

  // ------------------------------------------------------------ lugares

  /** Cor da sala: diferente das cores do time adversário (o parceiro pode repetir). */
  #colourFor(seat: SeatId, wanted: string): string {
    const enemies = this.#present()
      .filter(([s]) => teamOf(s) !== teamOf(seat))
      .map(([, p]) => p.colour);
    return nearestFreeColour(wanted, enemies);
  }

  #blockedWithAnyone(userId: string): boolean {
    return this.#present().some(([, p]) => p.userId !== userId && this.#hub.blocked(p.userId, userId));
  }

  join(profile: PublicProfile): RoomResult {
    if (this.#closed) return err('room-not-found');
    if (this.seatOf(profile.userId)) return OK;
    if (this.#match) return err('room-full');
    const seat = JOIN_ORDER.find((s) => !this.#seats[s]);
    if (!seat) return err('room-full');
    if (this.#blockedWithAnyone(profile.userId)) return err('unavailable');
    const colour = this.#colourFor(seat, profile.colour);
    this.#seats[seat] = {
      userId: profile.userId,
      profile,
      colour,
      ready: false,
      connected: true,
      disconnectedAt: null,
      graceUsedMs: 0,
      wantsRematch: false,
      mutedOpponents: false,
      mutedPartner: false,
      lastEmojiAt: -Infinity,
      emojiWindow: new SlidingWindow(EMOTE.emojiPerWindow, EMOTE.emojiWindowMs),
      lastTauntAt: -Infinity,
    };
    if (colour !== profile.colour) this.#hub.send(profile.userId, { t: 'colour.adjusted', wanted: profile.colour, given: colour });
    this.broadcastRoom();
    return OK;
  }

  chooseSeat(userId: string, target: SeatId): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    if (this.#match) return err('wrong-state');
    if (seat === target) return OK;
    if (this.#seats[target]) return err('seat-taken');
    const me = this.#seats[seat] as SeatState;
    if (me.ready) return err('wrong-state');
    this.#seats[seat] = null;
    this.#seats[target] = me;
    const colour = this.#colourFor(target, me.profile.colour);
    if (colour !== me.colour) {
      me.colour = colour;
      if (colour !== me.profile.colour) this.#hub.send(userId, { t: 'colour.adjusted', wanted: me.profile.colour, given: colour });
    }
    this.broadcastRoom();
    return OK;
  }

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
    const rest = this.#present();
    if (match || rest.length === 0) {
      // Depois de uma partida, a mesa se desfaz para todos.
      for (const [, p] of rest) this.#hub.send(p.userId, { t: 'room.closed', reason: 'opponent-left' });
      this.close(null);
      return;
    }
    for (const [, p] of rest) p.ready = false;
    this.#expiresAt = this.#hub.now() + this.#settings.expiryMs;
    this.broadcastRoom();
  }

  updateProfile(profile: PublicProfile): void {
    const seat = this.seatOf(profile.userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    me.profile = profile;
    me.colour = this.#colourFor(seat, profile.colour);
    if (me.colour !== profile.colour) this.#hub.send(profile.userId, { t: 'colour.adjusted', wanted: profile.colour, given: me.colour });
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ conexão

  #graceLeft(p: SeatState, now: number): number | null {
    if (p.connected || p.disconnectedAt === null) return null;
    const clock = resolveClock(this.#settings.clocks[this.clock] ?? this.clock);
    const away = now - p.disconnectedAt;
    return Math.max(0, Math.min(clock.graceDropMs - away, clock.graceTotalMs - p.graceUsedMs - away));
  }

  #notifyStatus(seat: SeatId): void {
    const me = this.#seats[seat];
    if (!me) return;
    const playing = this.#match?.phase === 'playing';
    const graceLeftMs = playing ? this.#graceLeft(me, this.#hub.now()) : null;
    for (const [s, p] of this.#present()) {
      if (s !== seat) this.#hub.send(p.userId, { t: 'opponent', connected: me.connected, graceLeftMs, seat });
    }
  }

  connect(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    if (!me.connected && me.disconnectedAt !== null && this.#match?.phase === 'playing') {
      me.graceUsedMs += Math.max(0, this.#hub.now() - me.disconnectedAt);
    }
    me.connected = true;
    me.disconnectedAt = null;
    if (this.#match && this.#match.phase !== 'finished') this.#applyClock(this.#match.tick(this.#hub.now()));
    this.#notifyStatus(seat);
    this.broadcastRoom();
    this.sendState(userId);
  }

  disconnect(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const me = this.#seats[seat] as SeatState;
    me.connected = false;
    me.disconnectedAt = this.#hub.now();
    if (this.#match && this.#match.phase !== 'finished') this.#applyClock(this.#match.tick(this.#hub.now()));
    this.#notifyStatus(seat);
    this.broadcastRoom();
  }

  // ------------------------------------------------------------ saguão

  setReady(userId: string, ready: boolean): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    if (this.#match) return err('wrong-state');
    (this.#seats[seat] as SeatState).ready = ready;
    if (SEATS.every((s) => this.#seats[s]?.ready)) this.#startMatch();
    else this.broadcastRoom();
    return OK;
  }

  /** Facção do time (qualquer um dos dois parceiros escolhe). */
  setFaction(userId: string, faction: FactionId): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const state = this.state;
    if (state === 'placing' || state === 'playing') return err('wrong-state');
    const team = teamOf(seat);
    if (this.#present().some(([s, p]) => teamOf(s) === team && p.ready)) return err('wrong-state');
    this.#factions[team] = faction;
    this.broadcastRoom();
    return OK;
  }

  setMuted(userId: string, muted: boolean, who: 'opponents' | 'partner'): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const me = this.#seats[seat] as SeatState;
    if (who === 'partner') me.mutedPartner = muted;
    else me.mutedOpponents = muted;
    return OK;
  }

  rematch(userId: string, accept: boolean): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    if (this.state !== 'finished' || this.#present().length < 4) return err('wrong-state');
    (this.#seats[seat] as SeatState).wantsRematch = accept;
    if (SEATS.every((s) => this.#seats[s]?.wantsRematch)) {
      this.#firstTeam = opponentOf(this.#firstTeam);
      this.#startMatch();
      return OK;
    }
    if (accept) for (const [s, p] of this.#present()) if (s !== seat) this.#hub.send(p.userId, { t: 'rematch', offeredBy: seat });
    this.broadcastRoom();
    return OK;
  }

  #startMatch(): void {
    const now = this.#hub.now();
    this.#matchNumber++;
    for (const [, p] of this.#present()) {
      p.ready = false;
      p.wantsRematch = false;
      p.graceUsedMs = 0;
    }
    try {
      this.#match = new TeamMatch({
        seed: this.#settings.seed?.() ?? randomInt(0, 2 ** 32),
        config: this.mode,
        ...(this.size ? { size: this.size } : {}),
        firstTeam: this.#firstTeam,
        clock: this.#settings.clocks[this.clock] ?? this.clock,
        startTime: now,
        factions: { ...this.#factions },
        ...(this.mutators.length > 0 ? { mutators: this.mutators } : {}),
      });
    } catch {
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
    this.#abandoned = null;
    const placement = this.#settings.placementMs[this.clock];
    this.#placementDeadline = placement === null ? null : now + placement;
    this.#hub.stateChanged(this);
    this.broadcastRoom();
    for (const id of this.players) this.sendState(id);
  }

  // ------------------------------------------------------------ posicionamento

  #placingContext(userId: string): { ok: true; match: TeamMatch; seat: SeatId } | { ok: false; code: ErrorCode; detail?: string } {
    const seat = this.seatOf(userId);
    if (!seat) return { ok: false, code: 'not-in-room' };
    const match = this.#match;
    if (!match || match.phase !== 'placing') return { ok: false, code: 'wrong-state' };
    return { ok: true, match, seat };
  }

  /** Estado novo para os dois parceiros: o campo é do time. */
  #sendTeam(seat: SeatId): void {
    for (const s of [seat, partnerOf(seat)]) {
      const p = this.#seats[s];
      if (p) this.sendState(p.userId);
    }
  }

  /**
   * Troca as peças deste lugar pelo layout enviado (só as peças dele; as do
   * parceiro ficam). Se algo falhar, volta ao que estava.
   */
  submitPlacement(userId: string, placements: readonly Placement[], confirm: boolean): RoomResult {
    const ctx = this.#placingContext(userId);
    if (!ctx.ok) return ctx;
    const { match, seat } = ctx;
    const team = teamOf(seat);
    if (placements.length > 0) {
      for (const p of placements) {
        const owner = match.ownerOf(team, p.pieceId);
        if (owner !== seat) return err('match-error', owner ? 'not-your-piece' : 'unknown-piece');
      }
      const view = match.viewFor(seat);
      const mine = new Set(match.piecesOfSeat(seat).map((p) => p.id));
      const previous = view.own.pieces.flatMap((p) => (p.placement && mine.has(p.id) ? [p.placement] : []));
      for (const p of previous) match.remove(seat, p.pieceId);
      for (const p of placements) {
        const r = match.place(seat, p.pieceId, p.anchor, p.rotation);
        if (!r.ok) {
          for (const q of match.piecesOfSeat(seat)) match.remove(seat, q.id);
          for (const q of previous) match.place(seat, q.pieceId, q.anchor, q.rotation);
          this.#sendTeam(seat);
          return err('match-error', r.error);
        }
      }
    }
    if (confirm) {
      const done = match.confirm(seat);
      if (!done.ok) {
        this.#sendTeam(seat);
        return err('match-error', done.error);
      }
      this.#afterConfirm(seat);
    } else {
      this.#sendTeam(seat);
    }
    return OK;
  }

  autoPlace(userId: string): RoomResult {
    const ctx = this.#placingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.autoPlace(ctx.seat);
    if (!r.ok) return err('match-error', r.error);
    this.#sendTeam(ctx.seat);
    return OK;
  }

  #afterConfirm(seat: SeatId): void {
    const match = this.#match as TeamMatch;
    if (match.phase === 'playing') {
      this.#placementDeadline = null;
      this.#broadcastEvent(() => ({ kind: 'start' }));
      this.#scanHistory();
      this.#hub.stateChanged(this);
      this.broadcastRoom();
    } else {
      this.#broadcastEvent(() => ({ kind: 'confirmed', by: teamOf(seat), seat }));
    }
  }

  /** Prazo de posicionamento: quem não confirmou confirma o que tem ou recebe peças automáticas. */
  #forcePlacement(): void {
    const match = this.#match as TeamMatch;
    this.#placementDeadline = null;
    for (const seat of SEATS) {
      if (match.phase !== 'placing') break;
      if (match.viewFor(seat).doubles.team.find((t) => t.seat === seat)?.confirmed) continue;
      let ok = match.confirm(seat).ok;
      for (let attempt = 0; !ok && attempt < 5; attempt++) {
        match.autoPlace(seat);
        ok = match.confirm(seat).ok;
      }
      if (!ok) {
        // As peças do parceiro não deixaram espaço: o time perde por não posicionar.
        match.surrender(seat);
        this.#afterAction();
        return;
      }
      this.#afterConfirm(seat);
    }
  }

  // ------------------------------------------------------------ jogo

  #playingContext(userId: string): { ok: true; match: TeamMatch; seat: SeatId } | { ok: false; code: ErrorCode; detail?: string } {
    const seat = this.seatOf(userId);
    if (!seat) return { ok: false, code: 'not-in-room' };
    const match = this.#match;
    if (!match) return { ok: false, code: 'wrong-state' };
    this.#applyClock(match.tick(this.#hub.now()));
    if (match.phase !== 'playing') return { ok: false, code: 'match-error', detail: match.phase === 'finished' ? 'finished' : 'wrong-phase' };
    return { ok: true, match, seat };
  }

  attack(userId: string, target: Coord): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.attack(ctx.seat, target);
    if (!r.ok) return err('match-error', r.error);
    const seat = ctx.seat;
    this.#broadcastEvent(() => ({ kind: 'shot', outcome: r.outcome, seat }));
    this.#afterAction();
    return OK;
  }

  ability(userId: string, request: AbilityRequest): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.useAbility(ctx.seat, request);
    if (!r.ok) return err('match-error', r.error);
    const seat = ctx.seat;
    const by = teamOf(seat);
    const isPublic = r.outcome.ability === 'bomb';
    this.#broadcastEvent((to) => ({ kind: 'ability', by, seat, ability: request.ability, outcome: teamOf(to) === by || isPublic ? r.outcome : null }));
    this.#afterAction();
    return OK;
  }

  special(userId: string, request: SpecialShotRequest): RoomResult {
    const ctx = this.#playingContext(userId);
    if (!ctx.ok) return ctx;
    const r = ctx.match.special(ctx.seat, request);
    if (!r.ok) return err('match-error', r.error);
    const seat = ctx.seat;
    const by = teamOf(seat);
    const isPrivate = r.outcome.kind === 'probe';
    this.#broadcastEvent((to) => ({
      kind: 'special',
      by,
      seat,
      special: r.outcome.special,
      outcome: teamOf(to) === by || !isPrivate ? r.outcome : null,
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

  #applyClock(events: ReturnType<TeamMatch['tick']>): void {
    const match = this.#match;
    if (!match || events.length === 0) return;
    for (const event of events) {
      const strikes = match.viewFor(event.seat).own.clock.strikes;
      const seat = event.seat;
      this.#broadcastEvent(() => ({ kind: 'timeout', player: teamOf(seat), seat, forfeit: event.forfeit, strikes }));
    }
    this.#afterAction();
  }

  #scanHistory(): void {
    const match = this.#match;
    if (!match) return;
    const history = match.viewFor('blue-1').history;
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

  #afterAction(): void {
    this.#scanHistory();
    const match = this.#match;
    if (!match || match.phase !== 'finished' || this.#finishedAt !== null) return;
    this.#finishedAt = this.#hub.now();
    this.#placementDeadline = null;
    const winner = match.winner as PlayerId;
    const reason: WinReason = this.#abandoned ? 'abandon' : (match.winReason ?? 'destroyed');
    this.#broadcastEvent(() => ({ kind: 'end', winner, reason }));
    if (this.#present().length === 4) {
      this.#lastRecord = this.#stored();
      this.#hub.matchEnded(this, this.#lastRecord);
    }
    this.#hub.stateChanged(this);
    this.broadcastRoom();
  }

  #stored(): StoredMatch {
    const match = this.#match as TeamMatch;
    const players: Record<string, string> = {};
    for (const [s, p] of this.#present()) players[s] = p.userId;
    return {
      id: `${this.code}-${this.#matchNumber}`,
      room: this.code,
      endedAt: this.#hub.now(),
      players,
      winner: match.winner,
      reason: this.#abandoned ? 'abandon' : match.winReason,
      record: match.toRecord(),
    };
  }

  // ------------------------------------------------------------ emotes

  emote(userId: string, kind: EmoteKind, emote: string, to: EmoteAudience): RoomResult {
    const seat = this.seatOf(userId);
    if (!seat) return err('not-in-room');
    const me = this.#seats[seat] as SeatState;
    const now = this.#hub.now();
    if (kind === 'emoji') {
      if (now - me.lastEmojiAt < EMOTE.emojiCooldownMs || !me.emojiWindow.allow(now)) return err('emote-cooldown');
      me.lastEmojiAt = now;
    } else {
      if (now - me.lastTauntAt < EMOTE.tauntCooldownMs) return err('emote-cooldown');
      me.lastTauntAt = now;
    }
    this.emoteLog.push({ from: userId, emote: `${kind}:${emote}${to === 'team' ? ':time' : ''}`, at: now });
    if (this.emoteLog.length > 200) this.emoteLog.shift();
    const partner = partnerOf(seat);
    for (const [s, p] of this.#present()) {
      if (s === seat) continue;
      const isPartner = s === partner;
      if (to === 'team' && !isPartner) continue;
      if ((isPartner && p.mutedPartner) || (!isPartner && p.mutedOpponents)) continue;
      if (this.#hub.blocked(p.userId, userId)) continue;
      this.#hub.send(p.userId, { t: 'emote', from: seat, kind, emote, to });
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
      for (const [, p] of this.#present()) {
        if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= this.#settings.lobbyGraceMs) {
          this.leave(p.userId);
          if (this.#closed) return;
        }
      }
      return;
    }

    if (match.phase === 'placing') {
      if (this.#placementDeadline !== null && now >= this.#placementDeadline) this.#forcePlacement();
      for (const [s, p] of this.#present()) {
        if (match.phase === 'placing' && !p.connected && p.disconnectedAt !== null && now - p.disconnectedAt >= this.#settings.lobbyGraceMs) {
          this.#abandoned = teamOf(s);
          match.surrender(s);
          this.#afterAction();
        }
      }
      return;
    }

    if (match.phase === 'playing') {
      this.#applyClock(match.tick(now));
      for (const [s, p] of this.#present()) {
        const left = this.#graceLeft(p, now);
        if (match.phase === 'playing' && left !== null && left <= 0) {
          this.#abandoned = teamOf(s);
          match.surrender(s);
          this.#afterAction();
        }
      }
      return;
    }

    const anyone = this.#present().some(([, p]) => p.connected);
    if (!anyone || (this.#finishedAt !== null && now - this.#finishedAt >= this.#settings.finishedTtlMs)) this.close('expired');
  }

  // ------------------------------------------------------------ envio

  broadcastRoom(): void {
    for (const [s, p] of this.#present()) this.#hub.send(p.userId, { t: 'room', room: this.#info(s) });
  }

  sendState(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat || !this.#match) return;
    const view = this.#match.viewFor(seat);
    this.#historySent[seat] = view.history.length;
    this.#hub.send(userId, { t: 'match.state', view: this.#pack(view, 0), serverTime: this.#hub.now() });
  }

  #pack(view: TeamView, historyStart: number): PackedView {
    if (!this.mutators.includes('neblina')) return packView(view, historyStart);
    return packView({ ...view, history: fogHistory(view) }, 0);
  }

  #broadcastEvent(build: (seat: SeatId) => MatchEvent): void {
    const match = this.#match;
    if (!match) return;
    for (const [s, p] of this.#present()) {
      const view = match.viewFor(s);
      const packed = this.#pack(view, this.#historySent[s]);
      this.#historySent[s] = view.history.length;
      this.#hub.send(p.userId, { t: 'match.event', event: build(s), view: packed, serverTime: this.#hub.now() });
    }
  }

  close(reason: 'expired' | 'shutdown' | 'deleted' | null): void {
    if (this.#closed) return;
    this.#closed = true;
    if (reason) for (const [, p] of this.#present()) this.#hub.send(p.userId, { t: 'room.closed', reason });
    this.#hub.closed(this);
  }
}
