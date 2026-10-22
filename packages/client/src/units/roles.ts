/**
 * Unit roles as the client draws them. The ids match the core's `RoleId`; the
 * shapes are repeated here so the renderer does not depend on rule internals.
 */
export type UnitRole =
  | 'recruit'
  | 'sniper'
  | 'armor'
  | 'artillery'
  | 'antenna'
  | 'bunker'
  | 'amphibian'
  | 'generator'
  | 'workshop'
  | 'tower';

export type TeamId = 'blue' | 'red';

/** Quarter turns clockwise, same convention as the core. */
export type QuarterTurns = 0 | 1 | 2 | 3;

export interface CellOffset {
  readonly col: number;
  readonly row: number;
}

const c = (col: number, row: number): CellOffset => ({ col, row });

export const UNIT_ROLES: readonly UnitRole[] = [
  'recruit',
  'sniper',
  'armor',
  'artillery',
  'antenna',
  'bunker',
  'amphibian',
  'generator',
  'workshop',
  'tower',
];

/** Default footprint of every role, before rotation. */
export const ROLE_SHAPES: Readonly<Record<UnitRole, readonly CellOffset[]>> = {
  recruit: [c(0, 0)],
  sniper: [c(0, 0)],
  armor: [c(0, 0), c(1, 0)],
  artillery: [c(0, 0), c(1, 0), c(2, 0)],
  antenna: [c(0, 0), c(0, 1), c(1, 1)],
  bunker: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)],
  amphibian: [c(0, 0), c(1, 0)],
  generator: [c(0, 0)],
  workshop: [c(0, 0), c(1, 0)],
  // Automatic tower: one cell, only in the rear rows (the core enforces it).
  tower: [c(0, 0)],
};

/** Display names (pt-BR) for galleries and tooltips. */
export const ROLE_LABELS: Readonly<Record<UnitRole, string>> = {
  recruit: 'Recruta',
  sniper: 'Atirador',
  armor: 'Blindado',
  artillery: 'Artilharia',
  antenna: 'Antena',
  bunker: 'Bunker',
  amphibian: 'Anfíbio',
  generator: 'Gerador',
  workshop: 'Oficina',
  tower: 'Torre',
};

/** Old unit ids of the first prototype ('tower' is now a role of its own). */
type LegacyUnitType = 'soldier' | 'tank';

const LEGACY_ROLE_MAP: Readonly<Record<LegacyUnitType, UnitRole>> = {
  soldier: 'recruit',
  tank: 'armor',
};

function isUnitRole(value: unknown): value is UnitRole {
  return typeof value === 'string' && value in ROLE_SHAPES;
}

/** Accepts a role id or one of the legacy ids; unknown values fall back to a recruit. */
export function resolveRole(id: string): UnitRole {
  if (isUnitRole(id)) return id;
  return LEGACY_ROLE_MAP[id as LegacyUnitType] ?? 'recruit';
}

/** Rotates a shape clockwise by quarter turns and moves it back to the origin. */
export function rotateOffsets(shape: readonly CellOffset[], turns: QuarterTurns): CellOffset[] {
  let cells = shape.map((cell) => ({ col: cell.col, row: cell.row }));
  for (let i = 0; i < turns; i++) cells = cells.map(({ col, row }) => ({ col: -row, row: col }));
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  return cells.map((cell) => ({ col: cell.col - minCol, row: cell.row - minRow }));
}

export function shapeCentroid(shape: readonly CellOffset[]): { col: number; row: number } {
  let col = 0;
  let row = 0;
  for (const cell of shape) {
    col += cell.col;
    row += cell.row;
  }
  return { col: col / shape.length, row: row / shape.length };
}

/** Width/height in cells of the unrotated shape. */
export function shapeExtent(shape: readonly CellOffset[]): { cols: number; rows: number } {
  return {
    cols: Math.max(...shape.map((cell) => cell.col)) + 1,
    rows: Math.max(...shape.map((cell) => cell.row)) + 1,
  };
}

/**
 * Recovers origin and rotation from the absolute cells a piece covers (for
 * views that only list cells). Returns null if the cells do not match the role.
 */
export function inferPlacement(role: UnitRole, cells: readonly CellOffset[]): { origin: CellOffset; rotation: QuarterTurns } | null {
  if (cells.length === 0) return null;
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const key = (list: readonly CellOffset[]) =>
    list
      .map((cell) => `${cell.col},${cell.row}`)
      .sort()
      .join(';');
  const target = key(cells.map((cell) => ({ col: cell.col - minCol, row: cell.row - minRow })));
  for (const rotation of [0, 1, 2, 3] as const) {
    if (key(rotateOffsets(ROLE_SHAPES[role], rotation)) === target) return { origin: { col: minCol, row: minRow }, rotation };
  }
  return null;
}

/** Absolute cells a role covers when anchored at `origin` with a rotation. */
export function footprintCells(role: UnitRole, origin: CellOffset, turns: QuarterTurns = 0): CellOffset[] {
  return rotateOffsets(ROLE_SHAPES[role], turns).map((cell) => ({ col: origin.col + cell.col, row: origin.row + cell.row }));
}
