/**
 * Códigos de sala no formato `K7Q2-PX`: 6 símbolos de um alfabeto sem 0/O e
 * 1/I, para ninguém confundir ao ditar o código por voz.
 */

export const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_PATTERN = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{2}$/;
export const ROOM_LINK_KEY = 'sala';

/** `randomInt(n)` deve devolver um inteiro uniforme em [0, n). */
export function generateRoomCode(randomInt: (n: number) => number): string {
  let raw = '';
  for (let i = 0; i < 6; i++) raw += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

/** Aceita minúsculas, espaços e o código sem hífen. Devolve null se não for um código. */
export function normalizeRoomCode(text: string): string | null {
  const raw = text.toUpperCase().replace(/[\s-]/g, '');
  if (raw.length !== 6) return null;
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}

/** Monta o link de convite. `base` é a URL do cliente (sem hash). */
export function roomLink(base: string, code: string): string {
  const clean = base.replace(/#.*$/, '');
  return `${clean}#${ROOM_LINK_KEY}=${code}`;
}

/** Lê o código de um hash (`#sala=K7Q2-PX`) ou de uma URL completa. */
export function roomCodeFromLink(text: string): string | null {
  const hashIndex = text.indexOf('#');
  const hash = hashIndex >= 0 ? text.slice(hashIndex + 1) : text;
  for (const part of hash.split('&')) {
    const [key, value] = part.split('=');
    if (key === ROOM_LINK_KEY && value) return normalizeRoomCode(decodeURIComponent(value));
  }
  return normalizeRoomCode(text);
}
