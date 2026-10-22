import type { Coord, Rotation } from './types.ts';

export type RoleId =
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

/**
 * Placement rules a role may carry. They are checked by `LayoutBoard`:
 * - isolated: no other unit orthogonally adjacent (both ways);
 * - off-bank: no cell on the lake-bank row;
 * - near-rock: at least one cell orthogonally adjacent to rock;
 * - off-border: no cell on the outer border of the field;
 * - bank-only: every cell on the lake-bank row;
 * - near-support: adjacent to a bunker or an antenna (checked on confirm);
 * - rear: every cell on one of the `REAR_ROWS` rows farthest from the lake.
 */
export type PlacementRule = 'isolated' | 'off-bank' | 'near-rock' | 'off-border' | 'bank-only' | 'near-support' | 'rear';

export interface RoleDef {
  readonly id: RoleId;
  /** Name shown to players (pt-BR). */
  readonly name: string;
  /** Default shape as offsets from the top-left corner, before rotation. */
  readonly shape: readonly Coord[];
  /** Ranking used by the spy ability (higher = more valuable). */
  readonly value: number;
  readonly rules: readonly PlacementRule[];
}

const c = (col: number, row: number): Coord => ({ col, row });

export const ROLES: Readonly<Record<RoleId, RoleDef>> = {
  recruit: { id: 'recruit', name: 'Recruta', shape: [c(0, 0)], value: 1, rules: [] },
  sniper: { id: 'sniper', name: 'Atirador', shape: [c(0, 0)], value: 4, rules: ['isolated'] },
  armor: { id: 'armor', name: 'Blindado', shape: [c(0, 0), c(1, 0)], value: 2, rules: [] },
  artillery: { id: 'artillery', name: 'Artilharia', shape: [c(0, 0), c(1, 0), c(2, 0)], value: 8, rules: ['off-bank'] },
  antenna: { id: 'antenna', name: 'Antena', shape: [c(0, 0), c(0, 1), c(1, 1)], value: 9, rules: ['near-rock'] },
  bunker: { id: 'bunker', name: 'Bunker', shape: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)], value: 5, rules: ['off-border'] },
  amphibian: { id: 'amphibian', name: 'Anfíbio', shape: [c(0, 0), c(1, 0)], value: 3, rules: ['bank-only'] },
  generator: { id: 'generator', name: 'Gerador', shape: [c(0, 0)], value: 7, rules: ['near-support'] },
  workshop: { id: 'workshop', name: 'Oficina', shape: [c(0, 0), c(1, 0)], value: 6, rules: [] },
  // Faction piece, only in armies that bring it (the Greeks): it fires on its own every few turns.
  tower: { id: 'tower', name: 'Torre', shape: [c(0, 0)], value: 10, rules: ['rear'] },
};

/** Rows counted as "rear" by the tower rule. */
export const REAR_ROWS = 2;

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && value in ROLES;
}

/** Rotates a shape by quarter turns clockwise and moves it back to the origin. */
export function rotateShape(shape: readonly Coord[], rotation: Rotation): Coord[] {
  let cells = shape.map((cell) => ({ col: cell.col, row: cell.row }));
  for (let i = 0; i < rotation; i++) cells = cells.map(({ col, row }) => ({ col: -row, row: col }));
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  return cells
    .map((cell) => ({ col: cell.col - minCol, row: cell.row - minRow }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

export interface Orientation {
  readonly rotation: Rotation;
  readonly cells: readonly Coord[];
  readonly width: number;
  readonly height: number;
}

/** Distinct orientations of a shape (a 1×1 piece has one, a bar has two, the L has four). */
export function orientations(shape: readonly Coord[]): Orientation[] {
  const seen = new Set<string>();
  const out: Orientation[] = [];
  for (const rotation of [0, 1, 2, 3] as const) {
    const cells = rotateShape(shape, rotation);
    const key = cells.map((cell) => `${cell.col},${cell.row}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      rotation,
      cells,
      width: Math.max(...cells.map((cell) => cell.col)) + 1,
      height: Math.max(...cells.map((cell) => cell.row)) + 1,
    });
  }
  return out;
}
