import { Vector3 } from 'three';

/** Board dimensions in world units (one cell = one unit). */
export const COLS = 25;
export const ROWS = 7;
export const CELL = 1;
export const LAKE_WIDTH = 3.2;

export const TILE_SIZE = 0.92;
export const TILE_HEIGHT = 0.2;
export const TILE_TOP = TILE_HEIGHT;
export const WATER_LEVEL = 0.07;

export const FRAME_BORDER = 1.55;
export const FRAME_TOP = 0.42;
/** Height of the table the board rests on. */
export const TABLE_Y = -0.35;
export const PLATE_MARGIN = 0.18;

export const FIELD_HALF_WIDTH = (COLS * CELL) / 2;
export const FIELD_INNER_Z = LAKE_WIDTH / 2;
export const FIELD_OUTER_Z = FIELD_INNER_Z + ROWS * CELL;

/** Inner edge of the frame (the playable plate). */
export const PLATE_HALF_X = FIELD_HALF_WIDTH + PLATE_MARGIN;
export const PLATE_HALF_Z = FIELD_OUTER_Z + PLATE_MARGIN;

export const OUTER_HALF_X = PLATE_HALF_X + FRAME_BORDER;
export const OUTER_HALF_Z = PLATE_HALF_Z + FRAME_BORDER;

/** Deepest point of the river bed below the plate top. */
export const RIVER_DEPTH = 0.3;

/** Height of the river bed at a given z (0 at the banks, -RIVER_DEPTH mid-stream). */
export function riverBedY(z: number): number {
  const t = Math.min(1, Math.abs(z) / (FIELD_INNER_Z + 0.02));
  return -RIVER_DEPTH * (1 - t * t) * (1 - 0.15 * t);
}

/** Inner edges of the river, kept clear of the bank stones. */
export const RIVER_SWIM_Z = FIELD_INNER_Z - 0.35;
export const RIVER_SWIM_X = FIELD_HALF_WIDTH - 0.3;

/** `own` is the near field (z > 0), `enemy` sits across the lake. */
export type Side = 'own' | 'enemy';

export function sideSign(side: Side): number {
  return side === 'own' ? 1 : -1;
}

/** Row 0 is the front line next to the lake. */
export function cellX(col: number): number {
  return (col - (COLS - 1) / 2) * CELL;
}

export function cellZ(side: Side, row: number): number {
  return sideSign(side) * (FIELD_INNER_Z + (row + 0.5) * CELL);
}

export function cellCenter(side: Side, col: number, row: number, y = TILE_TOP): Vector3 {
  return new Vector3(cellX(col), y, cellZ(side, row));
}

export function cellIndexOf(col: number, row: number): number {
  return row * COLS + col;
}

export function columnLabel(col: number): string {
  return String.fromCharCode(65 + col);
}

export function rowLabel(row: number): string {
  return String(row + 1);
}
