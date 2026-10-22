import type { Expression } from './types';

export type PortraitHeadgear =
  | 'nemes'
  | 'pschent'
  | 'galea'
  | 'laurel'
  | 'corinthian'
  | 'kabuto'
  | 'turban'
  | 'nasal'
  | 'feathers'
  | 'crown'
  | 'hood'
  | 'diadem'
  | 'wrapped'
  | 'topknot'
  | 'furHat'
  | 'royalCap'
  | 'keffiyeh'
  | 'kidaris'
  | 'phrygian'
  | 'none';

export type PortraitBeard = 'none' | 'short' | 'full' | 'ceremonial' | 'mustache';

/** Everything the bust is drawn from. Colours are CSS strings. */
export interface PortraitParams {
  skin: string;
  hair: string;
  eyes: string;
  headgear: PortraitHeadgear;
  beard: PortraitBeard;
  garment: string;
  trim: string;
  /** Crest, stripes or feathers. */
  accent: string;
  backdrop: readonly [string, string];
  jewelry?: 'collar' | 'torque' | 'chain' | 'none';
  /** Painted kohl around the eyes. */
  kohl?: boolean;
  /** 0 young .. 1 old: adds a few lines and greys the beard. */
  age?: number;
  /** Cloak over one shoulder. */
  cloak?: string;
}

export const EXPRESSIONS: readonly Expression[] = ['neutral', 'taunt', 'hit', 'win', 'lose'];

export const EXPRESSION_LABELS: Readonly<Record<Expression, string>> = {
  neutral: 'Neutro',
  taunt: 'Provocação',
  hit: 'Atingido',
  win: 'Vitória',
  lose: 'Derrota',
};

interface Face {
  /** Brow angle (positive = inner ends up, worried) and lift. */
  browTilt: number;
  browLift: number;
  /** Asymmetric lift of the right brow (taunt). */
  browCock: number;
  /** 1 open .. 0 shut; < 0 draws happy arcs. */
  eyeOpen: number;
  /** Where the pupils look (x, y in px). */
  gaze: [number, number];
  /** Mouth curve (+ smile, − frown), width, opening and asymmetry. */
  smile: number;
  mouthWidth: number;
  mouthOpen: number;
  smirk: number;
  /** Head tilt in radians and drop in px. */
  tilt: number;
  drop: number;
}

const FACES: Readonly<Record<Expression, Face>> = {
  neutral: { browTilt: 0, browLift: 0, browCock: 0, eyeOpen: 1, gaze: [0, 0], smile: 0.5, mouthWidth: 18, mouthOpen: 0, smirk: 0, tilt: 0, drop: 0 },
  taunt: { browTilt: -0.05, browLift: 1, browCock: 6, eyeOpen: 0.75, gaze: [3, 0], smile: 4, mouthWidth: 19, mouthOpen: 0, smirk: 5, tilt: 0.06, drop: 0 },
  hit: { browTilt: 0.35, browLift: -1, browCock: 0, eyeOpen: 0.15, gaze: [0, 0], smile: -3, mouthWidth: 16, mouthOpen: 5, smirk: 0, tilt: -0.1, drop: 2 },
  win: { browTilt: -0.08, browLift: 3, browCock: 0, eyeOpen: -1, gaze: [0, 0], smile: 8, mouthWidth: 24, mouthOpen: 5, smirk: 0, tilt: 0.03, drop: -2 },
  lose: { browTilt: 0.3, browLift: 1, browCock: 0, eyeOpen: 0.6, gaze: [0, 4], smile: -5, mouthWidth: 17, mouthOpen: 0, smirk: 0, tilt: -0.05, drop: 6 },
};

const HX = 128;
const HY = 108;
const RX = 38;
const RY = 47;

function shadeColor(css: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return css;
  const n = parseInt(m[1]!, 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/**
 * Draws a stylised bust of a faction leader on a 2D canvas. The drawing is
 * resolution independent (authored on a 256 grid) and fully procedural.
 */
export function renderPortrait(params: PortraitParams, expression: Expression = 'neutral', size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.scale(size / 256, size / 256);
  const face = FACES[expression];

  // Backdrop: soft radial light behind the head, framed by a thin ring.
  const bg = ctx.createRadialGradient(HX, 100, 10, HX, 128, 180);
  bg.addColorStop(0, params.backdrop[0]);
  bg.addColorStop(1, params.backdrop[1]);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 256, 256);

  drawShoulders(ctx, params);

  ctx.save();
  ctx.translate(HX, HY + 40 + face.drop);
  ctx.rotate(face.tilt);
  ctx.translate(-HX, -(HY + 40));

  drawBackHeadgear(ctx, params);
  // Neck.
  ctx.fillStyle = shadeColor(params.skin, 0.86);
  ctx.beginPath();
  ctx.roundRect(HX - 17, HY + 30, 34, 42, 10);
  ctx.fill();
  drawHead(ctx, params, face);
  drawFrontHeadgear(ctx, params);
  ctx.restore();

  // Frame.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, 253, 253);
  return canvas;
}

export function portraitDataUrl(params: PortraitParams, expression: Expression = 'neutral', size = 256): string {
  return renderPortrait(params, expression, size).toDataURL('image/png');
}

function drawShoulders(ctx: CanvasRenderingContext2D, p: PortraitParams): void {
  ctx.fillStyle = p.garment;
  ctx.beginPath();
  ctx.moveTo(30, 256);
  ctx.bezierCurveTo(36, 196, 80, 178, HX, 176);
  ctx.bezierCurveTo(176, 178, 220, 196, 226, 256);
  ctx.closePath();
  ctx.fill();
  // Fold shadows.
  ctx.strokeStyle = shadeColor(p.garment, 0.75);
  ctx.lineWidth = 2;
  for (const x of [82, 174]) {
    ctx.beginPath();
    ctx.moveTo(x, 200);
    ctx.quadraticCurveTo(x + (x < HX ? -6 : 6), 228, x + (x < HX ? -10 : 10), 256);
    ctx.stroke();
  }
  if (p.cloak) {
    ctx.fillStyle = p.cloak;
    ctx.beginPath();
    ctx.moveTo(30, 256);
    ctx.bezierCurveTo(40, 200, 70, 182, 104, 182);
    ctx.lineTo(70, 256);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.trim;
    ctx.beginPath();
    ctx.arc(100, 188, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  const jewelry = p.jewelry ?? 'none';
  if (jewelry === 'collar') {
    // Broad beaded collar in bands.
    const bands = [p.trim, p.accent, p.trim, '#2f5fa8'];
    bands.forEach((color, i) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(HX, 172, 46 + i * 7, 22 + i * 6, 0, 0.1, Math.PI - 0.1);
      ctx.stroke();
    });
  } else if (jewelry === 'torque') {
    ctx.strokeStyle = p.trim;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(HX, 176, 24, 10, 0, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else if (jewelry === 'chain') {
    ctx.fillStyle = p.trim;
    for (let i = 0; i <= 8; i++) {
      const a = 0.25 + (i / 8) * (Math.PI - 0.5);
      ctx.beginPath();
      ctx.arc(HX + Math.cos(a) * 34, 176 + Math.sin(a) * 18, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Neckline trim.
  ctx.strokeStyle = p.trim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(HX, 176, 30, 12, 0, 0.15, Math.PI - 0.15);
  ctx.stroke();
}

function drawHead(ctx: CanvasRenderingContext2D, p: PortraitParams, f: Face): void {
  // Ears.
  ctx.fillStyle = shadeColor(p.skin, 0.92);
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(HX + s * RX, HY + 4, 7, 11, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Face with a gentle side shadow.
  const g = ctx.createLinearGradient(HX - RX, 0, HX + RX, 0);
  g.addColorStop(0, shadeColor(p.skin, 0.88));
  g.addColorStop(0.45, p.skin);
  g.addColorStop(1, shadeColor(p.skin, 0.8));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(HX - RX, HY - 10);
  ctx.bezierCurveTo(HX - RX, HY - RY - 6, HX + RX, HY - RY - 6, HX + RX, HY - 10);
  ctx.bezierCurveTo(HX + RX, HY + 28, HX + 16, HY + RY, HX, HY + RY);
  ctx.bezierCurveTo(HX - 16, HY + RY, HX - RX, HY + 28, HX - RX, HY - 10);
  ctx.fill();

  if (p.headgear === 'none' || p.headgear === 'laurel' || p.headgear === 'diadem' || p.headgear === 'corinthian' || p.headgear === 'topknot') {
    // Hair on top when the headgear leaves it visible.
    ctx.fillStyle = p.hair;
    ctx.beginPath();
    ctx.moveTo(HX - RX - 1, HY - 6);
    ctx.bezierCurveTo(HX - RX - 4, HY - RY - 12, HX + RX + 4, HY - RY - 12, HX + RX + 1, HY - 6);
    ctx.bezierCurveTo(HX + 20, HY - 30, HX - 20, HY - 30, HX - RX - 1, HY - 6);
    ctx.fill();
  }

  const age = p.age ?? 0.3;
  const eyeY = HY - 2;
  // Eyes.
  for (const s of [-1, 1]) {
    const ex = HX + s * 15;
    if (f.eyeOpen < 0) {
      ctx.strokeStyle = '#2a1e18';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(ex, eyeY + 3, 7, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      continue;
    }
    const open = Math.max(0.12, f.eyeOpen);
    ctx.fillStyle = '#f6f1e8';
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 8.5, 5 * open, 0, 0, Math.PI * 2);
    ctx.fill();
    if (open > 0.3) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 8.5, 5 * open, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = p.eyes;
      ctx.beginPath();
      ctx.arc(ex + f.gaze[0], eyeY + f.gaze[1] * 0.5, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#120c0a';
      ctx.beginPath();
      ctx.arc(ex + f.gaze[0], eyeY + f.gaze[1] * 0.5, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = p.kohl ? '#141010' : shadeColor(p.skin, 0.55);
    ctx.lineWidth = p.kohl ? 2.4 : 1.4;
    ctx.beginPath();
    ctx.ellipse(ex, eyeY, 8.5, 5 * open, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    if (p.kohl) {
      ctx.beginPath();
      ctx.moveTo(ex + s * 8, eyeY);
      ctx.lineTo(ex + s * 15, eyeY + 2);
      ctx.stroke();
    }
  }
  // Brows.
  ctx.strokeStyle = shadeColor(p.hair, 0.9);
  ctx.lineWidth = 3.4;
  ctx.lineCap = 'round';
  for (const s of [-1, 1]) {
    const inner = HX + s * 6;
    const outer = HX + s * 23;
    const lift = f.browLift + (s > 0 ? f.browCock : 0);
    ctx.beginPath();
    ctx.moveTo(inner, eyeY - 11 - lift - f.browTilt * 12);
    ctx.quadraticCurveTo((inner + outer) / 2, eyeY - 15 - lift, outer, eyeY - 10 - lift + f.browTilt * 8);
    ctx.stroke();
  }
  // Nose: a soft side shadow and the nostril line.
  ctx.strokeStyle = shadeColor(p.skin, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(HX + 2, eyeY + 4);
  ctx.quadraticCurveTo(HX + 7, eyeY + 18, HX + 3, eyeY + 22);
  ctx.quadraticCurveTo(HX, eyeY + 24, HX - 5, eyeY + 22);
  ctx.stroke();
  // Age lines.
  if (age > 0.45) {
    ctx.strokeStyle = shadeColor(p.skin, 0.78);
    ctx.lineWidth = 1.2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(HX + s * 11, eyeY + 22);
      ctx.quadraticCurveTo(HX + s * 17, eyeY + 30, HX + s * 15, eyeY + 37);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(HX - 10, eyeY - 24);
    ctx.lineTo(HX + 10, eyeY - 24);
    ctx.stroke();
  }

  drawBeard(ctx, p, f);

  // Mouth.
  const my = HY + 30;
  const w = f.mouthWidth / 2;
  ctx.strokeStyle = '#5a2a22';
  ctx.fillStyle = '#4a1c18';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(HX - w, my - f.smile * 0.4);
  ctx.quadraticCurveTo(HX + f.smirk, my + f.smile, HX + w, my - f.smile * 0.4 - f.smirk * 0.8);
  if (f.mouthOpen > 0) {
    ctx.quadraticCurveTo(HX, my + f.smile + f.mouthOpen * 1.6, HX - w, my - f.smile * 0.4);
    ctx.fill();
    if (f.smile > 4) {
      ctx.fillStyle = '#f2ece2';
      ctx.fillRect(HX - w * 0.7, my - f.smile * 0.1, w * 1.4, 2.5);
    }
  }
  ctx.stroke();
}

function drawBeard(ctx: CanvasRenderingContext2D, p: PortraitParams, f: Face): void {
  const grey = (p.age ?? 0.3) > 0.6;
  const color = grey ? '#9a958c' : p.hair;
  ctx.fillStyle = color;
  const my = HY + 30;
  switch (p.beard) {
    case 'none':
      return;
    case 'mustache':
      ctx.beginPath();
      ctx.ellipse(HX - 8, my - 5 - f.smile * 0.2, 9, 3.5, 0.25, 0, Math.PI * 2);
      ctx.ellipse(HX + 8, my - 5 - f.smile * 0.2, 9, 3.5, -0.25, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'ceremonial':
      // Narrow plaited false beard of the pharaohs, tied with a strap.
      ctx.fillStyle = shadeColor(p.hair, 1);
      ctx.beginPath();
      ctx.roundRect(HX - 5, HY + RY - 6, 10, 26, 3);
      ctx.fill();
      ctx.strokeStyle = p.trim;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(HX - 5, HY + RY - 2 + i * 6);
        ctx.lineTo(HX + 5, HY + RY - 2 + i * 6);
        ctx.stroke();
      }
      return;
    case 'short':
    case 'full': {
      const long = p.beard === 'full' ? 22 : 8;
      ctx.beginPath();
      ctx.moveTo(HX - RX + 4, HY + 4);
      ctx.bezierCurveTo(HX - RX + 6, HY + RY + long, HX + RX - 6, HY + RY + long, HX + RX - 4, HY + 4);
      ctx.bezierCurveTo(HX + 22, HY + 26, HX - 22, HY + 26, HX - RX + 4, HY + 4);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(HX, my - 5, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Parts of the headgear behind the head (lappets, cloth, crest tails). */
function drawBackHeadgear(ctx: CanvasRenderingContext2D, p: PortraitParams): void {
  if (p.headgear === 'nemes') {
    stripes(ctx, p, () => {
      ctx.beginPath();
      ctx.moveTo(HX - RX - 4, HY - 18);
      ctx.lineTo(HX - RX - 22, HY + 64);
      ctx.lineTo(HX + RX + 22, HY + 64);
      ctx.lineTo(HX + RX + 4, HY - 18);
      ctx.closePath();
    }, true);
  } else if (p.headgear === 'kabuto') {
    // Neck guard: stepped lacquer plates flaring out behind the head.
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? shadeColor(p.accent, 0.8) : p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 6 - i * 5, HY - 18 + i * 12);
      ctx.lineTo(HX + RX + 6 + i * 5, HY - 18 + i * 12);
      ctx.lineTo(HX + RX + 10 + i * 5, HY - 6 + i * 12);
      ctx.lineTo(HX - RX - 10 - i * 5, HY - 6 + i * 12);
      ctx.closePath();
      ctx.fill();
    }
  } else if (p.headgear === 'keffiyeh') {
    // The head cloth falls behind the shoulders.
    ctx.fillStyle = shadeColor(p.accent, 0.82);
    ctx.beginPath();
    ctx.moveTo(HX - RX - 8, HY - 30);
    ctx.lineTo(HX - RX - 26, HY + 78);
    ctx.lineTo(HX + RX + 26, HY + 78);
    ctx.lineTo(HX + RX + 8, HY - 30);
    ctx.closePath();
    ctx.fill();
  } else if (p.headgear === 'hood' || p.headgear === 'wrapped') {
    ctx.fillStyle = shadeColor(p.accent, 0.8);
    ctx.beginPath();
    ctx.ellipse(HX, HY + 6, RX + 14, RY + 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFrontHeadgear(ctx: CanvasRenderingContext2D, p: PortraitParams): void {
  const top = HY - RY;
  switch (p.headgear) {
    case 'nemes': {
      stripes(ctx, p, () => {
        ctx.beginPath();
        ctx.moveTo(HX - RX - 6, HY - 12);
        ctx.bezierCurveTo(HX - RX - 4, top - 18, HX + RX + 4, top - 18, HX + RX + 6, HY - 12);
        ctx.lineTo(HX + RX - 2, HY - 18);
        ctx.bezierCurveTo(HX + 20, HY - 30, HX - 20, HY - 30, HX - RX + 2, HY - 18);
        ctx.closePath();
      }, false);
      // Lappets falling in front of the shoulders.
      for (const s of [-1, 1]) {
        stripes(ctx, p, () => {
          ctx.beginPath();
          ctx.moveTo(HX + s * (RX - 2), HY - 10);
          ctx.lineTo(HX + s * (RX + 10), HY - 8);
          ctx.lineTo(HX + s * (RX + 4), HY + 70);
          ctx.lineTo(HX + s * (RX - 10), HY + 70);
          ctx.closePath();
        }, true);
      }
      ctx.fillStyle = p.trim;
      ctx.fillRect(HX - RX + 2, HY - 22, RX * 2 - 4, 4);
      emblem(ctx, p, HX, HY - 30);
      return;
    }
    case 'pschent': {
      // White crown inside the red crown, with the red crown's curl.
      ctx.fillStyle = '#efe9da';
      ctx.beginPath();
      ctx.moveTo(HX - 24, HY - 26);
      ctx.bezierCurveTo(HX - 26, top - 46, HX - 6, top - 58, HX, top - 62);
      ctx.bezierCurveTo(HX + 6, top - 58, HX + 26, top - 46, HX + 24, HY - 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#a8342a';
      ctx.beginPath();
      ctx.moveTo(HX - RX - 4, HY - 6);
      ctx.lineTo(HX - RX, top - 10);
      ctx.lineTo(HX - 20, top - 10);
      ctx.lineTo(HX - 20, HY - 30);
      ctx.lineTo(HX + 20, HY - 30);
      ctx.lineTo(HX + 22, top - 30);
      ctx.lineTo(HX + RX + 4, top - 34);
      ctx.lineTo(HX + RX + 4, HY - 6);
      ctx.bezierCurveTo(HX + 20, HY - 22, HX - 20, HY - 22, HX - RX - 4, HY - 6);
      ctx.fill();
      ctx.strokeStyle = p.trim;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(HX - 14, HY - 32);
      ctx.bezierCurveTo(HX - 30, top - 10, HX - 6, top - 26, HX - 16, top - 30);
      ctx.stroke();
      emblem(ctx, p, HX, HY - 30);
      return;
    }
    case 'galea':
    case 'corinthian': {
      const pushedUp = p.headgear === 'corinthian';
      const y0 = pushedUp ? top - 6 : top + 2;
      const rim = pushedUp ? HY - 26 : HY - 20;
      const metal = ctx.createLinearGradient(HX - RX, y0 - 20, HX + RX, rim);
      metal.addColorStop(0, shadeColor(p.trim, 0.55));
      metal.addColorStop(0.45, shadeColor(p.trim, 1.12));
      metal.addColorStop(1, shadeColor(p.trim, 0.5));
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 3, rim);
      ctx.bezierCurveTo(HX - RX - 3, y0 - 30, HX + RX + 3, y0 - 30, HX + RX + 3, rim);
      ctx.bezierCurveTo(HX + 18, rim - (pushedUp ? 16 : 8), HX - 18, rim - (pushedUp ? 16 : 8), HX - RX - 3, rim);
      ctx.closePath();
      ctx.fill();
      if (!pushedUp) {
        // Brow guard and slim hinged cheek pieces beside the face.
        ctx.fillStyle = shadeColor(p.trim, 0.8);
        ctx.fillRect(HX - RX - 2, rim - 3, RX * 2 + 4, 5);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(HX + s * (RX + 3), rim);
          ctx.lineTo(HX + s * (RX + 1), HY + 20);
          ctx.lineTo(HX + s * (RX - 6), HY + 16);
          ctx.lineTo(HX + s * (RX - 5), rim + 2);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // The empty eye openings of a helmet worn pushed back.
        ctx.fillStyle = 'rgba(20, 14, 10, 0.75)';
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(HX + s * 13, HY - 38, 9, 4, s * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Crest.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 6, y0 - 12);
      ctx.bezierCurveTo(HX - 30, y0 - 50, HX + 30, y0 - 50, HX + RX + 10, y0 - 6);
      ctx.bezierCurveTo(HX + 20, y0 - 30, HX - 20, y0 - 30, HX - RX - 6, y0 - 12);
      ctx.fill();
      ctx.strokeStyle = shadeColor(p.accent, 0.7);
      ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const x = HX - RX + i * 7;
        ctx.beginPath();
        ctx.moveTo(x, y0 - 18);
        ctx.lineTo(x + 2, y0 - 36 + Math.abs(i - 6) * 2);
        ctx.stroke();
      }
      return;
    }
    case 'laurel':
      laurel(ctx, p, HY - 24);
      return;
    case 'diadem':
      ctx.fillStyle = p.trim;
      ctx.fillRect(HX - RX, HY - 26, RX * 2, 5);
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(HX, HY - 24, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'crown':
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.moveTo(HX - RX, HY - 22);
      for (let i = 0; i <= 6; i++) ctx.lineTo(HX - RX + (i * RX * 2) / 6, i % 2 ? top - 22 : top - 6);
      ctx.lineTo(HX + RX, HY - 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.accent;
      for (const s of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.arc(HX + s * 20, HY - 30, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    case 'kabuto': {
      // Bowl, a narrow visor, turned-back wings and the antler crest; the
      // lamellar neck guard is drawn behind the head.
      ctx.fillStyle = shadeColor(p.trim, 0.5);
      ctx.beginPath();
      ctx.ellipse(HX, HY - 22, RX + 3, 32, 0, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = shadeColor(p.trim, 0.8);
      ctx.lineWidth = 1.5;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(HX + i * 9, HY - 22);
        ctx.quadraticCurveTo(HX + i * 6, HY - 44, HX + i * 2, HY - 52);
        ctx.stroke();
      }
      ctx.fillStyle = '#1a1410';
      ctx.fillRect(HX - RX - 4, HY - 25, RX * 2 + 8, 5);
      ctx.fillStyle = p.accent;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + s * (RX + 2), HY - 24);
        ctx.lineTo(HX + s * (RX + 16), HY - 34);
        ctx.lineTo(HX + s * (RX + 14), HY - 18);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = p.trim;
      ctx.lineWidth = 4;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX, HY - 44);
        ctx.quadraticCurveTo(HX + s * 18, HY - 66, HX + s * 34, HY - 82);
        ctx.stroke();
      }
      return;
    }
    case 'turban':
      ctx.fillStyle = p.accent;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.ellipse(HX, HY - 26 - i * 9, RX + 8 - i * 6, 14, (i % 2 ? 1 : -1) * 0.08, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = shadeColor(p.accent, 0.75);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.arc(HX, HY - 34, 5, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'nasal':
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 3, HY - 14);
      ctx.quadraticCurveTo(HX, top - 34, HX + RX + 3, HY - 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(HX - 3, HY - 16, 6, 24);
      ctx.fillStyle = p.accent;
      ctx.fillRect(HX - RX - 2, HY - 18, RX * 2 + 4, 5);
      return;
    case 'feathers':
      for (let i = -4; i <= 4; i++) {
        ctx.save();
        ctx.translate(HX, HY - 22);
        ctx.rotate(i * 0.2);
        ctx.fillStyle = i % 2 ? p.accent : p.trim;
        ctx.beginPath();
        ctx.ellipse(0, -46, 7, 30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = p.trim;
      ctx.fillRect(HX - RX, HY - 26, RX * 2, 8);
      return;
    case 'hood':
    case 'wrapped':
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 10, HY + 10);
      ctx.bezierCurveTo(HX - RX - 10, top - 26, HX + RX + 10, top - 26, HX + RX + 10, HY + 10);
      ctx.lineTo(HX + RX - 2, HY - 12);
      ctx.bezierCurveTo(HX + 20, HY - 34, HX - 20, HY - 34, HX - RX + 2, HY - 12);
      ctx.closePath();
      ctx.fill();
      if (p.headgear === 'wrapped') {
        ctx.fillStyle = shadeColor(p.accent, 0.85);
        ctx.fillRect(HX - RX + 2, HY + 18, RX * 2 - 4, 22);
      }
      return;
    case 'furHat': {
      // Steppe hat: a pointed felt crown over a thick fur brim.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX + 4, HY - 26);
      ctx.quadraticCurveTo(HX - 6, top - 44, HX + 4, top - 52);
      ctx.quadraticCurveTo(HX + 14, top - 40, HX + RX - 4, HY - 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.trim;
      ctx.beginPath();
      ctx.arc(HX + 4, top - 52, 4, 0, Math.PI * 2);
      ctx.fill();
      const fur = ctx.createLinearGradient(0, HY - 34, 0, HY - 14);
      fur.addColorStop(0, '#6a4a32');
      fur.addColorStop(1, '#3a2618');
      ctx.fillStyle = fur;
      ctx.beginPath();
      ctx.ellipse(HX, HY - 24, RX + 12, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 240, 220, 0.25)';
      ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo(HX + i * 7, HY - 32);
        ctx.lineTo(HX + i * 7 + 2, HY - 16);
        ctx.stroke();
      }
      return;
    }
    case 'royalCap': {
      // Tall truncated royal cap with a small point and a diadem band whose
      // ribbons fall behind.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX + 2, HY - 22);
      ctx.lineTo(HX - RX + 10, top - 34);
      ctx.lineTo(HX + RX - 10, top - 34);
      ctx.lineTo(HX + RX - 2, HY - 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shadeColor(p.accent, 0.8);
      ctx.beginPath();
      ctx.moveTo(HX - 8, top - 34);
      ctx.lineTo(HX, top - 50);
      ctx.lineTo(HX + 8, top - 34);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.trim;
      for (const y of [HY - 30, top - 6, top - 30]) ctx.fillRect(HX - RX + 4, y, RX * 2 - 8, 4);
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(HX + i * 13, HY - 40, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'keffiyeh': {
      // Head cloth framing the face, held by a doubled dark cord.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 12, HY + 34);
      ctx.bezierCurveTo(HX - RX - 14, top - 30, HX + RX + 14, top - 30, HX + RX + 12, HY + 34);
      ctx.lineTo(HX + RX - 3, HY - 4);
      ctx.bezierCurveTo(HX + 22, HY - 30, HX - 22, HY - 30, HX - RX + 3, HY - 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = shadeColor(p.accent, 0.78);
      ctx.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(HX + i * 9, top - 18);
        ctx.lineTo(HX + i * 11, HY - 26);
        ctx.stroke();
      }
      ctx.fillStyle = '#1e1a18';
      for (const y of [HY - 34, HY - 26]) {
        ctx.beginPath();
        ctx.ellipse(HX, y, RX + 6, 5, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }
    case 'kidaris': {
      // Rounded felt tiara with a jewelled band and the ribbons of a diadem.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 2, HY - 20);
      ctx.bezierCurveTo(HX - RX - 6, top - 50, HX + RX + 6, top - 50, HX + RX + 2, HY - 20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.trim;
      ctx.fillRect(HX - RX - 2, HY - 28, RX * 2 + 4, 7);
      ctx.beginPath();
      ctx.moveTo(HX, top - 36);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const r = i % 2 ? 4 : 9;
        ctx.lineTo(HX + Math.sin(a) * r, top - 26 - Math.cos(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + s * (RX + 2), HY - 26);
        ctx.quadraticCurveTo(HX + s * (RX + 18), HY, HX + s * (RX + 10), HY + 30);
        ctx.lineTo(HX + s * (RX + 4), HY + 28);
        ctx.quadraticCurveTo(HX + s * (RX + 10), HY, HX + s * (RX - 2), HY - 22);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    case 'phrygian': {
      // Helmet whose crown sweeps forward into a curl, with cheek pieces.
      const metal = ctx.createLinearGradient(HX - RX, top - 40, HX + RX, HY - 20);
      metal.addColorStop(0, shadeColor(p.trim, 0.55));
      metal.addColorStop(0.45, shadeColor(p.trim, 1.12));
      metal.addColorStop(1, shadeColor(p.trim, 0.5));
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(HX - RX - 3, HY - 20);
      ctx.bezierCurveTo(HX - RX - 4, top - 24, HX - 4, top - 34, HX + 10, top - 46);
      ctx.bezierCurveTo(HX + 30, top - 58, HX + 44, top - 40, HX + 30, top - 30);
      ctx.bezierCurveTo(HX + 38, top - 14, HX + RX + 4, top, HX + RX + 3, HY - 20);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = shadeColor(p.trim, 0.8);
      ctx.fillRect(HX - RX - 2, HY - 23, RX * 2 + 4, 5);
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(HX + s * (RX + 3), HY - 20);
        ctx.lineTo(HX + s * (RX + 1), HY + 18);
        ctx.lineTo(HX + s * (RX - 7), HY + 12);
        ctx.lineTo(HX + s * (RX - 6), HY - 18);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    case 'topknot':
      // Hair gathered in a bun on the crown, held by a band and a pin.
      ctx.fillStyle = p.hair;
      ctx.beginPath();
      ctx.ellipse(HX, top - 8, 15, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.trim;
      ctx.fillRect(HX - 15, top - 2, 30, 5);
      ctx.fillRect(HX - 26, top - 12, 52, 3);
      ctx.beginPath();
      ctx.arc(HX + 26, top - 10.5, 3, 0, Math.PI * 2);
      ctx.fill();
      return;
    case 'none':
      return;
  }
}

/** Fills a path with alternating stripes (headcloths). */
function stripes(ctx: CanvasRenderingContext2D, p: PortraitParams, path: () => void, vertical: boolean): void {
  ctx.save();
  path();
  ctx.clip();
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = p.trim;
  for (let i = 0; i < 40; i++) {
    if (vertical) ctx.fillRect(0, i * 8, 256, 4);
    else ctx.fillRect(i * 8, 0, 4, 256);
  }
  ctx.restore();
}

/** A small raised emblem on the brow band (royal headdress). */
function emblem(ctx: CanvasRenderingContext2D, p: PortraitParams, x: number, y: number): void {
  ctx.fillStyle = p.trim;
  ctx.beginPath();
  ctx.moveTo(x - 4, y + 8);
  ctx.quadraticCurveTo(x - 6, y - 4, x, y - 8);
  ctx.quadraticCurveTo(x + 6, y - 4, x + 4, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2f5fa8';
  ctx.beginPath();
  ctx.arc(x, y - 1, 2, 0, Math.PI * 2);
  ctx.fill();
}

function laurel(ctx: CanvasRenderingContext2D, p: PortraitParams, y: number): void {
  ctx.fillStyle = '#6f8a3a';
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const x = HX + s * (8 + i * 6);
      const yy = y - Math.cos(i * 0.3) * 4 + i * 2.5;
      ctx.save();
      ctx.translate(x, yy);
      ctx.rotate(s * (0.6 + i * 0.12));
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.5, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = p.trim;
  ctx.beginPath();
  ctx.arc(HX, y + 2, 2.5, 0, Math.PI * 2);
  ctx.fill();
}
