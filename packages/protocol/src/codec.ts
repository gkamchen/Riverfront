import { MAX_CLIENT_MESSAGE_BYTES, MAX_LOG_MESSAGE_BYTES } from './limits.ts';
import type { ClientMessage, ServerMessage } from './messages.ts';
import { clientMessage } from './schemas.ts';

/** Versões de protocolo que este pacote fala. Suba MAX ao mudar mensagens de forma incompatível. */
export const PROTOCOL_MIN = 1;
export const PROTOCOL_MAX = 1;
export const PROTOCOL_VERSION = PROTOCOL_MAX;

export type DecodeResult<T> =
  | { readonly ok: true; readonly msg: T }
  | { readonly ok: false; readonly code: 'too-large' | 'bad-message'; readonly reason: string; readonly ref: number | null };

function byteLength(text: string): number {
  // Conta UTF-8 sem depender de Buffer/TextEncoder (roda igual no Node e no navegador).
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/** Mensagens que levam o log de uma partida local: podem passar do limite comum. */
const LOG_TYPES = new Set(['daily.submit', 'campaign.result']);

export function decodeClientMessage(raw: string, maxBytes = MAX_CLIENT_MESSAGE_BYTES, maxLogBytes = MAX_LOG_MESSAGE_BYTES): DecodeResult<ClientMessage> {
  const ceiling = Math.max(maxBytes, maxLogBytes);
  if (raw.length > ceiling) return { ok: false, code: 'too-large', reason: 'tamanho', ref: null };
  const bytes = byteLength(raw);
  if (bytes > ceiling) return { ok: false, code: 'too-large', reason: 'tamanho', ref: null };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad-message', reason: 'JSON inválido', ref: null };
  }
  const type = typeof data === 'object' && data !== null ? (data as { t?: unknown }).t : undefined;
  if (bytes > maxBytes && !(typeof type === 'string' && LOG_TYPES.has(type))) return { ok: false, code: 'too-large', reason: 'tamanho', ref: null };
  const ref = typeof data === 'object' && data !== null && Number.isInteger((data as { id?: unknown }).id) ? ((data as { id: number }).id) : null;
  const result = clientMessage(data);
  if (!result.ok) return { ok: false, code: 'bad-message', reason: `${result.path}: ${result.reason}`, ref };
  return { ok: true, msg: result.value };
}

const SERVER_TYPES = new Set<string>([
  'welcome', 'ok', 'error', 'profile', 'room', 'room.closed', 'match.state', 'match.event', 'colour.adjusted', 'opponent',
  'emote', 'pong', 'friends', 'friend.request', 'presence', 'invite', 'rematch', 'account.deleted', 'server.shutdown',
  'daily', 'daily.result', 'campaign',
]);

/**
 * O cliente confia no servidor quanto ao conteúdo, mas descarta o que não
 * reconhece (servidor mais novo mandando tipos que esta versão não conhece).
 */
export function decodeServerMessage(raw: string): ServerMessage | null {
  try {
    const data = JSON.parse(raw) as { t?: unknown };
    if (typeof data !== 'object' || data === null || typeof data.t !== 'string' || !SERVER_TYPES.has(data.t)) return null;
    return data as ServerMessage;
  } catch {
    return null;
  }
}

/** Escolhe a maior versão comum, ou null se os intervalos não se cruzam. */
export function negotiateVersion(client: { min: number; max: number }, server = { min: PROTOCOL_MIN, max: PROTOCOL_MAX }): number | null {
  const high = Math.min(client.max, server.max);
  const low = Math.max(client.min, server.min);
  return high >= low ? high : null;
}
