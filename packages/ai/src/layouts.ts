import {
  autoPlace,
  buildPieces,
  isBorder,
  neighbors4,
  type LayoutBoard,
  type PieceSpec,
  type Placement,
  type PlayerView,
  type Rng,
} from '@riverfront/core';

/** Preferences for building a layout; every factor is optional. */
export interface LayoutStyle {
  /** 0..1: how much to avoid the outer border. */
  readonly borderPenalty?: number;
  /** 0..1 per touching cell: how much to avoid touching other pieces. */
  readonly touchPenalty?: number;
  /** Extra weight per touching cell (bunching pieces together). */
  readonly touchBonus?: number;
  /** Per-cell factor (mean ≈ 1) of how likely a hunter looks there, and how strongly to avoid it. */
  readonly avoid?: Float64Array | null;
  readonly avoidPower?: number;
  /** Pieces placed where hunters look first, on purpose. */
  readonly baitPieces?: readonly string[];
}

/** Builds a legal layout from the bot's own view only (its own rocks). */
export function planLayout(view: PlayerView, rng: Rng, style: LayoutStyle = {}): Placement[] {
  const size = { cols: view.config.cols, rows: view.config.rows };
  const terrain = view.own.cells.map((c) => c.terrain);
  // The own army may carry faction pieces on top of the preset.
  const pieces = buildPieces({ ...view.config, units: view.own.units ?? view.config.units });
  const weight = (piece: PieceSpec, cells: readonly number[], board: LayoutBoard): number => {
    let w = 1;
    if (style.borderPenalty) {
      const onBorder = cells.some((i) => isBorder(size, { col: i % size.cols, row: Math.floor(i / size.cols) }));
      if (onBorder) w *= 1 - style.borderPenalty;
    }
    if (style.touchPenalty || style.touchBonus) {
      const own = new Set(cells);
      let touching = 0;
      for (const i of cells) for (const n of neighbors4(size, i)) if (!own.has(n) && (board.occupant[n] ?? -1) >= 0) touching++;
      if (style.touchPenalty) w *= Math.pow(1 - style.touchPenalty, touching);
      if (style.touchBonus) w *= 1 + style.touchBonus * touching;
    }
    if (style.avoid) {
      const mean = cells.reduce((s, i) => s + (style.avoid![i] ?? 1), 0) / cells.length;
      const sign = style.baitPieces?.includes(piece.id) ? -1 : 1;
      w *= Math.exp(-sign * (style.avoidPower ?? 1) * (mean - 1));
    }
    return w;
  };
  return autoPlace(size, terrain, pieces, rng, { weight });
}
