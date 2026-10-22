import type { ClockPresetId, DailyChallenge, DailyEntry, FactionId, LogEntry, MutatorId, SeatId } from '@riverfront/core';
import type {
  EmojiId,
  EmoteAudience,
  RoomFormat,
  StoredCampaign,
  FieldSize,
  FriendsList,
  GameMode,
  PresenceStatus,
  ProfilePatch,
  PublicProfile,
  ReportReason,
  RoomInfo,
  ServerMessage,
  TauntId,
} from '@riverfront/protocol';
import { Connection, type ConnectionOptions, type ConnectionStatus, type NetResult } from './connection.ts';
import { Emitter } from './emitter.ts';
import { RemoteMatchHost } from './remoteMatchHost.ts';
import { CampaignStore, ProfileStorage } from './storage.ts';

export interface SessionEvents {
  status: ConnectionStatus;
  rtt: number;
  fatal: string;
  profile: PublicProfile;
  room: RoomInfo;
  /** A sala acabou (expirou, o outro saiu, você saiu...). */
  roomClosed: Extract<ServerMessage, { t: 'room.closed' }>['reason'];
  /** A partida começou ou recomeçou (revanche): hora de trocar para a tela do jogo. */
  matchStart: { room: RoomInfo; host: RemoteMatchHost };
  friends: FriendsList;
  presence: { userId: string; status: PresenceStatus };
  friendRequest: PublicProfile;
  invite: { from: PublicProfile; code: string };
  emote: Extract<ServerMessage, { t: 'emote' }>;
  colourAdjusted: { wanted: string; given: string };
  opponent: { connected: boolean; graceLeftMs: number | null };
  rematchOffer: Extract<ServerMessage, { t: 'rematch' }>['offeredBy'];
  /** Erros que chegam sem pedido associado (ex.: limite de taxa). */
  error: Extract<ServerMessage, { t: 'error' }>;
  accountDeleted: null;
  daily: { challenge: DailyChallenge; board: readonly DailyEntry[]; rank: number | null };
  dailyResult: { date: string; entry: DailyEntry; rank: number | null };
  campaign: StoredCampaign | null;
}

export interface SessionOptions extends Omit<ConnectionOptions, 'storage' | 'url'> {
  readonly storage?: ProfileStorage;
}

/**
 * Tudo do modo online num objeto só: conexão, perfil, sala, amigos e a
 * partida remota. A interface (painel online, HUD) só fala com isto.
 */
export class OnlineSession extends Emitter<SessionEvents> {
  readonly storage: ProfileStorage;
  readonly connection: Connection;
  readonly host: RemoteMatchHost;
  /** Progresso da campanha neste aparelho (localStorage). */
  readonly campaign: CampaignStore;
  #profile: PublicProfile | null;
  #room: RoomInfo | null = null;
  #friends: FriendsList | null = null;
  #matchNumber = 0;

  constructor(url: string, options: SessionOptions = {}) {
    super();
    this.storage = options.storage ?? new ProfileStorage();
    this.#profile = this.storage.profile;
    this.storage.serverUrl = url;
    this.connection = new Connection({ ...options, url, storage: this.storage });
    this.host = new RemoteMatchHost(this.connection);
    this.campaign = new CampaignStore(this.storage.keyValue);
    this.#wire();
  }

  get profile(): PublicProfile | null {
    return this.#profile;
  }

  /** "Nome#1234" */
  get displayTag(): string | null {
    return this.#profile ? `${this.#profile.name}#${this.#profile.tag}` : null;
  }

  get room(): RoomInfo | null {
    return this.#room;
  }

  get friends(): FriendsList | null {
    return this.#friends;
  }

  get status(): ConnectionStatus {
    return this.connection.status;
  }

  async connect(): Promise<void> {
    await this.connection.connect();
    if (this.storage.mutedEmotes && this.#room) void this.connection.request({ t: 'mute', muted: true });
  }

  disconnect(): void {
    this.connection.close();
  }

  dispose(): void {
    this.connection.close();
    this.host.dispose();
    this.connection.clear();
    this.clear();
  }

  // ------------------------------------------------------------ perfil

  updateProfile(patch: ProfilePatch): Promise<NetResult> {
    return this.connection.request({ t: 'profile.update', ...patch });
  }

  /** Apaga a conta no servidor e esquece as credenciais neste aparelho. */
  async deleteAccount(): Promise<NetResult> {
    const result = await this.connection.request({ t: 'account.delete', confirm: 'EXCLUIR' });
    // a conexão cai logo depois da exclusão; "offline" aqui é o esperado
    if (result.ok || result.code === 'offline') {
      this.storage.forget(this.connection.url);
      return { ok: true };
    }
    return result;
  }

  // ------------------------------------------------------------ sala

  /** `size` muda o tamanho do campo (limites em FIELD_LIMITS); o servidor recusa o que não couber. */
  createRoom(
    clock: ClockPresetId,
    mode: GameMode = 'full',
    mutators: readonly MutatorId[] = [],
    size?: FieldSize,
    format: RoomFormat = 'duel',
  ): Promise<NetResult> {
    return this.connection.request({
      t: 'room.create',
      clock,
      mode,
      ...(mutators.length > 0 ? { mutators } : {}),
      ...(size ? { size } : {}),
      ...(format !== 'duel' ? { format } : {}),
    });
  }

  /** Duplas: muda para um lugar livre (antes de marcar pronto). */
  chooseSeat(seat: SeatId): Promise<NetResult> {
    return this.connection.request({ t: 'seat.choose', seat });
  }

  /** Facção da próxima partida (antes de marcar "pronto"). */
  setFaction(faction: FactionId): Promise<NetResult> {
    return this.connection.request({ t: 'faction', faction });
  }

  joinRoom(code: string): Promise<NetResult> {
    return this.connection.request({ t: 'room.join', code });
  }

  leaveRoom(): Promise<NetResult> {
    return this.connection.request({ t: 'room.leave' });
  }

  setReady(ready: boolean): Promise<NetResult> {
    return this.connection.request({ t: 'ready', ready });
  }

  rematch(accept: boolean): Promise<NetResult> {
    return this.connection.request({ t: 'rematch', accept });
  }

  /** `to: 'team'` manda só para o parceiro (duplas). */
  sendEmoji(emote: EmojiId, to: EmoteAudience = 'all'): Promise<NetResult> {
    return this.connection.request({ t: 'emote', kind: 'emoji', emote, ...(to === 'team' ? { to } : {}) });
  }

  sendTaunt(emote: TauntId, to: EmoteAudience = 'all'): Promise<NetResult> {
    return this.connection.request({ t: 'emote', kind: 'taunt', emote, ...(to === 'team' ? { to } : {}) });
  }

  /** Duplas: silencia os emotes do parceiro. */
  mutePartner(muted: boolean): Promise<NetResult> {
    if (!this.#room) return Promise.resolve({ ok: true });
    return this.connection.request({ t: 'mute', muted, who: 'partner' });
  }

  /** Para de receber emotes do adversário (vale para as próximas salas também). */
  muteOpponent(muted: boolean): Promise<NetResult> {
    this.storage.mutedEmotes = muted;
    if (!this.#room) return Promise.resolve({ ok: true });
    return this.connection.request({ t: 'mute', muted });
  }

  // ------------------------------------------------------------ desafio diário

  /** Pede o desafio e a tabela do dia (UTC); a resposta chega no evento 'daily'. */
  getDaily(date?: string): Promise<NetResult> {
    return this.connection.request({ t: 'daily.get', ...(date ? { date } : {}) });
  }

  /**
   * Envia a partida do desafio: o log completo do `Match` local (`match.log`).
   * O servidor refaz a partida, calcula tiros, tempo e pontuação e responde no
   * evento 'dailyResult'; adulterações voltam como `replay-rejected`.
   */
  submitDaily(date: string, log: readonly LogEntry[]): Promise<NetResult> {
    return this.connection.request({ t: 'daily.submit', date, log });
  }

  // ------------------------------------------------------------ campanha

  /** Progresso guardado na conta (opcional). O do aparelho fica em `campaign`. */
  fetchCampaign(): Promise<NetResult> {
    return this.connection.request({ t: 'campaign.get' });
  }

  /** Manda o progresso deste aparelho; o servidor junta com o da conta e devolve o resultado. */
  syncCampaign(): Promise<NetResult> {
    return this.connection.request({ t: 'campaign.sync', progress: this.campaign.progress });
  }

  /** Missão jogada com o log: o servidor confere e marca como verificada. */
  submitMission(mission: string, log: readonly LogEntry[]): Promise<NetResult> {
    return this.connection.request({ t: 'campaign.result', mission, log });
  }

  // ------------------------------------------------------------ amigos

  refreshFriends(): Promise<NetResult> {
    return this.connection.request({ t: 'friends.list' });
  }

  /** `tag` no formato "Nome#1234". */
  addFriend(tag: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.request', tag });
  }

  acceptFriend(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.accept', userId });
  }

  declineFriend(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.decline', userId });
  }

  removeFriend(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.remove', userId });
  }

  block(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.block', userId });
  }

  unblock(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'friends.unblock', userId });
  }

  invite(userId: string): Promise<NetResult> {
    return this.connection.request({ t: 'invite', userId });
  }

  report(userId: string, reason: ReportReason, note: string, attachMatch: boolean): Promise<NetResult> {
    return this.connection.request({ t: 'report', userId, reason, attachMatch, ...(note ? { note } : {}) });
  }

  // ------------------------------------------------------------ recepção

  #wire(): void {
    const c = this.connection;
    c.on('status', (s) => this.emit('status', s));
    c.on('rtt', (ms) => this.emit('rtt', ms));
    c.on('fatal', (reason) => this.emit('fatal', reason));
    c.on('welcome', (msg) => {
      this.#profile = msg.profile;
      this.emit('profile', msg.profile);
      if (!msg.resumed && this.#room) this.#closeRoom('expired');
      void this.refreshFriends();
    });
    c.on('profile', (msg) => {
      this.#profile = msg.profile;
      this.emit('profile', msg.profile);
    });
    c.on('room', (msg) => {
      this.#room = msg.room;
      this.emit('room', msg.room);
      // Partida nova (ou já em andamento, ao voltar para a página): avisa uma vez por partida.
      const inMatch = msg.room.state === 'placing' || msg.room.state === 'playing' || msg.room.state === 'finished';
      if (inMatch && msg.room.matchNumber !== this.#matchNumber) {
        this.#matchNumber = msg.room.matchNumber;
        if (this.storage.mutedEmotes) void c.request({ t: 'mute', muted: true });
        this.emit('matchStart', { room: msg.room, host: this.host });
      }
    });
    c.on('room.closed', (msg) => this.#closeRoom(msg.reason));
    c.on('friends', (msg) => {
      this.#friends = msg.list;
      this.emit('friends', msg.list);
    });
    c.on('presence', (msg) => {
      if (this.#friends) {
        this.#friends = {
          ...this.#friends,
          friends: this.#friends.friends.map((f) => (f.profile.userId === msg.userId ? { ...f, status: msg.status } : f)),
        };
      }
      this.emit('presence', { userId: msg.userId, status: msg.status });
    });
    c.on('friend.request', (msg) => {
      this.emit('friendRequest', msg.from);
      void this.refreshFriends();
    });
    c.on('invite', (msg) => this.emit('invite', { from: msg.from, code: msg.code }));
    c.on('emote', (msg) => this.emit('emote', msg));
    c.on('colour.adjusted', (msg) => this.emit('colourAdjusted', { wanted: msg.wanted, given: msg.given }));
    c.on('opponent', (msg) => this.emit('opponent', { connected: msg.connected, graceLeftMs: msg.graceLeftMs }));
    c.on('rematch', (msg) => this.emit('rematchOffer', msg.offeredBy));
    c.on('error', (msg) => {
      if (msg.ref === null) this.emit('error', msg);
    });
    c.on('daily', (msg) => this.emit('daily', { challenge: msg.challenge, board: msg.board, rank: msg.rank }));
    c.on('daily.result', (msg) => this.emit('dailyResult', { date: msg.date, entry: msg.entry, rank: msg.rank }));
    c.on('campaign', (msg) => {
      // O que veio da conta entra no aparelho também (o melhor de cada missão).
      if (msg.campaign) this.campaign.merge(msg.campaign.progress);
      this.emit('campaign', msg.campaign);
    });
    c.on('account.deleted', () => {
      this.#profile = null;
      this.#friends = null;
      this.emit('accountDeleted', null);
    });
  }

  #closeRoom(reason: SessionEvents['roomClosed']): void {
    this.#room = null;
    this.#matchNumber = 0;
    this.host.reset();
    this.emit('roomClosed', reason);
  }
}
