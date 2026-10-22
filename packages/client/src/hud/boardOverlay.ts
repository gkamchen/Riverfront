import { Vector3, type Camera } from 'three';
import { COLS, ROWS, TILE_TOP, cellCenter, columnLabel, rowLabel, type Side } from '../board/layout';

export interface OverlayCell {
  readonly side: Side;
  readonly col: number;
  readonly row: number;
}

export type MarkKind = 'hit' | 'miss' | 'rock' | 'spotted' | 'shield' | 'probe-unit' | 'probe-earth' | 'probe-rock';

export interface RadarMark {
  readonly col: number;
  readonly row: number;
  readonly count: number | null;
}

/** What the overlay draws this frame. The controller fills it; the overlay only paints. */
export interface OverlayState {
  /** Coach heat per enemy cell index (0..1), or null. */
  heat: readonly number[] | null;
  best: OverlayCell | null;
  hover: OverlayCell | null;
  /** Cells the current action would cover. */
  footprint: readonly OverlayCell[];
  /** Placement ghost (green = fits, red = breaks a rule). */
  ghost: { readonly cells: readonly OverlayCell[]; readonly ok: boolean } | null;
  armed: OverlayCell | null;
  marks: readonly { readonly cell: OverlayCell; readonly kind: MarkKind }[];
  radar: readonly RadarMark[];
  /** Rows under (or about to be under) water, per field. */
  tide: { readonly rows: readonly number[]; readonly rising: boolean } | null;
  coordinates: boolean;
  /** Draw ✓ / ✗ glyphs over results (colour-blind help). */
  glyphs: boolean;
  /** Own pieces with an issue during placement. */
  issues: readonly OverlayCell[];
  /** Match field inside the 25 × 7 board (quick modes are smaller). Cells above are in match coordinates. */
  field: { readonly cols: number; readonly rows: number; readonly offset: number };
  /** Doubles: cells of the partner's pieces on the own field. */
  partner: readonly OverlayCell[];
}

export function emptyOverlay(): OverlayState {
  return { heat: null, best: null, hover: null, footprint: [], ghost: null, armed: null, marks: [], radar: [], tide: null, coordinates: false, glyphs: false, issues: [], field: { cols: COLS, rows: ROWS, offset: 0 }, partner: [] };
}

const HALF = 0.47;
const tmp = new Vector3();

/**
 * A 2D canvas over the 3D scene. It projects cell corners with the live
 * camera, so heat maps, ghosts, target previews and coordinate echoes stay
 * glued to the board at any angle without touching the scene graph.
 */
export class BoardOverlay {
  readonly canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D | null;
  #width = 0;
  #height = 0;
  #ratio = 1;
  #time = 0;
  #offset = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.append(this.canvas);
    this.#ctx = this.canvas.getContext('2d');
  }

  resize(width: number, height: number): void {
    this.#ratio = Math.min(2, window.devicePixelRatio || 1);
    this.#width = width;
    this.#height = height;
    this.canvas.width = Math.round(width * this.#ratio);
    this.canvas.height = Math.round(height * this.#ratio);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  /** Screen position (CSS px) of a cell centre, or null behind the camera. */
  project(camera: Camera, side: Side, col: number, row: number, y = TILE_TOP): { x: number; y: number } | null {
    const p = cellCenter(side, col + this.#offset, row, y);
    tmp.copy(p).project(camera);
    if (tmp.z > 1) return null;
    return { x: ((tmp.x + 1) / 2) * this.#width, y: ((1 - tmp.y) / 2) * this.#height };
  }

  draw(camera: Camera, state: OverlayState, dt: number, calm: boolean): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    this.#time += calm ? 0 : dt;
    ctx.setTransform(this.#ratio, 0, 0, this.#ratio, 0, 0);
    ctx.clearRect(0, 0, this.#width, this.#height);
    camera.updateMatrixWorld();
    const field = state.field;
    this.#offset = 0;
    if (field.offset > 0 || field.rows < ROWS) {
      // Cells outside a smaller field are out of play.
      for (const side of ['own', 'enemy'] as const) {
        for (let row = 0; row < ROWS; row++) {
          for (let col = 0; col < COLS; col++) {
            const inside = col >= field.offset && col < field.offset + field.cols && row < field.rows;
            if (!inside) this.#fillCell(ctx, camera, { side, col, row }, 'rgba(10,6,4,0.62)');
          }
        }
      }
    }
    this.#offset = field.offset;

    if (state.tide) {
      for (const side of ['own', 'enemy'] as const) {
        for (const row of state.tide.rows) {
          for (let col = 0; col < field.cols; col++) this.#fillCell(ctx, camera, { side, col, row }, state.tide.rising ? 'rgba(80,170,255,0.14)' : 'rgba(60,150,240,0.32)');
        }
      }
    }

    if (state.heat) {
      for (let i = 0; i < state.heat.length; i++) {
        const p = state.heat[i] ?? 0;
        if (p <= 0.02) continue;
        const cell = { side: 'enemy' as const, col: i % field.cols, row: Math.floor(i / field.cols) };
        this.#fillCell(ctx, camera, cell, heatColour(p));
      }
    }

    for (const cell of state.partner) {
      this.#fillCell(ctx, camera, cell, 'rgba(90,220,200,0.16)');
      this.#outlineCell(ctx, camera, cell, 'rgba(110,235,215,0.8)', 1.5, [5, 3]);
    }

    for (const cell of state.issues) this.#outlineCell(ctx, camera, cell, 'rgba(255,120,100,0.95)', 2.5, [4, 3]);

    for (const radar of state.radar) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const col = radar.col + dc;
          const row = radar.row + dr;
          if (col < 0 || row < 0 || col >= field.cols || row >= field.rows) continue;
          this.#fillCell(ctx, camera, { side: 'enemy', col, row }, 'rgba(120,220,255,0.10)');
        }
      }
      const at = this.project(camera, 'enemy', radar.col, radar.row, TILE_TOP + 0.05);
      if (at) this.#badge(ctx, at.x, at.y, radar.count === null ? '×' : String(radar.count), 'rgba(20,60,80,0.92)', '#bff0ff');
    }

    for (const mark of state.marks) this.#mark(ctx, camera, mark.cell, mark.kind, state.glyphs);

    if (state.ghost) {
      const fill = state.ghost.ok ? 'rgba(110,230,140,0.35)' : 'rgba(255,90,80,0.38)';
      const line = state.ghost.ok ? 'rgba(150,255,170,0.95)' : 'rgba(255,130,120,0.95)';
      for (const cell of state.ghost.cells) {
        this.#fillCell(ctx, camera, cell, fill);
        this.#outlineCell(ctx, camera, cell, line, 2);
      }
    }

    for (const cell of state.footprint) {
      this.#fillCell(ctx, camera, cell, 'rgba(255,207,107,0.22)');
      this.#outlineCell(ctx, camera, cell, 'rgba(255,214,120,0.85)', 1.5);
    }

    if (state.best) this.#outlineCell(ctx, camera, state.best, 'rgba(255,255,255,0.9)', 2, [5, 4]);

    if (state.armed) {
      const pulse = 0.6 + 0.4 * Math.sin(this.#time * 6);
      this.#outlineCell(ctx, camera, state.armed, `rgba(255,220,120,${pulse})`, 4);
    }

    if (state.hover) {
      // Strong ring: dark halo under a bright line reads on any theme.
      this.#outlineCell(ctx, camera, state.hover, 'rgba(0,0,0,0.65)', 6);
      this.#outlineCell(ctx, camera, state.hover, '#ffd36b', 3);
    }

    if (state.coordinates) this.#coordinates(ctx, camera, state);
  }

  #corners(camera: Camera, cell: OverlayCell, inset = 0): { x: number; y: number }[] | null {
    const c = cellCenter(cell.side, cell.col + this.#offset, cell.row, TILE_TOP + 0.01);
    const h = HALF - inset;
    const out: { x: number; y: number }[] = [];
    for (const [dx, dz] of [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h],
    ] as const) {
      tmp.set(c.x + dx, c.y, c.z + dz).project(camera);
      if (tmp.z > 1) return null;
      out.push({ x: ((tmp.x + 1) / 2) * this.#width, y: ((1 - tmp.y) / 2) * this.#height });
    }
    return out;
  }

  #path(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }

  #fillCell(ctx: CanvasRenderingContext2D, camera: Camera, cell: OverlayCell, colour: string): void {
    const pts = this.#corners(camera, cell, 0.02);
    if (!pts) return;
    this.#path(ctx, pts);
    ctx.fillStyle = colour;
    ctx.fill();
  }

  #outlineCell(ctx: CanvasRenderingContext2D, camera: Camera, cell: OverlayCell, colour: string, width: number, dash: number[] = []): void {
    const pts = this.#corners(camera, cell);
    if (!pts) return;
    this.#path(ctx, pts);
    ctx.setLineDash(dash);
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  #badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, bg: string, fg: string): void {
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    const w = Math.max(20, ctx.measureText(text).width + 10);
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - 11, w, 22, 11);
    ctx.fill();
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 0.5);
  }

  #mark(ctx: CanvasRenderingContext2D, camera: Camera, cell: OverlayCell, kind: MarkKind, glyphs: boolean): void {
    switch (kind) {
      case 'spotted':
        this.#outlineCell(ctx, camera, cell, 'rgba(255,170,60,0.95)', 2.5, [3, 3]);
        return;
      case 'shield':
        this.#outlineCell(ctx, camera, cell, 'rgba(140,200,255,0.95)', 3);
        this.#glyph(ctx, camera, cell, '⛨', '#cfe8ff');
        return;
      case 'probe-unit':
        this.#outlineCell(ctx, camera, cell, 'rgba(255,170,60,0.95)', 2.5, [6, 3]);
        this.#glyph(ctx, camera, cell, '!', '#ffcf80');
        return;
      case 'probe-earth':
        this.#glyph(ctx, camera, cell, '·', '#e8dcc0');
        return;
      case 'probe-rock':
        this.#glyph(ctx, camera, cell, '◆', '#cfd6df');
        return;
      default:
        if (!glyphs) return;
        this.#glyph(ctx, camera, cell, kind === 'hit' ? '✓' : kind === 'rock' ? '◆' : '✗', kind === 'hit' ? '#ffd27a' : '#f0f4ff');
    }
  }

  #glyph(ctx: CanvasRenderingContext2D, camera: Camera, cell: OverlayCell, text: string, colour: string): void {
    const at = this.project(camera, cell.side, cell.col, cell.row, TILE_TOP + 0.05);
    if (!at) return;
    ctx.font = '700 15px "Segoe UI Symbol", "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, at.x, at.y);
    ctx.fillStyle = colour;
    ctx.fillText(text, at.x, at.y);
  }

  /** Letters and numbers outside each field; the hovered row and column light up. */
  #coordinates(ctx: CanvasRenderingContext2D, camera: Camera, state: OverlayState): void {
    const hover = state.hover;
    const { cols, rows } = state.field;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const side of ['own', 'enemy'] as const) {
      const outer = rows - 1 + 1.15;
      for (let col = 0; col < cols; col++) {
        const lit = hover?.side === side && hover.col === col;
        if (!state.coordinates && !lit) continue;
        const at = this.project(camera, side, col, outer);
        if (at) this.#label(ctx, at.x, at.y, columnLabel(col), lit);
      }
      for (let row = 0; row < rows; row++) {
        const lit = hover?.side === side && hover.row === row;
        if (!state.coordinates && !lit) continue;
        const left = this.project(camera, side, -1.1, row);
        const right = this.project(camera, side, cols + 0.1, row);
        if (left) this.#label(ctx, left.x, left.y, rowLabel(row), lit);
        if (right) this.#label(ctx, right.x, right.y, rowLabel(row), lit);
      }
    }
  }

  #label(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, lit: boolean): void {
    ctx.font = lit ? '800 15px "Segoe UI", system-ui, sans-serif' : '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = lit ? '#ffd36b' : 'rgba(244,233,212,0.85)';
    ctx.fillText(text, x, y);
  }
}

/** Cold-to-hot ramp; alpha grows with the chance so empty cells stay clean. */
export function heatColour(p: number): string {
  const v = Math.max(0, Math.min(1, p));
  const r = Math.round(60 + 195 * Math.min(1, v * 1.6));
  const g = Math.round(90 + 120 * Math.max(0, 1 - Math.abs(v - 0.5) * 2));
  const b = Math.round(220 * (1 - v));
  return `rgba(${r},${g},${b},${(0.18 + v * 0.5).toFixed(3)})`;
}
