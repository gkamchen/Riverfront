// Desenha o ícone do Riverfront em código (sem arquivos de imagem) e grava
// PNG/ICO em packages/desktop/build. Uso: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'packages', 'desktop', 'build');

// ------------------------------------------------------------ cores e formas

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

const WOOD_TOP = hex('#7a5431');
const WOOD_BOTTOM = hex('#3d2a17');
const FIELD_TOP = hex('#9a7a48');
const FIELD_BOTTOM = hex('#7d5f37');
const RIVER_LIGHT = hex('#3d93db');
const RIVER_DARK = hex('#1b5591');
const GOLD = hex('#e8c47a');
const RED = hex('#d2453b');

function roundedRect(u, v, x0, y0, x1, y1, r) {
  const cx = Math.max(x0 + r, Math.min(u, x1 - r));
  const cy = Math.max(y0 + r, Math.min(v, y1 - r));
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r;
}

const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1;

/** Torre com ameias entre `a` (topo) e `b` (base), centrada em u = 0.5. */
function tower(u, t, a, b) {
  const h = b - a;
  const body = inRect(u, t, 0.4, a + h * 0.22, 0.6, b);
  const merlons = [0.38, 0.465, 0.55].some((x) => inRect(u, t, x, a, x + 0.07, a + h * 0.24));
  const ledge = inRect(u, t, 0.37, a + h * 0.2, 0.63, a + h * 0.3);
  if (!body && !merlons && !ledge) return null;
  // porta em arco
  const doorTop = b - h * 0.36;
  const door = inRect(u, t, 0.465, doorTop + 0.035, 0.535, b) || (u - 0.5) ** 2 + (t - (doorTop + 0.035)) ** 2 <= 0.035 ** 2;
  if (door) return 'door';
  // luz vinda da esquerda
  return u < 0.5 ? 'lit' : 'shadow';
}

function colourAt(u, v) {
  if (!roundedRect(u, v, 0, 0, 1, 1, 0.2)) return null;
  // moldura de madeira com veios
  const grain = 1 + 0.05 * Math.sin(v * 90 + Math.sin(u * 7) * 3);
  let c = shade(mix(WOOD_TOP, WOOD_BOTTOM, v), grain);
  if (!roundedRect(u, v, 0.08, 0.08, 0.92, 0.92, 0.13)) return c;

  // campos e rio
  const riverCenter = 0.5 + 0.035 * Math.sin(u * Math.PI * 3);
  const d = v - riverCenter;
  if (Math.abs(d) < 0.085) {
    const depth = 1 - Math.abs(d) / 0.085;
    c = mix(RIVER_DARK, RIVER_LIGHT, depth * 0.8);
    const ripple = Math.sin(u * 60 + v * 20);
    if (ripple > 0.97) c = mix(c, [255, 255, 255], 0.35);
    return c;
  }
  c = v < riverCenter ? FIELD_TOP : FIELD_BOTTOM;
  // grade do tabuleiro, bem leve
  const gu = (u * 10) % 1;
  const gv = (v * 10) % 1;
  if (gu < 0.04 || gv < 0.04) c = shade(c, 0.9);
  // margem escura junto da água
  if (Math.abs(d) < 0.105) c = shade(c, 0.75);

  const top = tower(u, v, 0.13, 0.37);
  if (top) return top === 'door' ? hex('#3a2a18') : shade(GOLD, top === 'lit' ? 1.05 : 0.82);
  const bottom = tower(u, v, 0.63, 0.87);
  if (bottom) return bottom === 'door' ? hex('#3a1b14') : shade(RED, bottom === 'lit' ? 1.05 : 0.8);
  return c;
}

/** Renderiza com supersampling (4×4 por pixel). */
function render(size) {
  const ss = 4;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = colourAt((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        data[i] = Math.min(255, Math.round(r / a));
        data[i + 1] = Math.min(255, Math.round(g / a));
        data[i + 2] = Math.min(255, Math.round(b / a));
      }
      data[i + 3] = Math.round((a / (ss * ss)) * 255);
    }
  }
  return data;
}

// ------------------------------------------------------------ PNG e ICO

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

// ------------------------------------------------------------ saída

mkdirSync(join(outDir, 'icons'), { recursive: true });
const pngs = new Map();
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) pngs.set(size, png(size, render(size)));

writeFileSync(join(outDir, 'icon.png'), pngs.get(1024));
writeFileSync(join(outDir, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, data: pngs.get(size) }))));
for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) writeFileSync(join(outDir, 'icons', `${size}x${size}.png`), pngs.get(size));

console.log(`ícones gravados em ${outDir}`);
