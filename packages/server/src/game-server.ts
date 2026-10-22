import { randomBytes, randomInt } from 'node:crypto';
import {
  decodeClientMessage,
  encode,
  errorText,
  EMOTE,
  generateRoomCode,
  negotiateVersion,
  normalizeRoomCode,
  PROTOCOL_MAX,
  PROTOCOL_MIN,
  type ClientMessage,
  type ErrorCode,
  type PresenceStatus,
  type ServerMessage,
} from '@riverfront/protocol';
import { Match, TeamMatch, type MutatorId } from '@riverfront/core';
import { applyProfilePatch, createAccount, persistAccount, publicProfile, tokenMatches } from './accounts.ts';
import type { Logger } from './log.ts';
import { SlidingWindow, TokenBucket } from './rate.ts';
import { syncCampaign, verifyMission } from './campaign.ts';
import { DailyService } from './daily.ts';
import type { GameRoom, RoomHub, RoomResult, RoomSettings } from './game-room.ts';
import { Room } from './room.ts';
import { TeamRoom } from './team-room.ts';
import * as social from './social.ts';
import type { Account, Store, StoredMatch } from './store/types.ts';
import { CLOSE, type Connection, type TransportHandlers } from './transport.ts';

export interface GameServerOptions {
  readonly store: Store;
  readonly logger: Logger;
  readonly now: () => number;
  readonly version: string;
  readonly maxMessageBytes: number;
  readonly maxSessions: number;
  readonly helloTimeoutMs: number;
  readonly tickMs: number;
  readonly rate: { readonly burst: number; readonly perSecond: number };
  readonly room: RoomSettings;
  /** Contas novas por IP e por hora, teto total e dias sem acesso até a conta expirar. */
  readonly accounts: { readonly perIpPerHour: number; readonly max: number; readonly inactiveDays: number };
  /** Dias que denúncias e partidas encerradas ficam guardadas. */
  readonly retention: { readonly reportsDays: number; readonly matchesDays: number };
}

interface Session {
  readonly conn: Connection;
  userId: string | null;
  readonly bucket: TokenBucket;
  violations: number;
  helloTimer: NodeJS.Timeout | null;
  readonly invites: SlidingWindow;
  readonly reports: SlidingWindow;
  readonly missions: SlidingWindow;
  closed: boolean;
}

type Handled = { readonly ok: true } | { readonly ok: false; readonly code: ErrorCode; readonly detail?: string | undefined };
const OK: Handled = { ok: true };
const fail = (code: ErrorCode, detail?: string): Handled => ({ ok: false, code, detail });

/** Mais que isso na fila de saída e o cliente é considerado travado. */
const MAX_BUFFERED = 4 * 1024 * 1024;
/** Mensagens inválidas ou acima do limite antes de derrubar a conexão. */
const MAX_VIOLATIONS = 40;

/** Id da mensagem, para a resposta de erro chegar a quem pediu, sem validar o resto. */
function refOf(text: string): number | null {
  if (text.length > 4096) return null;
  const match = /"id"\s*:\s*(\d{1,10})/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Mensagens que só leem: não obrigam a gravar uma conta nova. A lista de
 * amigos fica de fora de propósito: o cliente de verdade pede logo ao entrar,
 * e quem vai mostrar a própria etiqueta precisa existir para ser achado.
 */
const READ_ONLY = new Set<ClientMessage['t']>(['sync', 'daily.get', 'campaign.get']);

export interface ServerStats {
  readonly sessions: number;
  readonly players: number;
  readonly rooms: number;
  readonly matches: number;
}

/**
 * Lógica do servidor, sem saber de rede. Todas as mensagens passam por uma
 * fila única: as salas e contas nunca são alteradas por duas mensagens ao
 * mesmo tempo, mesmo quando o armazenamento é assíncrono.
 */
export class GameServer implements TransportHandlers {
  readonly #o: GameServerOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #online = new Map<string, Session>();
  readonly #rooms = new Map<string, GameRoom>();
  readonly #userRoom = new Map<string, GameRoom>();
  readonly daily: DailyService;
  readonly #blocks = new Map<string, Set<string>>();
  readonly #hub: RoomHub;
  #queue: Promise<void> = Promise.resolve();
  #ticker: NodeJS.Timeout | null = null;
  #tickPending = false;
  #maintenance: NodeJS.Timeout | null = null;
  /** Contas recém-criadas que ainda não precisaram ser gravadas. */
  readonly #pending = new Map<string, Account>();
  /** Contas novas por IP (janela de 1 hora). */
  readonly #newByIp = new Map<string, SlidingWindow>();
  #stopping = false;

  constructor(options: GameServerOptions) {
    this.#o = options;
    this.daily = new DailyService(options.store, options.now);
    this.#hub = {
      now: () => this.#o.now(),
      send: (userId, msg) => this.#sendTo(userId, msg),
      blocked: (a, b) => this.#blocks.get(a)?.has(b) === true || this.#blocks.get(b)?.has(a) === true,
      matchEnded: (room, stored) => this.#matchEnded(room, stored),
      stateChanged: (room) => {
        for (const id of room.players) void this.#pushPresence(id);
      },
      left: (room, userId) => {
        if (this.#userRoom.get(userId) === room) this.#userRoom.delete(userId);
        void this.#pushPresence(userId);
      },
      closed: (room) => {
        this.#rooms.delete(room.code);
        for (const id of room.players) {
          if (this.#userRoom.get(id) === room) this.#userRoom.delete(id);
          void this.#pushPresence(id);
        }
        this.#o.logger.info('room.closed', { room: room.code });
      },
    };
  }

  start(): void {
    this.#ticker = setInterval(() => {
      if (this.#tickPending) return;
      this.#tickPending = true;
      this.#enqueue(async () => {
        this.#tickPending = false;
        for (const room of [...this.#rooms.values()]) room.tick();
      });
    }, this.#o.tickMs);
    this.#ticker.unref?.();
    this.#enqueue(() => this.#housekeeping());
    this.#maintenance = setInterval(() => this.#enqueue(() => this.#housekeeping()), 6 * 60 * 60_000);
    this.#maintenance.unref?.();
  }

  /** Expira contas paradas, aplica a retenção de denúncias/partidas e das tabelas do diário. */
  async #housekeeping(): Promise<void> {
    const now = this.#o.now();
    const DAY = 24 * 60 * 60_000;
    const online = new Set(this.#online.keys());
    const expired = await this.#o.store.pruneInactive(now - this.#o.accounts.inactiveDays * DAY, online);
    await this.#o.store.pruneHistory(now - this.#o.retention.reportsDays * DAY, now - this.#o.retention.matchesDays * DAY);
    await this.daily.prune();
    for (const [ip, window] of this.#newByIp) if (window.empty(now)) this.#newByIp.delete(ip);
    if (expired > 0) this.#o.logger.info('accounts.expired', { count: expired });
  }

  stats(): ServerStats {
    let matches = 0;
    for (const room of this.#rooms.values()) if (room.state === 'placing' || room.state === 'playing') matches++;
    return { sessions: this.#sessions.size, players: this.#online.size, rooms: this.#rooms.size, matches };
  }

  /** Aguarda tudo que já está na fila (usado nos testes e no desligamento). */
  idle(): Promise<void> {
    return this.#queue;
  }

  #enqueue(job: () => Promise<void>): void {
    this.#queue = this.#queue.then(job).catch((error: unknown) => {
      this.#o.logger.error('job.failed', { error: error instanceof Error ? error.stack : String(error) });
    });
  }

  // ------------------------------------------------------------ transporte

  open(conn: Connection): void {
    if (this.#stopping || this.#sessions.size >= this.#o.maxSessions) {
      conn.send(encode({ t: 'error', ref: null, code: 'server-full', detail: null, message: errorText('server-full') }));
      conn.close(CLOSE.goingAway, 'cheio');
      return;
    }
    const now = this.#o.now();
    const session: Session = {
      conn,
      userId: null,
      bucket: new TokenBucket(this.#o.rate.burst, this.#o.rate.perSecond, now),
      violations: 0,
      helloTimer: null,
      invites: new SlidingWindow(6, 60_000),
      reports: new SlidingWindow(5, 60 * 60_000),
      missions: new SlidingWindow(20, 10 * 60_000),
      closed: false,
    };
    session.helloTimer = setTimeout(() => {
      if (!session.userId && !session.closed) conn.close(CLOSE.helloTimeout, 'sem hello');
    }, this.#o.helloTimeoutMs);
    session.helloTimer.unref?.();
    this.#sessions.set(conn.id, session);
    this.#o.logger.debug('conn.open', { conn: conn.id, ip: conn.ip });
  }

  message(conn: Connection, text: string): void {
    const session = this.#sessions.get(conn.id);
    if (!session || session.closed) return;
    if (!session.bucket.take(this.#o.now())) {
      this.#violation(session, 'rate-limited', refOf(text));
      return;
    }
    const decoded = decodeClientMessage(text, this.#o.maxMessageBytes);
    if (!decoded.ok) {
      this.#violation(session, decoded.code, decoded.ref, decoded.reason);
      return;
    }
    const msg = decoded.msg;
    this.#enqueue(async () => {
      if (session.closed) return;
      let result: Handled;
      try {
        result = await this.#handle(session, msg);
      } catch (error) {
        this.#o.logger.error('handle.failed', { t: msg.t, error: error instanceof Error ? error.stack : String(error) });
        result = fail('internal');
      }
      const ref = msg.id ?? null;
      if (!result.ok) this.#send(session, { t: 'error', ref, code: result.code, detail: result.detail ?? null, message: errorText(result.code, result.detail) });
      else if (ref !== null) this.#send(session, { t: 'ok', ref });
    });
  }

  close(conn: Connection): void {
    const session = this.#sessions.get(conn.id);
    if (!session) return;
    session.closed = true;
    if (session.helloTimer) clearTimeout(session.helloTimer);
    this.#sessions.delete(conn.id);
    const userId = session.userId;
    if (!userId || this.#online.get(userId) !== session) return;
    this.#online.delete(userId);
    // conta que nunca precisou ser gravada some junto com a conexão
    this.#pending.delete(userId);
    this.#enqueue(async () => {
      // Pode ter voltado por outra conexão enquanto isto esperava na fila.
      if (this.#online.has(userId)) return;
      this.#userRoom.get(userId)?.disconnect(userId);
      this.#blocks.delete(userId);
      await this.#pushPresence(userId);
      this.#o.logger.debug('player.offline', { user: userId });
    });
  }

  #violation(session: Session, code: ErrorCode, ref: number | null, reason?: string): void {
    session.violations++;
    if (session.violations > MAX_VIOLATIONS) {
      this.#o.logger.warn('conn.abuse', { conn: session.conn.id, ip: session.conn.ip, code });
      session.conn.close(CLOSE.policy, 'abuso');
      return;
    }
    // Responde só às primeiras para não virar amplificador.
    if (session.violations <= 10) {
      this.#send(session, { t: 'error', ref, code, detail: reason ?? null, message: errorText(code) });
    }
  }

  #send(session: Session, msg: ServerMessage): void {
    if (session.closed) return;
    if (session.conn.bufferedAmount() > MAX_BUFFERED) {
      session.conn.close(CLOSE.slow, 'lento');
      return;
    }
    session.conn.send(encode(msg));
  }

  #sendTo(userId: string, msg: ServerMessage): void {
    const session = this.#online.get(userId);
    if (session) this.#send(session, msg);
  }

  // ------------------------------------------------------------ mensagens

  async #handle(session: Session, msg: ClientMessage): Promise<Handled> {
    if (msg.t === 'hello') return this.#hello(session, msg);
    if (msg.t === 'ping') {
      this.#send(session, { t: 'pong', ts: msg.ts, serverTime: this.#o.now() });
      return OK;
    }
    const userId = session.userId;
    if (!userId) return fail('not-authenticated');
    if (this.#pending.has(userId) && !READ_ONLY.has(msg.t)) await this.#persist(userId);
    const room = this.#userRoom.get(userId) ?? null;
    const viaRoom = (r: RoomResult): Handled => (r.ok ? OK : fail(r.code, r.detail));

    switch (msg.t) {
      case 'profile.update':
        return this.#updateProfile(userId, msg);
      case 'room.create':
        return this.#createRoom(userId, msg);
      case 'room.join':
        return this.#joinRoom(userId, msg.code);
      case 'room.leave':
        if (!room) return fail('not-in-room');
        room.leave(userId);
        this.#sendTo(userId, { t: 'room.closed', reason: 'left' });
        return OK;
      case 'sync':
        if (!room) return fail('not-in-room');
        {
          const info = room.infoFor(userId);
          if (info) this.#sendTo(userId, { t: 'room', room: info });
        }
        room.sendState(userId);
        return OK;
      case 'faction':
        return room ? viaRoom(room.setFaction(userId, msg.faction)) : fail('not-in-room');
      case 'ready':
        return room ? viaRoom(room.setReady(userId, msg.ready)) : fail('not-in-room');
      case 'placement.submit':
        return room ? viaRoom(room.submitPlacement(userId, msg.placements, msg.confirm)) : fail('not-in-room');
      case 'placement.auto':
        return room ? viaRoom(room.autoPlace(userId)) : fail('not-in-room');
      case 'attack':
        return room ? viaRoom(room.attack(userId, msg.target)) : fail('not-in-room');
      case 'special':
        return room ? viaRoom(room.special(userId, msg.request)) : fail('not-in-room');
      case 'ability':
        return room ? viaRoom(room.ability(userId, msg.request)) : fail('not-in-room');
      case 'surrender':
        return room ? viaRoom(room.surrender(userId)) : fail('not-in-room');
      case 'emote':
        return room ? viaRoom(room.emote(userId, msg.kind, msg.emote, msg.to ?? 'all')) : fail('not-in-room');
      case 'mute':
        return room ? viaRoom(room.setMuted(userId, msg.muted, msg.who ?? 'opponents')) : fail('not-in-room');
      case 'seat.choose':
        return room ? viaRoom(room.chooseSeat(userId, msg.seat)) : fail('not-in-room');
      case 'rematch':
        return room ? viaRoom(room.rematch(userId, msg.accept)) : fail('not-in-room');
      case 'friends.list':
        await this.#sendFriends(userId);
        return OK;
      case 'friends.request':
      case 'friends.accept':
      case 'friends.decline':
      case 'friends.remove':
      case 'friends.block':
      case 'friends.unblock':
        return this.#social(userId, msg);
      case 'invite':
        return this.#invite(session, userId, msg.userId);
      case 'report':
        return this.#report(session, userId, msg);
      case 'account.delete':
        await this.#deleteAccount(userId);
        return OK;
      case 'daily.get':
        return this.#dailyGet(userId, msg.date);
      case 'daily.submit':
        return this.#dailySubmit(userId, msg.date, msg.log);
      case 'campaign.get': {
        const account = await this.#o.store.getAccount(userId);
        this.#sendTo(userId, { t: 'campaign', campaign: account?.campaign ?? null });
        return OK;
      }
      case 'campaign.sync':
        return this.#campaign(userId, msg);
      case 'campaign.result':
        // cada missão é refeita no servidor: limite por conexão
        if (!session.missions.allow(this.#o.now())) return fail('rate-limited', 'missões');
        return this.#campaign(userId, msg);
    }
  }

  async #hello(session: Session, msg: Extract<ClientMessage, { t: 'hello' }>): Promise<Handled> {
    if (session.userId) return fail('wrong-state');
    const version = negotiateVersion(msg.protocol);
    if (version === null) {
      this.#send(session, {
        t: 'error',
        ref: msg.id ?? null,
        code: 'protocol-mismatch',
        detail: `${PROTOCOL_MIN}-${PROTOCOL_MAX}`,
        message: errorText('protocol-mismatch'),
      });
      session.conn.close(CLOSE.protocol, 'versão');
      return OK;
    }
    const now = this.#o.now();
    let account: Account | null = null;
    let token: string | null = null;
    if (msg.auth) {
      const found = this.#pending.get(msg.auth.userId) ?? (await this.#o.store.getAccount(msg.auth.userId));
      if (found && tokenMatches(found, msg.auth.token)) account = found;
      else this.#o.logger.info('auth.failed', { ip: session.conn.ip });
    }
    if (!account) {
      // Limites contra criação em massa: por IP (janela de 1 hora) e no total.
      const ip = session.conn.ip;
      let window = this.#newByIp.get(ip);
      if (!window) {
        window = new SlidingWindow(this.#o.accounts.perIpPerHour, 60 * 60_000);
        this.#newByIp.set(ip, window);
      }
      if (!window.allow(now)) {
        this.#o.logger.warn('accounts.ip-limit', { ip });
        this.#send(session, { t: 'error', ref: msg.id ?? null, code: 'rate-limited', detail: 'contas', message: errorText('rate-limited') });
        session.conn.close(CLOSE.policy, 'contas demais');
        return OK;
      }
      if ((await this.#o.store.accountCount()) + this.#pending.size >= this.#o.accounts.max) {
        this.#send(session, { t: 'error', ref: msg.id ?? null, code: 'server-full', detail: 'contas', message: errorText('server-full') });
        session.conn.close(CLOSE.goingAway, 'cheio');
        return OK;
      }
      // Só em memória por enquanto: vira registro quando o jogador fizer algo que precise ser guardado.
      const created = await createAccount(this.#o.store, now, msg.name, false);
      account = created.account;
      token = created.token;
      this.#pending.set(account.id, account);
      this.#o.logger.info('account.created', { user: account.id });
    }
    if (session.closed) return OK;
    account.lastSeenAt = now;
    social.expireRequests(account, now);
    if (!this.#pending.has(account.id)) await this.#o.store.saveAccount(account);

    const previous = this.#online.get(account.id);
    session.userId = account.id;
    if (session.helloTimer) clearTimeout(session.helloTimer);
    this.#online.set(account.id, session);
    this.#blocks.set(account.id, new Set(account.blocked));
    if (previous && previous !== session) previous.conn.close(CLOSE.replaced, 'conectado em outro lugar');

    const room = this.#userRoom.get(account.id) ?? null;
    this.#send(session, {
      t: 'welcome',
      protocol: version,
      userId: account.id,
      token,
      profile: publicProfile(account),
      serverTime: now,
      resumed: room !== null,
      limits: { maxMessageBytes: this.#o.maxMessageBytes, emojiCooldownMs: EMOTE.emojiCooldownMs, tauntCooldownMs: EMOTE.tauntCooldownMs },
    });
    room?.connect(account.id);
    await this.#pushPresence(account.id);
    this.#o.logger.info('player.online', { user: account.id, ip: session.conn.ip, client: msg.client.name, version: msg.client.version });
    return OK;
  }

  /** Grava uma conta que estava só em memória (avisa se a etiqueta precisou mudar). */
  async #persist(userId: string): Promise<void> {
    const account = this.#pending.get(userId);
    if (!account) return;
    this.#pending.delete(userId);
    if (await persistAccount(this.#o.store, account)) this.#sendTo(userId, { t: 'profile', profile: publicProfile(account) });
  }

  /** Quantas contas estão só em memória (testes). */
  get pendingAccounts(): number {
    return this.#pending.size;
  }

  async #updateProfile(userId: string, patch: Extract<ClientMessage, { t: 'profile.update' }>): Promise<Handled> {
    const account = await this.#o.store.getAccount(userId);
    if (!account) return fail('not-authenticated');
    const { id: _id, t: _t, ...fields } = patch;
    const result = await applyProfilePatch(this.#o.store, account, fields);
    if (!result.ok) return fail(result.code, result.detail);
    const profile = publicProfile(result.account);
    this.#sendTo(userId, { t: 'profile', profile });
    this.#userRoom.get(userId)?.updateProfile(profile);
    return OK;
  }

  async #createRoom(userId: string, msg: Extract<ClientMessage, { t: 'room.create' }>): Promise<Handled> {
    const { clock, mode } = msg;
    const mutators: readonly MutatorId[] = msg.mutators ?? [];
    const size = msg.size ?? null;
    if (this.#userRoom.has(userId)) return fail('already-in-room');
    // Confere antes de abrir a sala que o modo cabe no tamanho pedido.
    const format = msg.format ?? 'duel';
    try {
      if (format === 'doubles') new TeamMatch({ seed: 1, config: mode, mutators, ...(size ? { size } : {}) });
      else new Match({ seed: 1, config: mode, mutators, ...(size ? { size } : {}) });
    } catch {
      return fail('room-options');
    }
    const account = await this.#o.store.getAccount(userId);
    if (!account) return fail('not-authenticated');
    let code = generateRoomCode((n) => randomInt(n));
    while (this.#rooms.has(code)) code = generateRoomCode((n) => randomInt(n));
    const room: GameRoom =
      format === 'doubles'
        ? new TeamRoom(code, mode, clock, this.#hub, this.#o.room, { mutators, size })
        : new Room(code, mode, clock, this.#hub, this.#o.room, { mutators, size });
    this.#rooms.set(code, room);
    this.#userRoom.set(userId, room);
    room.join(publicProfile(account));
    this.#o.logger.info('room.created', { room: code, user: userId, clock, mode, mutators, size, format });
    return OK;
  }

  async #joinRoom(userId: string, codeText: string): Promise<Handled> {
    const code = normalizeRoomCode(codeText);
    const room = code ? this.#rooms.get(code) : undefined;
    if (!room || room.closed) return fail('room-not-found');
    const current = this.#userRoom.get(userId);
    if (current && current !== room) return fail('already-in-room');
    const account = await this.#o.store.getAccount(userId);
    if (!account) return fail('not-authenticated');
    const joined = room.join(publicProfile(account));
    if (!joined.ok) return fail(joined.code, joined.detail);
    this.#userRoom.set(userId, room);
    if (current === room) room.connect(userId);
    return OK;
  }

  // ------------------------------------------------------------ desafio diário e campanha

  async #dailyGet(userId: string, date: string | undefined): Promise<Handled> {
    const account = await this.#o.store.getAccount(userId);
    const name = account ? `${account.name}#${account.tag}` : null;
    const day = await this.daily.get(date, name);
    if (!day) return fail('wrong-state', 'dia fora do período');
    this.#sendTo(userId, { t: 'daily', challenge: day.challenge, board: day.board.entries, rank: day.rank });
    return OK;
  }

  async #dailySubmit(userId: string, date: string, log: Extract<ClientMessage, { t: 'daily.submit' }>['log']): Promise<Handled> {
    const account = await this.#o.store.getAccount(userId);
    if (!account) return fail('not-authenticated');
    const result = await this.daily.submit(account, date, log);
    if (!result.ok) {
      this.#o.logger.info('daily.rejected', { user: userId, date, reason: result.detail });
      return fail(result.code, result.detail);
    }
    this.#sendTo(userId, { t: 'daily.result', date, entry: result.entry, rank: result.rank });
    this.#o.logger.info('daily.result', { user: userId, date, score: result.entry.score, rank: result.rank });
    return OK;
  }

  async #campaign(userId: string, msg: Extract<ClientMessage, { t: 'campaign.sync' | 'campaign.result' }>): Promise<Handled> {
    const account = await this.#o.store.getAccount(userId);
    if (!account) return fail('not-authenticated');
    const now = this.#o.now();
    const result = msg.t === 'campaign.sync' ? syncCampaign(account, msg.progress, now) : verifyMission(account, msg.mission, msg.log, now);
    if (!result.ok) return fail(result.code, result.detail);
    await this.#o.store.saveAccount(account);
    this.#sendTo(userId, { t: 'campaign', campaign: result.campaign });
    return OK;
  }

  // ------------------------------------------------------------ amigos

  #presence(userId: string): PresenceStatus {
    if (!this.#online.has(userId)) return 'offline';
    const state = this.#userRoom.get(userId)?.state;
    return state === 'placing' || state === 'playing' ? 'in-match' : 'online';
  }

  async #pushPresence(userId: string): Promise<void> {
    const account = await this.#o.store.getAccount(userId);
    if (!account) return;
    const status = this.#presence(userId);
    for (const friend of account.friends) this.#sendTo(friend, { t: 'presence', userId, status });
  }

  async #sendFriends(userId: string): Promise<void> {
    if (!this.#online.has(userId)) return;
    const account = await this.#o.store.getAccount(userId);
    if (!account) return;
    if (social.expireRequests(account, this.#o.now())) await this.#o.store.saveAccount(account);
    const list = await social.buildList(this.#o.store, account, (id) => this.#presence(id));
    this.#sendTo(userId, { t: 'friends', list });
  }

  async #social(userId: string, msg: Extract<ClientMessage, { t: `friends.${string}` }>): Promise<Handled> {
    const me = await this.#o.store.getAccount(userId);
    if (!me) return fail('not-authenticated');
    const now = this.#o.now();
    const store = this.#o.store;
    let result: social.SocialResult;
    switch (msg.t) {
      case 'friends.request':
        result = await social.sendRequest(store, me, msg.tag, now);
        break;
      case 'friends.accept':
        result = await social.acceptRequest(store, me, msg.userId, now);
        break;
      case 'friends.decline':
        result = await social.declineRequest(store, me, msg.userId);
        break;
      case 'friends.remove':
        result = await social.removeFriend(store, me, msg.userId);
        break;
      case 'friends.block':
        result = await social.block(store, me, msg.userId);
        break;
      case 'friends.unblock':
        result = await social.unblock(store, me, msg.userId);
        break;
      default:
        return fail('bad-message');
    }
    if (!result.ok) return fail(result.code);
    for (const id of result.touched) {
      if (!this.#online.has(id)) continue;
      const fresh = await store.getAccount(id);
      if (fresh) this.#blocks.set(id, new Set(fresh.blocked));
      await this.#sendFriends(id);
    }
    if (result.notify) this.#sendTo(result.notify.to, { t: 'friend.request', from: publicProfile(result.notify.from) });
    return OK;
  }

  async #invite(session: Session, userId: string, targetId: string): Promise<Handled> {
    const room = this.#userRoom.get(userId);
    if (!room) return fail('not-in-room');
    if (room.state !== 'waiting' && room.state !== 'lobby') return fail('wrong-state');
    const me = await this.#o.store.getAccount(userId);
    if (!me) return fail('not-authenticated');
    if (!me.friends.includes(targetId)) return fail('not-friends');
    if (this.#hub.blocked(userId, targetId) || this.#presence(targetId) !== 'online') return fail('unavailable');
    if (!session.invites.allow(this.#o.now())) return fail('rate-limited');
    this.#sendTo(targetId, { t: 'invite', from: publicProfile(me), code: room.code });
    return OK;
  }

  async #report(session: Session, userId: string, msg: Extract<ClientMessage, { t: 'report' }>): Promise<Handled> {
    if (msg.userId === userId) return fail('self');
    const target = await this.#o.store.getAccount(msg.userId);
    if (!target) return fail('user-not-found');
    if (!session.reports.allow(this.#o.now())) return fail('rate-limited');
    const room = this.#userRoom.get(userId);
    const shared = room && room.seatOf(msg.userId) ? room : null;
    let match: StoredMatch | null = null;
    if (msg.attachMatch) match = shared?.recordFor() ?? (await this.#o.store.lastMatchBetween(userId, msg.userId));
    const emotes = shared ? shared.emoteLog.filter((e) => e.from === msg.userId || e.from === userId) : [];
    await this.#o.store.appendReport({
      id: randomBytes(8).toString('hex'),
      at: this.#o.now(),
      reporter: userId,
      target: msg.userId,
      reason: msg.reason,
      note: msg.note ?? '',
      match,
      emotes,
    });
    this.#o.logger.info('report', { reporter: userId, target: msg.userId, reason: msg.reason, attached: match !== null });
    return OK;
  }

  // ------------------------------------------------------------ conta

  async #deleteAccount(userId: string): Promise<void> {
    const account = await this.#o.store.getAccount(userId);
    const room = this.#userRoom.get(userId);
    if (room) room.leave(userId);
    this.#userRoom.delete(userId);
    const affected = account ? [...account.friends, ...account.incoming.map((r) => r.userId), ...account.outgoing.map((r) => r.userId)] : [];
    await this.#o.store.deleteAccount(userId);
    for (const id of affected) await this.#sendFriends(id);
    const session = this.#online.get(userId);
    this.#online.delete(userId);
    this.#blocks.delete(userId);
    if (session) {
      this.#send(session, { t: 'account.deleted' });
      session.conn.close(CLOSE.deleted, 'conta excluída');
    }
    this.#o.logger.info('account.deleted', { user: userId });
  }

  /** Exclusão pela API HTTP (`DELETE /api/account`). */
  deleteAccountWithToken(userId: string, token: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.#enqueue(async () => {
        const account = await this.#o.store.getAccount(userId);
        if (!account || !tokenMatches(account, token)) {
          resolve(false);
          return;
        }
        await this.#deleteAccount(userId);
        resolve(true);
      });
    });
  }

  #matchEnded(room: GameRoom, stored: StoredMatch): void {
    this.#o.store.appendMatch(stored).catch((error: unknown) => this.#o.logger.error('store.match', { error: String(error) }));
    this.#o.logger.info('match.end', { room: room.code, winner: stored.winner, reason: stored.reason, turns: stored.record.log.length });
  }

  // ------------------------------------------------------------ desligamento

  async shutdown(retryInMs = 5_000): Promise<void> {
    this.#stopping = true;
    if (this.#ticker) clearInterval(this.#ticker);
    if (this.#maintenance) clearInterval(this.#maintenance);
    await this.#queue;
    for (const session of this.#sessions.values()) this.#send(session, { t: 'server.shutdown', retryInMs });
    for (const room of [...this.#rooms.values()]) room.close('shutdown');
    await this.#o.store.flush();
  }
}
