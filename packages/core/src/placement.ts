import { shapeOf, type FieldConfig } from './config.ts';
import { BANK_ROW, isBorder, neighbors4, type GridSize } from './grid.ts';
import { REAR_ROWS, ROLES, orientations, rotateShape, type PlacementRule, type RoleId } from './roles.ts';
import { createRng, type Rng } from './rng.ts';
import type { Coord, Rotation, Terrain } from './types.ts';

/** One physical piece of a player's army. Ids look like "armor-2". */
export interface PieceSpec {
  readonly id: string;
  readonly role: RoleId;
  readonly shape: readonly Coord[];
}

/** Where a piece sits: the top-left corner of its rotated bounding box. */
export interface Placement {
  readonly pieceId: string;
  readonly anchor: Coord;
  readonly rotation: Rotation;
}

export type PlacementError =
  | 'unknown-piece'
  | 'bad-rotation'
  | 'out-of-bounds'
  | 'on-rock'
  | 'overlap'
  | 'isolation'
  | 'bank-row'
  | 'needs-rock'
  | 'border'
  | 'bank-only'
  | 'needs-support'
  | 'rear-only'
  | 'not-placed';

export interface LayoutIssue {
  readonly pieceId: string;
  readonly error: PlacementError;
}

const RULE_ERROR: Readonly<Record<PlacementRule, PlacementError>> = {
  isolated: 'isolation',
  'off-bank': 'bank-row',
  'near-rock': 'needs-rock',
  'off-border': 'border',
  'bank-only': 'bank-only',
  'near-support': 'needs-support',
  rear: 'rear-only',
};

/** Roles a generator can lean on. */
export const SUPPORT_ROLES: readonly RoleId[] = ['bunker', 'antenna'];

export function buildPieces(config: FieldConfig): PieceSpec[] {
  const pieces: PieceSpec[] = [];
  const seen = new Map<RoleId, number>();
  for (const spec of config.units) {
    for (let i = 0; i < spec.count; i++) {
      const n = (seen.get(spec.role) ?? 0) + 1;
      seen.set(spec.role, n);
      pieces.push({ id: `${spec.role}-${n}`, role: spec.role, shape: shapeOf(spec) });
    }
  }
  return pieces;
}

function isRotation(value: unknown): value is Rotation {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export type CheckResult = { readonly ok: true; readonly cells: number[] } | { readonly ok: false; readonly error: PlacementError };

/**
 * Mutable layout of one field. Used by the match, by `autoPlace` and by bots
 * that plan their own layout; it only knows the owner's side.
 */
export class LayoutBoard {
  readonly size: GridSize;
  readonly terrain: readonly Terrain[];
  readonly pieces: readonly PieceSpec[];
  /** Slot of the piece on each cell, or -1. */
  readonly occupant: Int16Array;
  readonly #placements: (Placement | null)[];
  readonly #cells: number[][];
  readonly #shapes: Coord[][][];

  constructor(size: GridSize, terrain: readonly Terrain[], pieces: readonly PieceSpec[]) {
    this.size = size;
    this.terrain = terrain;
    this.pieces = pieces;
    this.occupant = new Int16Array(size.cols * size.rows).fill(-1);
    this.#placements = pieces.map(() => null);
    this.#cells = pieces.map(() => []);
    this.#shapes = pieces.map((piece) => ([0, 1, 2, 3] as const).map((r) => rotateShape(piece.shape, r)));
  }

  slotOf(pieceId: string): number {
    return this.pieces.findIndex((piece) => piece.id === pieceId);
  }

  placementOf(slot: number): Placement | null {
    return this.#placements[slot] ?? null;
  }

  cellsOf(slot: number): readonly number[] {
    return this.#cells[slot] ?? [];
  }

  roleAt(index: number): RoleId | null {
    const slot = this.occupant[index] ?? -1;
    return slot >= 0 ? (this.pieces[slot]?.role ?? null) : null;
  }

  /** Cell indices a piece would cover, or null when it leaves the board. */
  footprint(slot: number, anchor: Coord, rotation: Rotation): number[] | null {
    const shape = this.#shapes[slot]?.[rotation];
    if (!shape || !Number.isInteger(anchor.col) || !Number.isInteger(anchor.row)) return null;
    const out: number[] = [];
    for (const offset of shape) {
      const col = anchor.col + offset.col;
      const row = anchor.row + offset.row;
      if (col < 0 || row < 0 || col >= this.size.cols || row >= this.size.rows) return null;
      out.push(row * this.size.cols + col);
    }
    return out;
  }

  /**
   * Validates a piece at a position against terrain, other pieces and the role
   * rules. The generator support rule only runs with `requireSupport`, because
   * players may place the generator before its bunker or antenna.
   */
  check(slot: number, anchor: Coord, rotation: Rotation, options: { requireSupport?: boolean } = {}): CheckResult {
    const piece = this.pieces[slot];
    if (!piece) return { ok: false, error: 'unknown-piece' };
    if (!isRotation(rotation)) return { ok: false, error: 'bad-rotation' };
    const cells = this.footprint(slot, anchor, rotation);
    if (!cells) return { ok: false, error: 'out-of-bounds' };

    for (const index of cells) {
      if (this.terrain[index] === 'rock') return { ok: false, error: 'on-rock' };
      const other = this.occupant[index] ?? -1;
      if (other >= 0 && other !== slot) return { ok: false, error: 'overlap' };
    }

    const rules = ROLES[piece.role].rules;
    const own = new Set(cells);
    for (const index of cells) {
      for (const n of neighbors4(this.size, index)) {
        if (own.has(n)) continue;
        const other = this.occupant[n] ?? -1;
        if (other < 0 || other === slot) continue;
        const otherRole = this.pieces[other]?.role;
        if (rules.includes('isolated') || (otherRole && ROLES[otherRole].rules.includes('isolated'))) {
          return { ok: false, error: 'isolation' };
        }
      }
    }

    for (const rule of rules) {
      if (!this.#ruleHolds(rule, cells, slot, options.requireSupport ?? false)) return { ok: false, error: RULE_ERROR[rule] };
    }
    return { ok: true, cells };
  }

  #ruleHolds(rule: PlacementRule, cells: readonly number[], slot: number, requireSupport: boolean): boolean {
    const cols = this.size.cols;
    switch (rule) {
      case 'isolated':
        return true; // handled with the neighbour scan above
      case 'off-bank':
        return cells.every((i) => Math.floor(i / cols) !== BANK_ROW);
      case 'bank-only':
        return cells.every((i) => Math.floor(i / cols) === BANK_ROW);
      case 'off-border':
        return cells.every((i) => !isBorder(this.size, { col: i % cols, row: Math.floor(i / cols) }));
      case 'rear':
        return cells.every((i) => Math.floor(i / cols) >= this.size.rows - REAR_ROWS);
      case 'near-rock':
        return cells.some((i) => neighbors4(this.size, i).some((n) => this.terrain[n] === 'rock'));
      case 'near-support':
        if (!requireSupport) return true;
        return cells.some((i) =>
          neighbors4(this.size, i).some((n) => {
            const other = this.occupant[n] ?? -1;
            const role = other >= 0 && other !== slot ? this.pieces[other]?.role : undefined;
            return role !== undefined && SUPPORT_ROLES.includes(role);
          }),
        );
    }
  }

  /** Places (or moves) a piece after validating it. */
  place(slot: number, anchor: Coord, rotation: Rotation): PlacementError | null {
    const result = this.check(slot, anchor, rotation);
    if (!result.ok) return result.error;
    this.put(slot, anchor, rotation, result.cells);
    return null;
  }

  /** Writes an already checked position. */
  put(slot: number, anchor: Coord, rotation: Rotation, cells: readonly number[]): void {
    this.clear(slot);
    const piece = this.pieces[slot];
    if (!piece) return;
    for (const index of cells) this.occupant[index] = slot;
    this.#cells[slot] = [...cells];
    this.#placements[slot] = { pieceId: piece.id, anchor: { col: anchor.col, row: anchor.row }, rotation };
  }

  clear(slot: number): void {
    for (const index of this.#cells[slot] ?? []) this.occupant[index] = -1;
    this.#cells[slot] = [];
    this.#placements[slot] = null;
  }

  clearAll(): void {
    for (let slot = 0; slot < this.pieces.length; slot++) this.clear(slot);
  }

  placements(): Placement[] {
    return this.#placements.filter((p): p is Placement => p !== null);
  }

  get complete(): boolean {
    return this.#placements.every((p) => p !== null);
  }

  /** Everything that still blocks a confirm, in piece order. */
  issues(): LayoutIssue[] {
    const issues: LayoutIssue[] = [];
    this.pieces.forEach((piece, slot) => {
      const placement = this.#placements[slot];
      if (!placement) {
        issues.push({ pieceId: piece.id, error: 'not-placed' });
        return;
      }
      const result = this.check(slot, placement.anchor, placement.rotation, { requireSupport: true });
      if (!result.ok) issues.push({ pieceId: piece.id, error: result.error });
    });
    return issues;
  }

  /** Applies a whole layout; returns the first problem found. */
  applyLayout(placements: readonly Placement[]): LayoutIssue | null {
    this.clearAll();
    const seen = new Set<string>();
    for (const placement of placements) {
      const slot = this.slotOf(placement.pieceId);
      if (slot < 0 || seen.has(placement.pieceId)) return { pieceId: placement.pieceId, error: 'unknown-piece' };
      seen.add(placement.pieceId);
      const error = this.place(slot, placement.anchor, placement.rotation);
      if (error) return { pieceId: placement.pieceId, error };
    }
    return this.issues()[0] ?? null;
  }
}

/** Order in which `autoPlace` handles roles: the pickiest first. */
const AUTO_ORDER: readonly RoleId[] = [
  'bunker',
  'antenna',
  'tower',
  'amphibian',
  'generator',
  'artillery',
  'sniper',
  'workshop',
  'armor',
  'recruit',
];

export interface AutoPlaceOptions {
  /** Relative preference for a candidate position; 0 rules it out. Default: uniform. */
  readonly weight?: (piece: PieceSpec, cells: readonly number[], board: LayoutBoard) => number;
  /** Restarts before giving up. */
  readonly attempts?: number;
}

export interface Candidate {
  readonly anchor: Coord;
  readonly rotation: Rotation;
  readonly cells: number[];
}

/** Every legal spot for a piece on the current board (support rule included). */
export function candidatesFor(board: LayoutBoard, slot: number): Candidate[] {
  const piece = board.pieces[slot];
  if (!piece) return [];
  const out: Candidate[] = [];
  for (const orientation of orientations(piece.shape)) {
    for (let row = 0; row + orientation.height <= board.size.rows; row++) {
      for (let col = 0; col + orientation.width <= board.size.cols; col++) {
        const anchor = { col, row };
        const result = board.check(slot, anchor, orientation.rotation, { requireSupport: true });
        if (result.ok) out.push({ anchor, rotation: orientation.rotation, cells: result.cells });
      }
    }
  }
  return out;
}

/** Fills the board with a random legal layout. Deterministic for a given rng state. */
export function autoPlace(
  size: GridSize,
  terrain: readonly Terrain[],
  pieces: readonly PieceSpec[],
  rng: Rng,
  options: AutoPlaceOptions = {},
): Placement[] {
  const board = new LayoutBoard(size, terrain, pieces);
  const order = pieces
    .map((piece, slot) => ({ slot, rank: AUTO_ORDER.indexOf(piece.role) }))
    .sort((a, b) => a.rank - b.rank || a.slot - b.slot)
    .map((entry) => entry.slot);
  const attempts = options.attempts ?? 200;

  for (let attempt = 0; attempt < attempts; attempt++) {
    board.clearAll();
    let failed = false;
    for (const slot of order) {
      const piece = pieces[slot] as PieceSpec;
      const candidates = candidatesFor(board, slot);
      if (candidates.length === 0) {
        failed = true;
        break;
      }
      const choice = pickWeighted(candidates, rng, options.weight ? (c) => options.weight!(piece, c.cells, board) : null);
      board.put(slot, choice.anchor, choice.rotation, choice.cells);
    }
    if (!failed && board.issues().length === 0) return board.placements();
  }
  throw new Error('autoPlace could not find a legal layout');
}

function pickWeighted<T>(items: readonly T[], rng: Rng, weight: ((item: T) => number) | null): T {
  if (!weight) return rng.pick(items);
  const weights = items.map((item) => Math.max(0, weight(item)));
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return rng.pick(items);
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i] as number;
    if (roll < 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

/**
 * Scatters the rocks of one field. Terrain comes before placement (players see
 * their own rocks while placing), so a draw that leaves no legal layout is
 * thrown away and redrawn from the same stream.
 */
export function generateTerrain(size: GridSize, rocks: number, pieces: readonly PieceSpec[], rng: Rng): Terrain[] {
  const total = size.cols * size.rows;
  for (let attempt = 0; attempt < 100; attempt++) {
    const order = rng.shuffle(Array.from({ length: total }, (_, i) => i));
    const terrain: Terrain[] = Array.from({ length: total }, () => 'earth');
    for (let i = 0; i < rocks; i++) terrain[order[i] as number] = 'rock';
    const probe = createRng(rng.int(0x7fffffff));
    try {
      autoPlace(size, terrain, pieces, probe, { attempts: 40 });
      return terrain;
    } catch {
      // unlucky rocks: draw again
    }
  }
  throw new Error('Could not generate a playable terrain');
}
