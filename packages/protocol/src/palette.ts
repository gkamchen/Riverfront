/**
 * Cores de time. O servidor só aceita ids desta lista e garante que os dois
 * jogadores da sala fiquem com cores bem diferentes (distância CIEDE2000).
 * O par `daltonico-*` vem da paleta Okabe-Ito e continua distinguível para
 * quem tem deuteranopia ou protanopia.
 */

export interface TeamColour {
  readonly id: string;
  readonly name: string;
  readonly hex: string;
  /** Faz parte do par seguro para daltonismo. */
  readonly colourBlindSafe: boolean;
}

export const TEAM_COLOURS: readonly TeamColour[] = [
  { id: 'azul', name: 'Azul', hex: '#2f6fde', colourBlindSafe: false },
  { id: 'vermelho', name: 'Vermelho', hex: '#d63a3a', colourBlindSafe: false },
  { id: 'verde', name: 'Verde', hex: '#2e9e4f', colourBlindSafe: false },
  { id: 'amarelo', name: 'Amarelo', hex: '#e8c12e', colourBlindSafe: false },
  { id: 'roxo', name: 'Roxo', hex: '#7b4bc4', colourBlindSafe: false },
  { id: 'laranja', name: 'Laranja', hex: '#ee7a1a', colourBlindSafe: false },
  { id: 'ciano', name: 'Ciano', hex: '#1fb5c9', colourBlindSafe: false },
  { id: 'rosa', name: 'Rosa', hex: '#e0559a', colourBlindSafe: false },
  { id: 'grafite', name: 'Grafite', hex: '#4a4f57', colourBlindSafe: false },
  { id: 'marfim', name: 'Marfim', hex: '#e9e6dd', colourBlindSafe: false },
  { id: 'daltonico-azul', name: 'Azul (daltonismo)', hex: '#0072b2', colourBlindSafe: true },
  { id: 'daltonico-laranja', name: 'Laranja (daltonismo)', hex: '#e69f00', colourBlindSafe: true },
];

export const COLOUR_IDS: readonly string[] = TEAM_COLOURS.map((c) => c.id);

/** Distância mínima (ΔE2000) entre as cores dos dois jogadores de uma sala. */
export const MIN_COLOUR_DISTANCE = 20;

export const DEFAULT_COLOURS: readonly [string, string] = ['azul', 'vermelho'];

export function colourById(id: string): TeamColour | undefined {
  return TEAM_COLOURS.find((c) => c.id === id);
}

export function isColourId(value: unknown): value is string {
  return typeof value === 'string' && COLOUR_IDS.includes(value);
}

interface Lab {
  readonly l: number;
  readonly a: number;
  readonly b: number;
}

function hexToLab(hex: string): Lab {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const bl = channel(n & 255);
  // sRGB -> XYZ (D65), normalizado pelo branco de referência
  const x = (r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + bl * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** ΔE CIEDE2000 entre duas cores hex (#rrggbb). */
export function deltaE(hexA: string, hexB: string): number {
  const p = hexToLab(hexA);
  const q = hexToLab(hexB);
  const c1 = Math.hypot(p.a, p.b);
  const c2 = Math.hypot(q.a, q.b);
  const cBar = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1 = p.a * (1 + g);
  const a2 = q.a * (1 + g);
  const cp1 = Math.hypot(a1, p.b);
  const cp2 = Math.hypot(a2, q.b);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h < 0 ? h + 360 : h;
  };
  const h1 = hue(p.b, a1);
  const h2 = hue(q.b, a2);
  const dL = q.l - p.l;
  const dC = cp2 - cp1;
  let dh = 0;
  if (cp1 * cp2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin(rad(dh / 2));
  const lBar = (p.l + q.l) / 2;
  const cpBar = (cp1 + cp2) / 2;
  let hBar = h1 + h2;
  if (cp1 * cp2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) hBar = (h1 + h2) / 2;
    else hBar = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos(rad(hBar - 30)) +
    0.24 * Math.cos(rad(2 * hBar)) +
    0.32 * Math.cos(rad(3 * hBar + 6)) -
    0.2 * Math.cos(rad(4 * hBar - 63));
  const dTheta = 30 * Math.exp(-(((hBar - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cpBar ** 7 / (cpBar ** 7 + 25 ** 7));
  const sl = 1 + (0.015 * (lBar - 50) ** 2) / Math.sqrt(20 + (lBar - 50) ** 2);
  const sc = 1 + 0.045 * cpBar;
  const sh = 1 + 0.015 * cpBar * t;
  const rt = -Math.sin(rad(2 * dTheta)) * rc;
  return Math.sqrt((dL / sl) ** 2 + (dC / sc) ** 2 + (dH / sh) ** 2 + rt * (dC / sc) * (dH / sh));
}

export function colourDistance(idA: string, idB: string): number {
  const a = colourById(idA);
  const b = colourById(idB);
  if (!a || !b) return 0;
  return deltaE(a.hex, b.hex);
}

export function coloursClash(idA: string, idB: string, min = MIN_COLOUR_DISTANCE): boolean {
  return colourDistance(idA, idB) < min;
}

/**
 * Cor livre mais parecida com a desejada, longe o bastante de todas as cores
 * já tomadas. Devolve a própria cor quando ela não conflita.
 */
export function nearestFreeColour(wanted: string, taken: readonly string[], min = MIN_COLOUR_DISTANCE): string {
  const clashes = (id: string) => taken.some((other) => coloursClash(id, other, min));
  if (isColourId(wanted) && !clashes(wanted)) return wanted;
  const base = isColourId(wanted) ? wanted : DEFAULT_COLOURS[0];
  const candidates = TEAM_COLOURS.filter((c) => !clashes(c.id)).sort((x, y) => colourDistance(base, x.id) - colourDistance(base, y.id));
  return candidates[0]?.id ?? DEFAULT_COLOURS[1];
}
