import type { AbilityRequest, ClockConfig, ClockPresetId, Coord, FactionId, Placement, SeatId, SpecialShotRequest } from '@riverfront/core';
import type { EmoteAudience, EmoteKind, ErrorCode, PublicProfile, RoomFormat, RoomInfo, RoomState, ServerMessage } from '@riverfront/protocol';
import type { StoredMatch } from './store/types.ts';

export interface RoomSettings {
  readonly expiryMs: number;
  readonly placementMs: Readonly<Record<ClockPresetId, number | null>>;
  readonly clocks: Partial<Record<ClockPresetId, ClockConfig>>;
  /** Quanto um lugar desconectado fica reservado fora da fase de jogo. */
  readonly lobbyGraceMs: number;
  /** Quanto uma sala encerrada espera por revanche antes de fechar. */
  readonly finishedTtlMs: number;
  /** Semente das partidas (só para testes reproduzíveis). */
  readonly seed?: () => number;
}

/** O que a sala precisa do servidor. */
export interface RoomHub {
  now(): number;
  send(userId: string, msg: ServerMessage): void;
  /** Um dos dois bloqueou o outro. */
  blocked(a: string, b: string): boolean;
  matchEnded(room: GameRoom, stored: StoredMatch): void;
  /** O jogador saiu da sala (por vontade própria ou por sumir tempo demais). */
  left(room: GameRoom, userId: string): void;
  stateChanged(room: GameRoom): void;
  closed(room: GameRoom): void;
}

export type RoomResult = { ok: true } | { ok: false; code: ErrorCode; detail?: string };

/** O que o servidor usa de uma sala, seja 1×1 (`Room`) ou duplas (`TeamRoom`). */
export interface GameRoom {
  readonly code: string;
  readonly format: RoomFormat;
  readonly state: RoomState;
  readonly closed: boolean;
  readonly players: string[];
  readonly emoteLog: { from: string; emote: string; at: number }[];
  seatOf(userId: string): string | null;
  infoFor(userId: string): RoomInfo | null;
  recordFor(): StoredMatch | null;
  join(profile: PublicProfile): RoomResult;
  leave(userId: string): void;
  updateProfile(profile: PublicProfile): void;
  connect(userId: string): void;
  disconnect(userId: string): void;
  chooseSeat(userId: string, seat: SeatId): RoomResult;
  setReady(userId: string, ready: boolean): RoomResult;
  setFaction(userId: string, faction: FactionId): RoomResult;
  setMuted(userId: string, muted: boolean, who: 'opponents' | 'partner'): RoomResult;
  rematch(userId: string, accept: boolean): RoomResult;
  submitPlacement(userId: string, placements: readonly Placement[], confirm: boolean): RoomResult;
  autoPlace(userId: string): RoomResult;
  attack(userId: string, target: Coord): RoomResult;
  ability(userId: string, request: AbilityRequest): RoomResult;
  special(userId: string, request: SpecialShotRequest): RoomResult;
  surrender(userId: string): RoomResult;
  emote(userId: string, kind: EmoteKind, emote: string, to: EmoteAudience): RoomResult;
  sendState(userId: string): void;
  tick(): void;
  close(reason: 'expired' | 'shutdown' | 'deleted' | null): void;
}
