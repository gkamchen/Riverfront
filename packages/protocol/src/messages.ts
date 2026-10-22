import type {
  AbilityId,
  AbilityOutcome,
  AbilityRequest,
  AttackOutcome,
  CampaignProgress,
  ClockPresetId,
  Coord,
  DailyChallenge,
  DailyEntry,
  FactionId,
  LogEntry,
  MutatorId,
  Placement,
  PlayerId,
  PresetId,
  SeatId,
  ShotReport,
  SpecialOutcome,
  SpecialShotRequest,
  WinReason,
} from '@riverfront/core';
import type { EmojiId, TauntId } from './cosmetics.ts';
import type { PackedView } from './view-codec.ts';
import type { ErrorCode } from './errors.ts';

/** Time no 1×1 (quem cria a sala fica com 'blue'). */
export type Seat = PlayerId;

/** Lugar numa sala: o time no 1×1 ou o lugar ('blue-1', 'red-2'...) nas duplas. */
export type RoomSeat = PlayerId | SeatId;

/** 1 contra 1 ou duplas (2 contra 2). */
export type RoomFormat = 'duel' | 'doubles';

/** Modo de jogo: um preset do core (classic/full, os apelidos em português e os modos rápidos 15×5). */
export type GameMode = PresetId;

export interface FieldSize {
  readonly cols: number;
  readonly rows: number;
}

export interface Auth {
  readonly userId: string;
  readonly token: string;
}

export interface ProfilePatch {
  readonly name?: string;
  readonly colour?: string;
  readonly flag?: string;
  readonly emblem?: string;
}

export type ReportReason = 'nome' | 'provocacao' | 'trapaca' | 'abandono' | 'outro';

export type EmoteKind = 'emoji' | 'taunt';

/** Destino de um emote nas duplas: só o parceiro ou a mesa toda. */
export type EmoteAudience = 'all' | 'team';

// ------------------------------------------------------------------ cliente -> servidor

/**
 * Toda mensagem do cliente pode levar `id`; a resposta (`ok` ou `error`) volta
 * com `ref` igual a ele. `hello` com `auth` também serve para reconectar.
 */
export type ClientMessage = { readonly id?: number } & (
  | {
      readonly t: 'hello';
      readonly protocol: { readonly min: number; readonly max: number };
      readonly client: { readonly name: string; readonly version: string };
      readonly auth?: Auth;
      /** Apelido sugerido para contas novas. */
      readonly name?: string;
    }
  | ({ readonly t: 'profile.update' } & ProfilePatch)
  | {
      readonly t: 'room.create';
      readonly clock: ClockPresetId;
      readonly mode: GameMode;
      readonly mutators?: readonly MutatorId[];
      readonly size?: FieldSize;
      /** Padrão 'duel'. */
      readonly format?: RoomFormat;
    }
  | { readonly t: 'room.join'; readonly code: string }
  | { readonly t: 'room.leave' }
  /** Duplas: troca para um lugar livre (antes de marcar pronto). */
  | { readonly t: 'seat.choose'; readonly seat: SeatId }
  | { readonly t: 'ready'; readonly ready: boolean }
  /** Facção para a próxima partida (antes do "pronto" ou entre revanches). Nas duplas vale para o time. */
  | { readonly t: 'faction'; readonly faction: FactionId }
  | { readonly t: 'placement.submit'; readonly placements: readonly Placement[]; readonly confirm: boolean }
  | { readonly t: 'placement.auto' }
  | { readonly t: 'attack'; readonly target: Coord }
  | { readonly t: 'ability'; readonly request: AbilityRequest }
  /** Tiro especial da facção. */
  | { readonly t: 'special'; readonly request: SpecialShotRequest }
  | { readonly t: 'surrender' }
  | { readonly t: 'emote'; readonly kind: 'emoji'; readonly emote: EmojiId; readonly to?: EmoteAudience }
  | { readonly t: 'emote'; readonly kind: 'taunt'; readonly emote: TauntId; readonly to?: EmoteAudience }
  /** Silencia os adversários (padrão) ou, nas duplas, o parceiro. */
  | { readonly t: 'mute'; readonly muted: boolean; readonly who?: 'opponents' | 'partner' }
  | { readonly t: 'ping'; readonly ts: number }
  | { readonly t: 'sync' }
  | { readonly t: 'rematch'; readonly accept: boolean }
  | { readonly t: 'friends.list' }
  | { readonly t: 'friends.request'; readonly tag: string }
  | { readonly t: 'friends.accept'; readonly userId: string }
  | { readonly t: 'friends.decline'; readonly userId: string }
  | { readonly t: 'friends.remove'; readonly userId: string }
  | { readonly t: 'friends.block'; readonly userId: string }
  | { readonly t: 'friends.unblock'; readonly userId: string }
  | { readonly t: 'invite'; readonly userId: string }
  | { readonly t: 'report'; readonly userId: string; readonly reason: ReportReason; readonly note?: string; readonly attachMatch: boolean }
  | { readonly t: 'account.delete'; readonly confirm: 'EXCLUIR' }
  /** Desafio do dia (UTC). Sem `date`, o de hoje. */
  | { readonly t: 'daily.get'; readonly date?: string }
  /** Resultado do desafio: o log da partida local, que o servidor reproduz e confere. */
  | { readonly t: 'daily.submit'; readonly date: string; readonly log: readonly LogEntry[] }
  /** Campanha: progresso guardado na conta (opcional; o padrão é só no aparelho). */
  | { readonly t: 'campaign.get' }
  | { readonly t: 'campaign.sync'; readonly progress: CampaignProgress }
  /** Uma missão jogada, com o log para conferência: a única forma de o servidor marcar como "verificada". */
  | { readonly t: 'campaign.result'; readonly mission: string; readonly log: readonly LogEntry[] }
);

export type ClientMessageType = ClientMessage['t'];

// ------------------------------------------------------------------ servidor -> cliente

export interface PublicProfile {
  readonly userId: string;
  readonly name: string;
  readonly tag: string;
  readonly colour: string;
  readonly flag: string;
  readonly emblem: string;
}

export type RoomState = 'waiting' | 'lobby' | 'placing' | 'playing' | 'finished';

export interface RoomPlayer {
  readonly seat: RoomSeat;
  readonly profile: PublicProfile;
  /** Cor usada nesta sala (pode diferir da do perfil quando houve conflito). */
  readonly colour: string;
  /** Facção do jogador (no 1×1) ou do time dele (nas duplas). */
  readonly faction: FactionId;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly wantsRematch: boolean;
}

export interface RoomInfo {
  readonly code: string;
  readonly format: RoomFormat;
  readonly state: RoomState;
  readonly mode: GameMode;
  readonly clock: ClockPresetId;
  readonly mutators: readonly MutatorId[];
  /** Tamanho do campo quando difere do padrão do modo. */
  readonly size: FieldSize | null;
  /** Seu lugar: 'blue'/'red' no 1×1, 'blue-1'... nas duplas. */
  readonly you: RoomSeat;
  readonly players: readonly RoomPlayer[];
  /** Quando a sala expira se ninguém entrar (null depois que a partida começa). */
  readonly expiresAt: number | null;
  readonly placementDeadline: number | null;
  /** Conta as revanches: 1 na primeira partida. */
  readonly matchNumber: number;
  /** Time que começa. */
  readonly firstTurn: Seat;
}

export type MatchEvent =
  | { readonly kind: 'start' }
  | { readonly kind: 'confirmed'; readonly by: Seat; readonly seat?: SeatId }
  | { readonly kind: 'shot'; readonly outcome: AttackOutcome; readonly seat?: SeatId }
  | {
      readonly kind: 'ability';
      readonly by: Seat;
      readonly seat?: SeatId;
      readonly ability: AbilityId;
      /** Só o time de quem usou recebe o resultado (o bombardeio é público). */
      readonly outcome: AbilityOutcome | null;
    }
  | {
      readonly kind: 'special';
      readonly by: Seat;
      readonly seat?: SeatId;
      readonly special: string;
      /** A sonda é privada: o time adversário recebe null. Os outros tiros especiais são públicos. */
      readonly outcome: SpecialOutcome | null;
    }
  /** Torre automática disparou no início do turno do dono (público para os dois lados). */
  | { readonly kind: 'tower'; readonly by: Seat; readonly report: ShotReport }
  /** A maré subiu (`submerged: true`) ou baixou. */
  | { readonly kind: 'tide'; readonly submerged: boolean }
  | { readonly kind: 'timeout'; readonly player: Seat; readonly seat?: SeatId; readonly forfeit: boolean; readonly strikes: number }
  | { readonly kind: 'end'; readonly winner: Seat; readonly reason: WinReason };

export type PresenceStatus = 'online' | 'in-match' | 'offline';

export interface FriendEntry {
  readonly profile: PublicProfile;
  readonly status: PresenceStatus;
}

export interface FriendsList {
  readonly friends: readonly FriendEntry[];
  readonly incoming: readonly { readonly profile: PublicProfile; readonly at: number }[];
  readonly outgoing: readonly { readonly profile: PublicProfile; readonly at: number }[];
  readonly blocked: readonly PublicProfile[];
}

export interface ServerLimits {
  readonly maxMessageBytes: number;
  readonly emojiCooldownMs: number;
  readonly tauntCooldownMs: number;
}

/** Progresso da campanha guardado na conta, com as missões conferidas por replay. */
export interface StoredCampaign {
  readonly progress: CampaignProgress;
  readonly verified: readonly string[];
  readonly updatedAt: number;
}

export type ServerMessage =
  | {
      readonly t: 'welcome';
      readonly protocol: number;
      readonly userId: string;
      /** Só vem quando a conta acabou de ser criada: guarde-o, ele não é enviado de novo. */
      readonly token: string | null;
      readonly profile: PublicProfile;
      readonly serverTime: number;
      /** Havia uma sala ativa e a conexão voltou para ela. */
      readonly resumed: boolean;
      readonly limits: ServerLimits;
    }
  | { readonly t: 'ok'; readonly ref: number }
  | { readonly t: 'error'; readonly ref: number | null; readonly code: ErrorCode; readonly detail: string | null; readonly message: string }
  | { readonly t: 'profile'; readonly profile: PublicProfile }
  | { readonly t: 'room'; readonly room: RoomInfo }
  | { readonly t: 'room.closed'; readonly reason: 'expired' | 'left' | 'opponent-left' | 'shutdown' | 'deleted' }
  | { readonly t: 'match.state'; readonly view: PackedView; readonly serverTime: number }
  | { readonly t: 'match.event'; readonly event: MatchEvent; readonly view: PackedView; readonly serverTime: number }
  | { readonly t: 'colour.adjusted'; readonly wanted: string; readonly given: string }
  /** Alguém da mesa caiu ou voltou. Nas duplas, `seat` diz quem (pode ser o parceiro). */
  | { readonly t: 'opponent'; readonly connected: boolean; readonly graceLeftMs: number | null; readonly seat?: SeatId }
  | { readonly t: 'emote'; readonly from: RoomSeat; readonly kind: EmoteKind; readonly emote: string; readonly to?: EmoteAudience }
  | { readonly t: 'pong'; readonly ts: number; readonly serverTime: number }
  | { readonly t: 'friends'; readonly list: FriendsList }
  | { readonly t: 'friend.request'; readonly from: PublicProfile }
  | { readonly t: 'presence'; readonly userId: string; readonly status: PresenceStatus }
  | { readonly t: 'invite'; readonly from: PublicProfile; readonly code: string }
  | { readonly t: 'rematch'; readonly offeredBy: RoomSeat }
  | { readonly t: 'account.deleted' }
  | { readonly t: 'server.shutdown'; readonly retryInMs: number }
  | {
      readonly t: 'daily';
      readonly challenge: DailyChallenge;
      /** Melhores do dia (até 100), por "Nome#1234". */
      readonly board: readonly DailyEntry[];
      /** Sua posição no dia, se já enviou. */
      readonly rank: number | null;
    }
  | { readonly t: 'daily.result'; readonly date: string; readonly entry: DailyEntry; readonly rank: number | null }
  | { readonly t: 'campaign'; readonly campaign: StoredCampaign | null };

export type ServerMessageType = ServerMessage['t'];
