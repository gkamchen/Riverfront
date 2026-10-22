import type { ClockPresetId } from '@riverfront/core';

/** Maior mensagem aceita do cliente (bytes). As do servidor podem ser maiores (estado da partida). */
export const MAX_CLIENT_MESSAGE_BYTES = 8 * 1024;
/** Limite para as mensagens com log de partida (desafio diário, campanha). */
export const MAX_LOG_MESSAGE_BYTES = 256 * 1024;
export const MAX_SERVER_MESSAGE_BYTES = 512 * 1024;

export const ROOM_EXPIRY_MS = 10 * 60_000;

/** Tempo para posicionar as peças, por preset de relógio (null = sem limite). */
export const PLACEMENT_MS: Readonly<Record<ClockPresetId, number | null>> = {
  relampago: 60_000,
  padrao: 120_000,
  tranquilo: 240_000,
  unlimited: null,
};

export const CLOCK_IDS: readonly ClockPresetId[] = ['relampago', 'padrao', 'tranquilo', 'unlimited'];

export const CLOCK_LABELS: Readonly<Record<ClockPresetId, string>> = {
  relampago: 'Relâmpago (10 s)',
  padrao: 'Padrão (30 s)',
  tranquilo: 'Tranquilo (60 s)',
  unlimited: 'Sem limite',
};

export const FRIENDS = {
  maxFriends: 200,
  maxPending: 20,
  requestsPerHour: 10,
  requestTtlMs: 30 * 24 * 60 * 60_000,
} as const;

export const EMOTE = {
  emojiCooldownMs: 2_000,
  emojiWindowMs: 10_000,
  emojiPerWindow: 3,
  tauntCooldownMs: 15_000,
} as const;

export const GRACE = {
  dropMs: 45_000,
  totalMs: 90_000,
} as const;
