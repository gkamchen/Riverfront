import { CanvasTexture, NoColorSpace, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { fbm, valueNoise } from './noise';

export type Rgb = readonly [number, number, number];

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, color: boolean): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = color ? SRGBColorSpace : NoColorSpace;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export interface WoodTextures {
  map: Texture;
  roughness: Texture;
}

/**
 * Lacquered wood for the board frame. The four frame pieces are mitred: on
 * the left/right pieces the grain turns 90° so it always runs along the piece.
 */
export function createFrameWood(worldWidth: number, worldDepth: number, pxPerUnit = 40): WoodTextures {
  const width = Math.round(worldWidth * pxPerUnit);
  const height = Math.round(worldDepth * pxPerUnit);
  const [colorCanvas, colorCtx] = makeCanvas(width, height);
  const [roughCanvas, roughCtx] = makeCanvas(width, height);
  const color = colorCtx.createImageData(width, height);
  const rough = roughCtx.createImageData(width, height);

  const early: Rgb = [150, 86, 46];
  const late: Rgb = [74, 36, 18];

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const wx = (px / width) * worldWidth;
      const wy = (py / height) * worldDepth;
      const horizontalEdge = Math.min(wx, worldWidth - wx);
      const verticalEdge = Math.min(wy, worldDepth - wy);
      const sidePiece = horizontalEdge < verticalEdge;
      const along = sidePiece ? wy : wx;
      const across = sidePiece ? wx : wy;
      const seed = sidePiece ? (wx < worldWidth / 2 ? 11 : 23) : wy < worldDepth / 2 ? 37 : 51;

      const warp = fbm(along * 0.12, across * 0.7, 3, seed) * 2.6;
      const rings = across * 2.4 + warp + Math.sin(along * 0.21 + seed) * 0.35;
      const ring = rings - Math.floor(rings);
      const band = smoothstep(0.55, 0.95, ring) * 0.85 + smoothstep(0.0, 0.25, ring) * 0.15;
      const fiber = valueNoise(along * 3.0, across * 55, seed + 3) - 0.5;
      const pores = valueNoise(along * 18, across * 90, seed + 9) > 0.86 ? 0.12 : 0;

      // A thin dark seam where two mitred pieces meet.
      const seam = Math.abs(horizontalEdge - verticalEdge) < 0.035 ? 0.55 : 0;

      const base = mixRgb(early, late, Math.min(1, band + pores + seam));
      const shade = 1 + fiber * 0.22;
      const i = (py * width + px) * 4;
      color.data[i] = base[0] * shade;
      color.data[i + 1] = base[1] * shade;
      color.data[i + 2] = base[2] * shade;
      color.data[i + 3] = 255;

      const r = 70 + band * 70 + fiber * 30 + seam * 80;
      rough.data[i] = r;
      rough.data[i + 1] = r;
      rough.data[i + 2] = r;
      rough.data[i + 3] = 255;
    }
  }

  colorCtx.putImageData(color, 0, 0);
  roughCtx.putImageData(rough, 0, 0);
  return { map: finish(colorCanvas, true), roughness: finish(roughCanvas, false) };
}

/** Dark repeating wood for the table the board sits on. */
export function createTableWood(size = 512): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const early: Rgb = [58, 34, 20];
  const late: Rgb = [30, 17, 10];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      // Periodic in u so the texture tiles along the planks.
      const warp = fbm(Math.cos(u * Math.PI * 2) * 2 + 7, v * 6, 3, 4) * 2.2;
      const rings = v * 14 + warp;
      const ring = rings - Math.floor(rings);
      const plankSeam = Math.abs(((v * 4) % 1) - 0.5) > 0.49 ? 0.6 : 0;
      const base = mixRgb(early, late, Math.min(1, smoothstep(0.5, 0.95, ring) + plankSeam));
      const fiber = 1 + (valueNoise(u * 8, v * 260, 2) - 0.5) * 0.25;
      const i = (y * size + x) * 4;
      image.data[i] = base[0] * fiber;
      image.data[i + 1] = base[1] * fiber;
      image.data[i + 2] = base[2] * fiber;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = finish(canvas, true);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Colours and features of a tile's soil face. */
export interface SoilLook {
  light: Rgb;
  dark: Rgb;
  /** Strength of the ploughed furrows (0 = none). */
  furrows: number;
  /** Wind ripples, for sand. */
  ripples?: number;
  pebbles: number;
  /** Little grass tufts. */
  tufts: number;
  tuftColor?: Rgb;
}

export const SOIL_LOOKS = {
  earth: { light: [138, 98, 62], dark: [76, 50, 30], furrows: 0.25, pebbles: 70, tufts: 26 },
  sand: { light: [222, 192, 140], dark: [176, 140, 92], furrows: 0, ripples: 0.35, pebbles: 24, tufts: 6, tuftColor: [120, 130, 60] },
  terracotta: { light: [186, 116, 74], dark: [120, 70, 44], furrows: 0.1, pebbles: 60, tufts: 14, tuftColor: [110, 120, 70] },
  steppe: { light: [150, 136, 92], dark: [92, 82, 56], furrows: 0.05, pebbles: 40, tufts: 70, tuftColor: [130, 140, 70] },
  loam: { light: [104, 86, 60], dark: [52, 44, 32], furrows: 0.15, pebbles: 50, tufts: 60, tuftColor: [70, 120, 50] },
} satisfies Record<string, SoilLook>;

export type SoilLookId = keyof typeof SOIL_LOOKS;

/**
 * Tilled earth with pebbles, used for the bottom face of every tile. Tiles
 * sample different windows of it (see varySoilPerTile), so it is drawn large.
 */
export function createSoilTexture(size = 512, look: SoilLook = SOIL_LOOKS.earth): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const k = size / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / (22 * k), y / (22 * k), 4, 8);
      const grain = valueNoise(x / (2.2 * k), y / (2.2 * k), 12);
      const furrow = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 10 + n * 3);
      const ripple = look.ripples ? 0.5 + 0.5 * Math.sin((x + y * 0.35) / (7 * k) + n * 6) : 0;
      const base = mixRgb(look.dark, look.light, Math.min(1, n * 0.9 + furrow * look.furrows + ripple * (look.ripples ?? 0)));
      const shade = 0.82 + grain * 0.3;
      const i = (y * size + x) * 4;
      image.data[i] = base[0] * shade;
      image.data[i + 1] = base[1] * shade;
      image.data[i + 2] = base[2] * shade;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  for (let i = 0; i < look.pebbles * k * k; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (1 + Math.random() * 3.2) * k;
    const tone = 0.85 + Math.random() * 0.5;
    const [pr, pg, pb] = look.light;
    ctx.fillStyle = `rgba(${pr * tone}, ${pg * tone * 0.95}, ${pb * tone * 0.9}, 0.85)`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.75, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  const [tr, tg, tb] = look.tuftColor ?? [96, 128, 52];
  for (let i = 0; i < look.tufts * k * k; i++) {
    ctx.fillStyle = `rgba(${tr}, ${tg}, ${tb}, ${0.35 + Math.random() * 0.4})`;
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 2 * k, (2 + Math.random() * 4) * k);
  }
  return finish(canvas, true);
}

/** Paved road: rounded setts with dark joints (Roman roads, city squares). */
export function createCobbleTexture(size = 512, light: Rgb = [170, 160, 146], dark: Rgb = [58, 52, 46]): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.fillStyle = `rgb(${dark[0]}, ${dark[1]}, ${dark[2]})`;
  ctx.fillRect(0, 0, size, size);
  const rows = 9;
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = (r % 2) * -h * 0.5;
    while (x < size) {
      const w = h * (0.9 + Math.random() * 0.6);
      const tone = 0.78 + Math.random() * 0.3;
      const g = ctx.createRadialGradient(x + w * 0.45, r * h + h * 0.4, 1, x + w / 2, r * h + h / 2, w * 0.6);
      g.addColorStop(0, `rgb(${light[0] * tone * 1.08}, ${light[1] * tone * 1.08}, ${light[2] * tone * 1.08})`);
      g.addColorStop(1, `rgb(${light[0] * tone * 0.72}, ${light[1] * tone * 0.72}, ${light[2] * tone * 0.72})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 2, r * h + 2, w - 4, h - 4, h * 0.25);
      ctx.fill();
      x += w;
    }
  }
  // A little grime and moss in the joints.
  const image = ctx.getImageData(0, 0, size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = 0.86 + valueNoise(x / 3, y / 3, 71) * 0.22 - fbm(x / 60, y / 60, 3, 72) * 0.12;
      image.data[i] = image.data[i]! * n;
      image.data[i + 1] = image.data[i + 1]! * n;
      image.data[i + 2] = image.data[i + 2]! * n;
    }
  }
  ctx.putImageData(image, 0, 0);
  return finish(canvas, true);
}

/** Polished marble cap with a gilded inlay: the "closed" face of a tile. */
export function createCapTexture(size = 512): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const base: Rgb = [242, 236, 226];
  const vein: Rgb = [150, 140, 132];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = fbm(u * 4, v * 4, 5, 21);
      const veinLine = Math.abs(Math.sin((u * 3 + v * 2 + n * 5) * Math.PI));
      const veinAmount = Math.pow(1 - veinLine, 10) * 0.8 + (n - 0.5) * 0.25;
      const c = mixRgb(base, vein, Math.max(0, Math.min(1, veinAmount)));
      const i = (y * size + x) * 4;
      image.data[i] = c[0];
      image.data[i + 1] = c[1];
      image.data[i + 2] = c[2];
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  const inset = size * 0.1;
  ctx.strokeStyle = 'rgba(196, 150, 64, 0.95)';
  ctx.lineWidth = size * 0.018;
  ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.strokeStyle = 'rgba(196, 150, 64, 0.55)';
  ctx.lineWidth = size * 0.006;
  const inner = inset + size * 0.035;
  ctx.strokeRect(inner, inner, size - inner * 2, size - inner * 2);

  // Small engraved diamond in the centre.
  const c = size / 2;
  const d = size * 0.06;
  ctx.fillStyle = 'rgba(196, 150, 64, 0.8)';
  ctx.beginPath();
  ctx.moveTo(c, c - d);
  ctx.lineTo(c + d, c);
  ctx.lineTo(c, c + d);
  ctx.lineTo(c - d, c);
  ctx.closePath();
  ctx.fill();
  return finish(canvas, true);
}

/** Soft burnt mark left on a tile after an explosion. */
export function createScorchTexture(size = 256): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5;
      const dy = y / size - 0.5;
      const angle = Math.atan2(dy, dx);
      const edge = 0.32 + fbm(Math.cos(angle) * 2 + 3, Math.sin(angle) * 2 + 3, 3, 5) * 0.2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const soot = fbm(x / 18, y / 18, 3, 6);
      const alpha = smoothstep(edge, edge * 0.35, dist) * (0.6 + soot * 0.4);
      const i = (y * size + x) * 4;
      image.data[i] = 18 + soot * 20;
      image.data[i + 1] = 14 + soot * 14;
      image.data[i + 2] = 12 + soot * 10;
      image.data[i + 3] = alpha * 235;
    }
  }
  ctx.putImageData(image, 0, 0);
  return finish(canvas, true);
}

/** Screen-space backdrop: warm dim room fading into darkness (or a theme's own stops). */
export function createBackdropTexture(stops: readonly string[] = ['#07090d', '#1a1712', '#2a2018', '#120c08']): Texture {
  const [canvas, ctx] = makeCanvas(16, 512);
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  const at = [0, 0.45, 0.62, 1];
  stops.forEach((stop, i) => gradient.addColorStop(at[i] ?? i / (stops.length - 1), stop));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 16, 512);
  return finish(canvas, true);
}

/** Cooled basalt for the volcano theme, with a matching map of glowing cracks. */
export function createBasaltTextures(size = 256): { map: Texture; glow: Texture } {
  const [canvas, ctx] = makeCanvas(size, size);
  const [glowCanvas, glowCtx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const glow = glowCtx.createImageData(size, size);
  const light: Rgb = [70, 64, 62];
  const dark: Rgb = [26, 23, 23];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / 26, y / 26, 4, 31);
      const grain = valueNoise(x / 1.8, y / 1.8, 33);
      const base = mixRgb(dark, light, Math.min(1, n * 1.1));
      const shade = 0.8 + grain * 0.35;
      // Cracks follow the iso-lines of a second noise field.
      const field = fbm(x / 40, y / 40, 3, 47) * 9;
      const crack = smoothstep(0.08, 0.0, Math.abs(field - Math.round(field))) * smoothstep(0.35, 0.65, fbm(x / 60, y / 60, 2, 5));
      const i = (y * size + x) * 4;
      image.data[i] = base[0] * shade * (1 - crack * 0.6);
      image.data[i + 1] = base[1] * shade * (1 - crack * 0.7);
      image.data[i + 2] = base[2] * shade * (1 - crack * 0.7);
      image.data[i + 3] = 255;
      glow.data[i] = 255 * crack;
      glow.data[i + 1] = 110 * crack;
      glow.data[i + 2] = 20 * crack;
      glow.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  glowCtx.putImageData(glow, 0, 0);
  return { map: finish(canvas, true), glow: finish(glowCanvas, true) };
}

/** Frozen ground: dark soil under patchy snow and frost. */
export function createFrostSoilTexture(size = 512): Texture {
  const [canvas, ctx] = makeCanvas(size, size);
  const image = ctx.createImageData(size, size);
  const soil: Rgb = [118, 108, 102];
  const snow: Rgb = [214, 222, 234];
  const k = size / 256;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Smaller patches than before: one big drift used to read as a single blotch per tile.
      const n = fbm(x / (34 * k), y / (34 * k), 4, 61) * 0.8 + fbm(x / (9 * k), y / (9 * k), 2, 63) * 0.2;
      const grain = valueNoise(x / (2 * k), y / (2 * k), 62);
      const cover = smoothstep(0.4, 0.58, n + (grain - 0.5) * 0.08);
      const c = mixRgb(soil, snow, cover);
      const shade = 0.88 + grain * 0.2;
      const i = (y * size + x) * 4;
      image.data[i] = Math.min(255, c[0] * shade);
      image.data[i + 1] = Math.min(255, c[1] * shade);
      image.data[i + 2] = Math.min(255, c[2] * shade * 1.03);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return finish(canvas, true);
}
