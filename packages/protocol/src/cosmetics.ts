/** Emojis e provocações liberados. Só ids viajam pela rede; o texto fica no cliente. */

export const EMOJIS = ['ola', 'joinha', 'risada', 'susto', 'pensando', 'fogo', 'chorando', 'aplausos', 'gg'] as const;
export type EmojiId = (typeof EMOJIS)[number];

export const EMOJI_GLYPHS: Readonly<Record<EmojiId, string>> = {
  ola: '👋',
  joinha: '👍',
  risada: '😂',
  susto: '😱',
  pensando: '🤔',
  fogo: '🔥',
  chorando: '😭',
  aplausos: '👏',
  gg: '🤝',
};

export const TAUNTS = ['errou', 'minha-vez', 'so-sorte', 'vem-tranquilo', 'boa-jogada'] as const;
export type TauntId = (typeof TAUNTS)[number];

export const TAUNT_TEXT: Readonly<Record<TauntId, string>> = {
  errou: 'Errou de novo!',
  'minha-vez': 'Agora é a minha vez.',
  'so-sorte': 'Foi só sorte...',
  'vem-tranquilo': 'Vem tranquilo.',
  'boa-jogada': 'Boa jogada!',
};

export const EMBLEMS = ['ancora', 'estrela', 'raio', 'coroa', 'escudo', 'lobo', 'aguia', 'arvore', 'onda', 'montanha'] as const;
export type EmblemId = (typeof EMBLEMS)[number];

/** Bandeira: código ISO 3166-1 alfa-2 em maiúsculas, ou vazio para nenhuma. */
export const FLAG_PATTERN = /^(?:[A-Z]{2})?$/;

export function flagEmoji(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
