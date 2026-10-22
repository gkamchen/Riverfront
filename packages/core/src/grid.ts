import type { Coord } from './types.ts';

/** Row 0 is the front line, right on the lake bank. */
export const BANK_ROW = 0;

export interface GridSize {
  readonly cols: number;
  readonly rows: number;
}

export function indexOf(size: GridSize, coord: Coord): number {
  return coord.row * size.cols + coord.col;
}

export function coordOf(size: GridSize, index: number): Coord {
  return { col: index % size.cols, row: Math.floor(index / size.cols) };
}

export function isInside(size: GridSize, coord: Coord): boolean {
  return (
    Number.isInteger(coord.col) &&
    Number.isInteger(coord.row) &&
    coord.col >= 0 &&
    coord.row >= 0 &&
    coord.col < size.cols &&
    coord.row < size.rows
  );
}

export function isBorder(size: GridSize, coord: Coord): boolean {
  return coord.col === 0 || coord.row === 0 || coord.col === size.cols - 1 || coord.row === size.rows - 1;
}

/** Orthogonal neighbours. "Adjacent" always means this in the rules. */
export function neighbors4(size: GridSize, index: number): number[] {
  const col = index % size.cols;
  const row = Math.floor(index / size.cols);
  const out: number[] = [];
  if (col > 0) out.push(index - 1);
  if (col < size.cols - 1) out.push(index + 1);
  if (row > 0) out.push(index - size.cols);
  if (row < size.rows - 1) out.push(index + size.cols);
  return out;
}

/** The 3×3 block around a cell, clipped to the board. */
export function block3x3(size: GridSize, index: number): number[] {
  const { col, row } = coordOf(size, index);
  const out: number[] = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if (c >= 0 && r >= 0 && c < size.cols && r < size.rows) out.push(r * size.cols + c);
    }
  }
  return out;
}

/** Centre plus its orthogonal neighbours: the bomb pattern. */
export function plusShape(size: GridSize, index: number): number[] {
  return [index, ...neighbors4(size, index)];
}

export type LineAxis = 'row' | 'col';

export function lineCells(size: GridSize, axis: LineAxis, line: number): number[] {
  const out: number[] = [];
  if (axis === 'row') for (let c = 0; c < size.cols; c++) out.push(line * size.cols + c);
  else for (let r = 0; r < size.rows; r++) out.push(r * size.cols + line);
  return out;
}

export function cellLabel(coord: Coord): string {
  return `${String.fromCharCode(65 + coord.col)}${coord.row + 1}`;
}
