/**
 * Apelidos: 3 a 16 caracteres, letras (com acento), números, espaço, ponto,
 * hífen e sublinhado. O servidor acrescenta uma etiqueta de 4 dígitos, como
 * em `Nome#1234`, para dois jogadores poderem usar o mesmo apelido.
 */

export const NAME_MIN = 3;
export const NAME_MAX = 16;

const NAME_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N} ._-]*[\p{L}\p{N}])?$/u;
const TAG_PATTERN = /^(.{3,16})#(\d{4})$/u;

export type NameProblem = 'curto' | 'longo' | 'caracteres' | 'proibido';

export function normalizeName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Remove acentos e troca números/símbolos comuns por letras ("p0rr4" -> "porra"). */
export function foldForFilter(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0@4]/g, (c) => (c === '0' ? 'o' : 'a'))
    .replace(/1|!/g, 'i')
    .replace(/3/g, 'e')
    .replace(/5|\$/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z ]/g, '');
}

// Lista curta de propósito: pega o óbvio sem barrar nomes comuns.
// Palavras curtas só contam quando aparecem isoladas.
const BLOCKED_ANYWHERE = [
  'porra', 'caralh', 'merda', 'buceta', 'boceta', 'xoxota', 'cuzao', 'arrombad', 'vagabund', 'piranha',
  'filhadaputa', 'filhodaputa', 'putaria', 'punheta', 'viado', 'viadinho', 'sapatao', 'macaco', 'retardad',
  'fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'whore', 'slut', 'asshole', 'pussy',
  'retard', 'rapist', 'hitler', 'nazi',
];
const BLOCKED_WORDS = ['puta', 'puto', 'cu', 'pau', 'rola', 'fdp', 'vsf', 'pqp', 'tnc', 'cuck', 'dick', 'cock', 'fag', 'admin', 'moderador', 'suporte'];

function squash(w: string): string {
  let out = '';
  for (const ch of w) if (ch !== out[out.length - 1]) out += ch;
  return out;
}
const ANYWHERE = BLOCKED_ANYWHERE.map(squash);
const WORDS = BLOCKED_WORDS.map(squash);

export function hasProfanity(text: string): boolean {
  const folded = squash(foldForFilter(text));
  const joined = folded.replace(/ /g, '');
  if (ANYWHERE.some((w) => joined.includes(w))) return true;
  const words = folded.split(' ').filter(Boolean);
  return words.some((w) => WORDS.includes(w));
}

export function checkName(raw: string): { ok: true; name: string } | { ok: false; problem: NameProblem } {
  const name = normalizeName(raw);
  if ([...name].length < NAME_MIN) return { ok: false, problem: 'curto' };
  if ([...name].length > NAME_MAX) return { ok: false, problem: 'longo' };
  if (!NAME_PATTERN.test(name)) return { ok: false, problem: 'caracteres' };
  if (hasProfanity(name)) return { ok: false, problem: 'proibido' };
  return { ok: true, name };
}

export const NAME_PROBLEM_TEXT: Readonly<Record<NameProblem, string>> = {
  curto: `O apelido precisa de pelo menos ${NAME_MIN} caracteres.`,
  longo: `O apelido pode ter no máximo ${NAME_MAX} caracteres.`,
  caracteres: 'Use só letras, números, espaço, ponto, hífen ou sublinhado.',
  proibido: 'Esse apelido não é permitido. Escolha outro.',
};

export function formatTag(name: string, tag: string): string {
  return `${name}#${tag}`;
}

export function parseTag(text: string): { name: string; tag: string } | null {
  const match = TAG_PATTERN.exec(normalizeName(text));
  if (!match) return null;
  return { name: match[1] as string, tag: match[2] as string };
}
