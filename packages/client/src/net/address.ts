import { roomCodeFromLink, roomLink, ROOM_LINK_KEY } from '@riverfront/protocol';

export const DEFAULT_PORT = 8787;
export const SERVER_QUERY_KEY = 'servidor';

/**
 * Normaliza o que o jogador digita no campo "Servidor" para uma URL de
 * WebSocket: aceita `192.168.0.10`, `192.168.0.10:8787`, `jogo.exemplo.com`,
 * `http(s)://...` e `ws(s)://...`. Devolve null se não fizer sentido.
 */
export function toServerUrl(input: string): string | null {
  let text = input.trim();
  if (!text) return null;
  if (!/^[a-z]+:\/\//i.test(text)) {
    // Sem esquema: endereço da rede local vai em ws, domínio público em wss.
    const host = text.split('/')[0] ?? '';
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|[^.]+$)/i.test(host) || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/.test(host);
    text = `${local ? 'ws' : 'wss'}://${text}`;
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return null;
  if (!url.port && url.protocol === 'ws:' && (/^localhost$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname))) url.port = String(DEFAULT_PORT);
  if (url.pathname === '/' || url.pathname === '') url.pathname = '/ws';
  url.hash = '';
  url.search = '';
  return url.toString();
}

interface LocationLike {
  readonly protocol: string;
  readonly host: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
}

function currentLocation(): LocationLike | null {
  const loc = (globalThis as { location?: LocationLike }).location;
  return loc ?? null;
}

// Ligado no build da demo estática (vite define); undefined no resto.
declare const __RIVERFRONT_STATIC__: boolean | undefined;
const STATIC_PAGE = typeof __RIVERFRONT_STATIC__ !== 'undefined' && __RIVERFRONT_STATIC__ === true;

/** Valor de `chave=valor` no hash (`#sala=K7Q2-PX&servidor=wss://...`). */
function hashParam(hash: string, key: string): string | null {
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === key) {
      try {
        return decodeURIComponent(part.slice(eq + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Servidor a usar quando o jogador ainda não escolheu nenhum:
 * 1. `?servidor=` ou `#servidor=` na URL (o app de desktop e os links de convite usam isso);
 * 2. o mesmo endereço da página, se o jogo foi aberto pelo próprio servidor (http/https).
 */
export function defaultServerUrl(loc: LocationLike | null = currentLocation()): string | null {
  if (!loc) return null;
  const fromQuery = new URLSearchParams(loc.search).get(SERVER_QUERY_KEY) ?? hashParam(loc.hash, SERVER_QUERY_KEY);
  if (fromQuery) return toServerUrl(fromQuery);
  // Demo estática (GitHub Pages): a página não tem servidor próprio.
  if (STATIC_PAGE) return null;
  if (loc.protocol === 'http:' || loc.protocol === 'https:') {
    // O servidor de desenvolvimento do Vite não fala WebSocket do jogo.
    if (/:5173$/.test(loc.host)) return null;
    return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
  }
  return null;
}

/** Código da sala no hash da página atual (`#sala=K7Q2-PX`), se houver. */
export function roomCodeFromLocation(loc: LocationLike | null = currentLocation()): string | null {
  if (!loc || !loc.hash.includes(`${ROOM_LINK_KEY}=`)) return null;
  return roomCodeFromLink(loc.hash);
}

/**
 * Link de convite. Quando o jogo roda no navegador a partir do servidor, é a
 * própria página; no app de desktop (página local) o link aponta para o
 * cliente web servido pelo servidor da partida.
 */
export function inviteLink(code: string, serverUrl: string | null, loc: LocationLike | null = currentLocation()): string {
  if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:') && !/:5173$/.test(loc.host)) {
    const page = loc.href.replace(/[?#].*$/, '');
    // Página e servidor em lugares diferentes (GitHub Pages + túnel): o link leva o servidor junto.
    const sameHost = serverUrl !== null && new URL(serverUrl).host === loc.host;
    if (serverUrl && !sameHost) return `${roomLink(page, code)}&${SERVER_QUERY_KEY}=${serverUrl}`;
    return roomLink(`${loc.protocol}//${loc.host}/`, code);
  }
  if (serverUrl) {
    const url = new URL(serverUrl);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '/';
    return roomLink(url.toString(), code);
  }
  return `#${ROOM_LINK_KEY}=${code}`;
}

interface MiniDocument {
  createElement(tag: 'textarea'): {
    value: string;
    style: { position: string; opacity: string };
    setAttribute(name: string, value: string): void;
    select(): void;
    remove(): void;
  };
  body: { appendChild(node: unknown): unknown };
  execCommand(command: string): boolean;
}

/** Copia texto para a área de transferência. Devolve false se o navegador não deixar. */
export async function copyText(text: string): Promise<boolean> {
  const nav = (globalThis as { navigator?: { clipboard?: { writeText(t: string): Promise<void> } } }).navigator;
  try {
    if (nav?.clipboard) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // cai no método antigo
  }
  const doc = (globalThis as { document?: MiniDocument }).document;
  if (!doc) return false;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
