import {
  LayoutBoard,
  autoPlace,
  buildPieces,
  candidatesFor,
  createRng,
  rotateShape,
  type Coord,
  type PieceSpec,
  type Placement,
  type PlacementError,
  type PlayerView,
  type Rotation,
  type Terrain,
} from '@riverfront/core';

export interface Held {
  readonly slot: number;
  readonly rotation: Rotation;
  /** Where it was before being picked up (null for a piece from the tray). */
  readonly from: Placement | null;
}

export interface Preview {
  readonly slot: number;
  readonly anchor: Coord;
  readonly rotation: Rotation;
  /** Cells on the board the piece would cover (cells off the board are dropped). */
  readonly cells: readonly Coord[];
  readonly ok: boolean;
  readonly error: PlacementError | null;
}

/**
 * The player's layout while placing. Wraps the core's `LayoutBoard`, so every
 * check (rocks, overlap, role rules) is exactly the one the match applies.
 */
export class PlacementEditor {
  readonly board: LayoutBoard;
  readonly pieces: readonly PieceSpec[];
  readonly cols: number;
  readonly rows: number;
  /** Pieces this player may move (doubles: the partner's are locked); null = all. */
  readonly owned: ReadonlySet<string> | null;
  #held: Held | null = null;
  #version = 0;

  constructor(view: PlayerView, owned: ReadonlySet<string> | null = null) {
    this.owned = owned;
    this.cols = view.config.cols;
    this.rows = view.config.rows;
    const terrain: Terrain[] = Array.from({ length: this.cols * this.rows }, () => 'earth');
    for (const cell of view.own.cells) terrain[cell.row * this.cols + cell.col] = cell.terrain;
    this.pieces = buildPieces({ ...view.config, units: view.own.units ?? view.config.units });
    this.board = new LayoutBoard({ cols: this.cols, rows: this.rows }, terrain, this.pieces);
    const placed = view.own.pieces.map((p) => p.placement).filter((p): p is Placement => p !== null);
    if (placed.length > 0) this.board.applyLayout(placed);
  }

  /** Bumps on every change, so callers can redraw only when needed. */
  get version(): number {
    return this.#version;
  }

  get held(): Held | null {
    return this.#held;
  }

  get complete(): boolean {
    return this.pieces.every((_, slot) => !this.mine(slot) || this.board.placementOf(slot) !== null);
  }

  /** May the player move this piece? */
  mine(slot: number): boolean {
    const piece = this.pieces[slot];
    return !!piece && (this.owned === null || this.owned.has(piece.id));
  }

  placements(): Placement[] {
    return this.board.placements();
  }

  /** Problems that block a confirm, only for the player's own pieces. */
  issues(): ReturnType<LayoutBoard['issues']> {
    return this.board.issues().filter((i) => this.owned === null || this.owned.has(i.pieceId));
  }

  isPlaced(slot: number): boolean {
    return this.board.placementOf(slot) !== null;
  }

  slotAt(col: number, row: number): number {
    return this.board.occupant[row * this.cols + col] ?? -1;
  }

  /** Takes a piece from the tray (or lifts it off the board). */
  pick(slot: number): boolean {
    const piece = this.pieces[slot];
    if (!piece || !this.mine(slot)) return false;
    if (this.#held) this.cancel();
    const from = this.board.placementOf(slot);
    if (from) this.board.clear(slot);
    this.#held = { slot, rotation: from?.rotation ?? 0, from };
    this.#version++;
    return true;
  }

  /** Lifts whatever piece covers a cell. */
  pickAt(col: number, row: number): boolean {
    const slot = this.slotAt(col, row);
    return slot >= 0 ? this.pick(slot) : false;
  }

  rotateHeld(): void {
    if (!this.#held) return;
    const shape = this.pieces[this.#held.slot]!.shape;
    // Skip orientations that look the same (a 1x1 piece has one, a bar has two).
    const key = (r: Rotation) => JSON.stringify(rotateShape(shape, r));
    let next = this.#held.rotation;
    for (let i = 0; i < 4; i++) {
      next = ((next + 1) % 4) as Rotation;
      if (key(next) !== key(this.#held.rotation) || i === 3) break;
    }
    this.#held = { ...this.#held, rotation: next };
    this.#version++;
  }

  /** Anchor so that the piece is centred on the cell under the pointer. */
  anchorFor(slot: number, rotation: Rotation, cell: Coord): Coord {
    const shape = rotateShape(this.pieces[slot]!.shape, rotation);
    const width = Math.max(...shape.map((c) => c.col)) + 1;
    const height = Math.max(...shape.map((c) => c.row)) + 1;
    return { col: cell.col - Math.floor((width - 1) / 2), row: cell.row - Math.floor((height - 1) / 2) };
  }

  preview(cell: Coord): Preview | null {
    const held = this.#held;
    if (!held) return null;
    const anchor = this.anchorFor(held.slot, held.rotation, cell);
    const shape = rotateShape(this.pieces[held.slot]!.shape, held.rotation);
    const cells = shape
      .map((o) => ({ col: anchor.col + o.col, row: anchor.row + o.row }))
      .filter((c) => c.col >= 0 && c.row >= 0 && c.col < this.cols && c.row < this.rows);
    const check = this.board.check(held.slot, anchor, held.rotation);
    return { slot: held.slot, anchor, rotation: held.rotation, cells, ok: check.ok, error: check.ok ? null : check.error };
  }

  /** Drops the held piece centred on `cell`. Returns the rule it broke, if any. */
  drop(cell: Coord): PlacementError | null {
    const held = this.#held;
    if (!held) return null;
    const anchor = this.anchorFor(held.slot, held.rotation, cell);
    const error = this.board.place(held.slot, anchor, held.rotation);
    if (error) return error;
    this.#held = null;
    this.#version++;
    return null;
  }

  /** Puts the held piece back where it was (or back in the tray). */
  cancel(): void {
    const held = this.#held;
    if (!held) return;
    this.#held = null;
    if (held.from) this.board.place(held.slot, held.from.anchor, held.from.rotation);
    this.#version++;
  }

  /** Rotates a piece already on the board in place, if the new orientation fits. */
  rotatePlaced(slot: number): PlacementError | null {
    const current = this.board.placementOf(slot);
    if (!current) return 'not-placed';
    const next = ((current.rotation + 1) % 4) as Rotation;
    const error = this.board.place(slot, current.anchor, next);
    if (!error) this.#version++;
    return error;
  }

  removeAll(): void {
    this.#held = null;
    this.pieces.forEach((_, slot) => {
      if (this.mine(slot)) this.board.clear(slot);
    });
    this.#version++;
  }

  /** Fills the field with a random legal layout. */
  auto(seed: number): void {
    this.#held = null;
    const rng = createRng(seed >>> 0);
    if (this.owned === null) {
      this.board.applyLayout(autoPlace(this.board.size, this.board.terrain, this.pieces, rng));
    } else {
      // Doubles: place only our pieces around whatever the partner already placed.
      const slots = this.pieces.map((p, slot) => ({ p, slot })).filter((x) => this.mine(x.slot));
      slots.sort((a, b) => supportRank(a.p) - supportRank(b.p) || b.p.shape.length - a.p.shape.length);
      for (let attempt = 0; attempt < 200; attempt++) {
        for (const { slot } of slots) this.board.clear(slot);
        let ok = true;
        for (const { slot } of slots) {
          const options = candidatesFor(this.board, slot);
          if (options.length === 0) {
            ok = false;
            break;
          }
          const c = rng.pick(options);
          this.board.put(slot, c.anchor, c.rotation, c.cells);
        }
        if (ok) break;
      }
    }
    this.#version++;
  }
}

/** Bunker and antenna first, the generator right after (it must touch one of them). */
function supportRank(piece: PieceSpec): number {
  return piece.role === 'bunker' || piece.role === 'antenna' ? 0 : piece.role === 'generator' ? 1 : 2;
}
