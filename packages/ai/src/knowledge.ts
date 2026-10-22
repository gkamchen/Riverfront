import {
  REAR_ROWS,
  ROLES,
  block3x3,
  isBorder,
  lineCells,
  neighbors4,
  orientations,
  shapeOf,
  unitCellCount,
  type Coord,
  type FieldConfig,
  type GridSize,
  type PlayerView,
  type RoleId,
} from '@riverfront/core';

/** What a bot believes about one enemy cell. Everything comes from the public view. */
export const UNKNOWN = 0;
export const EMPTY = 1;
export const ROCK = 2;
export const HIT = 3;
export const SPOTTED = 4;
export const DEAD = 5;

export interface PieceKind {
  readonly role: RoleId;
  readonly shape: readonly Coord[];
  /** Pieces of this kind still standing. */
  readonly count: number;
}

/** One way a piece can lie on the board, with the cells around it. */
export interface Footprint {
  readonly cells: readonly number[];
  readonly ring: readonly number[];
}

const footprintCache = new Map<string, Footprint[]>();

/** All positions of a shape that respect the static role rules (rows and borders). */
export function footprints(size: GridSize, role: RoleId, shape: readonly Coord[]): Footprint[] {
  const key = `${size.cols}x${size.rows}:${role}:${shape.map((c) => `${c.col},${c.row}`).join(';')}`;
  const cached = footprintCache.get(key);
  if (cached) return cached;

  const rules = ROLES[role].rules;
  const out: Footprint[] = [];
  for (const o of orientations(shape)) {
    for (let row = 0; row + o.height <= size.rows; row++) {
      for (let col = 0; col + o.width <= size.cols; col++) {
        const coords = o.cells.map((c) => ({ col: col + c.col, row: row + c.row }));
        if (rules.includes('bank-only') && coords.some((c) => c.row !== 0)) continue;
        if (rules.includes('off-bank') && coords.some((c) => c.row === 0)) continue;
        if (rules.includes('off-border') && coords.some((c) => isBorder(size, c))) continue;
        if (rules.includes('rear') && coords.some((c) => c.row < size.rows - REAR_ROWS)) continue;
        const cells = coords.map((c) => c.row * size.cols + c.col);
        const own = new Set(cells);
        const ring = new Set<number>();
        for (const cell of cells) for (const n of neighbors4(size, cell)) if (!own.has(n)) ring.add(n);
        out.push({ cells, ring: [...ring] });
      }
    }
  }
  footprintCache.set(key, out);
  return out;
}

/**
 * Remembers things the view alone forgets: a repaired cell goes back to
 * "hidden", but whoever hit it knows a unit is still there; under fog, old
 * misses fade from the map but a good memory keeps them.
 */
export class ViewMemory {
  #hits = new Set<number>();
  #seen = new Map<number, 'earth' | 'rock'>();
  #history = 0;
  readonly keepsFog: boolean;

  constructor(keepsFog = true) {
    this.keepsFog = keepsFog;
  }

  reset(): void {
    this.#hits.clear();
    this.#seen.clear();
    this.#history = 0;
  }

  observe(view: PlayerView): void {
    if (view.history.length < this.#history) this.reset();
    this.#history = view.history.length;
    view.enemy.cells.forEach((cell, i) => {
      if (cell.state === 'hit') this.#hits.add(i);
      else if (cell.state === 'earth' || cell.state === 'rock') this.#seen.set(i, cell.state);
    });
  }

  /** Cells this bot once hit that now look hidden again (repaired). */
  repaired(view: PlayerView): number[] {
    const out: number[] = [];
    for (const i of this.#hits) if (view.enemy.cells[i]?.state === 'hidden') out.push(i);
    return out;
  }

  /** Misses that faded under fog, if this memory keeps them. */
  faded(view: PlayerView): [number, 'earth' | 'rock'][] {
    if (!this.keepsFog || !view.mutators?.fog) return [];
    const out: [number, 'earth' | 'rock'][] = [];
    for (const [i, terrain] of this.#seen) if (view.enemy.cells[i]?.state === 'hidden') out.push([i, terrain]);
    return out;
  }
}

export interface RadarSoft {
  readonly center: number;
  readonly count: number;
  readonly cells: readonly number[];
  /** The count includes amphibians. */
  readonly amphibians: boolean;
}

/** Snapshot of the public knowledge about the enemy field, ready for inference. */
export class Knowledge {
  readonly size: GridSize;
  readonly n: number;
  readonly config: FieldConfig;
  readonly status: Uint8Array;
  /** Role of each destroyed cell (or null). */
  readonly deadRole: (RoleId | null)[];
  readonly shieldMark: Uint8Array;
  readonly shieldActive: boolean;
  readonly remaining: readonly PieceKind[];
  /** Cells that cannot hold a non-amphibian unit (radar said zero). */
  readonly radarEmpty: Uint8Array;
  /** Cells that cannot hold any unit, amphibians included (a radar that saw amphibians said zero). */
  readonly radarEmptyAll: Uint8Array;
  /** Cells under water right now (tide): direct shots there are refused. */
  readonly submerged: Uint8Array;
  /** Every cell left to shoot is under water, so shots there are allowed (and fizzle). */
  readonly wetOnly: boolean;
  /** The water covers the bank before our next turn: shots there are worth more now. */
  readonly bankUrgent: boolean;
  readonly radar: readonly RadarSoft[];
  /** Per role: cells it cannot occupy (spy results). */
  readonly excluded: ReadonlyMap<RoleId, Uint8Array>;
  /** Spy said this role crosses these cells. */
  readonly spyRequired: readonly { readonly role: RoleId; readonly cells: ReadonlySet<number> }[];
  readonly unitCellsLeft: number;
  readonly rocksLeft: number;

  private constructor(view: PlayerView, memory: ViewMemory | null) {
    const config = view.config;
    this.config = config;
    this.size = { cols: config.cols, rows: config.rows };
    this.n = config.cols * config.rows;
    this.status = new Uint8Array(this.n);
    this.deadRole = Array.from({ length: this.n }, () => null);
    this.shieldMark = new Uint8Array(this.n);
    this.shieldActive = view.enemy.shieldActive;
    this.unitCellsLeft = view.enemy.unitCellsLeft;

    let rocksSeen = 0;
    view.enemy.cells.forEach((cell, i) => {
      if (cell.shield) this.shieldMark[i] = 1;
      switch (cell.state) {
        case 'earth':
          this.status[i] = EMPTY;
          break;
        case 'rock':
          this.status[i] = ROCK;
          rocksSeen++;
          break;
        case 'spotted':
          this.status[i] = SPOTTED;
          break;
        case 'hit':
          if (cell.role) {
            this.status[i] = DEAD;
            this.deadRole[i] = cell.role;
          } else {
            this.status[i] = HIT;
          }
          break;
        default:
          break;
      }
    });
    if (memory) {
      // A repaired cell still holds the unit; it is probably reinforced for a turn.
      for (const i of memory.repaired(view)) {
        this.status[i] = SPOTTED;
        this.shieldMark[i] = 1;
      }
      for (const [i, terrain] of memory.faded(view)) {
        this.status[i] = terrain === 'rock' ? ROCK : EMPTY;
        if (terrain === 'rock') rocksSeen++;
      }
    }

    // Radar facts: a blocked centre is rock; a zero empties the block (amphibians too if it saw them).
    this.radarEmpty = new Uint8Array(this.n);
    this.radarEmptyAll = new Uint8Array(this.n);
    const radar: RadarSoft[] = [];
    for (const r of view.intel.radar) {
      const center = r.center.row * this.size.cols + r.center.col;
      if (r.count === null) {
        if (this.status[center] === UNKNOWN) {
          this.status[center] = ROCK;
          rocksSeen++;
        }
        continue;
      }
      const cells = block3x3(this.size, center);
      const amphibians = r.amphibians === true;
      if (r.count === 0) {
        for (const c of cells) {
          this.radarEmpty[c] = 1;
          if (amphibians) this.radarEmptyAll[c] = 1;
        }
      } else radar.push({ center, count: r.count, cells, amphibians });
    }

    // Tide: the bank rows are out of reach while the water is up.
    this.submerged = new Uint8Array(this.n);
    const tide = view.mutators?.tide ?? null;
    if (tide?.submerged) {
      for (const row of tide.rows) for (let col = 0; col < this.size.cols; col++) this.submerged[row * this.size.cols + col] = 1;
    }
    let dryLeft = false;
    for (let i = 0; i < this.n && !dryLeft; i++) {
      const s = this.status[i];
      if ((s === UNKNOWN || s === SPOTTED) && !this.submerged[i]) dryLeft = true;
    }
    this.wetOnly = tide?.submerged === true && !dryLeft;
    this.bankUrgent = tide !== null && !tide.submerged && tide.turnsUntilRise > 0 && tide.turnsUntilRise <= 2;
    this.radar = radar;
    this.rocksLeft = Math.max(0, config.rocks - rocksSeen);

    // Nothing stands next to a sniper, so the ring of a fallen one is empty.
    for (let i = 0; i < this.n; i++) {
      if (this.deadRole[i] !== 'sniper') continue;
      for (const nb of neighbors4(this.size, i)) if (this.status[nb] === UNKNOWN) this.status[nb] = EMPTY;
    }

    const remaining: PieceKind[] = [];
    const army = view.enemy.units ?? config.units;
    for (const { role, count } of view.enemy.remaining) {
      if (count <= 0) continue;
      const spec = army.find((u) => u.role === role);
      if (spec) remaining.push({ role, shape: shapeOf(spec), count });
    }
    this.remaining = remaining;

    // Spy: the reported piece crosses the line; a ranked spy also rules out stronger ones,
    // and an empty answer rules out everything.
    const excluded = new Map<RoleId, Uint8Array>();
    const required: { role: RoleId; cells: Set<number> }[] = [];
    for (const s of view.intel.spy) {
      const cells = lineCells(this.size, s.axis, s.index);
      const ranked = s.ranked !== false;
      const bar = s.role === null ? -1 : ranked ? ROLES[s.role].value : Infinity;
      for (const kind of remaining) {
        if (ROLES[kind.role].value <= bar) continue;
        let mask = excluded.get(kind.role);
        if (!mask) excluded.set(kind.role, (mask = new Uint8Array(this.n)));
        for (const c of cells) mask[c] = 1;
      }
      if (s.role && remaining.some((k) => k.role === s.role)) {
        const already = cells.some((c) => this.deadRole[c] === s.role);
        if (!already) required.push({ role: s.role, cells: new Set(cells) });
      }
    }
    this.excluded = excluded;
    this.spyRequired = required;
  }

  static fromView(view: PlayerView, memory: ViewMemory | null = null): Knowledge {
    return new Knowledge(view, memory);
  }

  /** A cell worth shooting at now (not uncovered yet, and not under water). */
  shootable(i: number): boolean {
    const s = this.status[i];
    return (s === UNKNOWN || s === SPOTTED) && (this.wetOnly || !this.submerged[i]);
  }

  /** Shot would be absorbed right now. */
  shielded(i: number): boolean {
    return this.shieldActive && this.shieldMark[i] === 1;
  }

  /** Known unit cells whose piece is still standing. */
  mustCells(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.n; i++) if (this.status[i] === HIT || this.status[i] === SPOTTED) out.push(i);
    return out;
  }

  unknownCount(): number {
    let n = 0;
    for (let i = 0; i < this.n; i++) if (this.status[i] === UNKNOWN) n++;
    return n;
  }

  /** Unit cells still hidden somewhere among the unknown cells. */
  hiddenUnitCells(): number {
    let spotted = 0;
    for (let i = 0; i < this.n; i++) if (this.status[i] === SPOTTED) spotted++;
    return Math.max(0, this.unitCellsLeft - spotted);
  }

  /** Chance that an unknown cell is rock. */
  rockRate(): number {
    const unknown = this.unknownCount();
    return unknown === 0 ? 0 : Math.min(1, this.rocksLeft / unknown);
  }

  /**
   * How much likelier a unit is right next to a destroyed piece than anywhere
   * else, judged from the wreck surroundings uncovered so far. Above 1 the
   * enemy bunches pieces together; below 1 it spreads them out.
   */
  clusterFactor(): number {
    const base = unitCellCount(this.config) / this.n;
    let units = 0;
    let known = 0;
    const seen = new Set<number>();
    for (let i = 0; i < this.n; i++) {
      const role = this.deadRole[i];
      if (role === null || role === undefined || role === 'sniper') continue;
      for (const nb of neighbors4(this.size, i)) {
        if (seen.has(nb) || this.deadRole[nb] === role) continue;
        seen.add(nb);
        const s = this.status[nb];
        if (s === UNKNOWN) continue;
        known++;
        if (s === HIT || s === SPOTTED || s === DEAD) units++;
      }
    }
    const strength = 8;
    const rate = (units + strength * base) / (known + strength);
    return Math.min(5, Math.max(0.4, rate / base));
  }

  /** Unknown cells touching a destroyed piece (sniper wrecks aside). */
  wreckRing(): number[] {
    const out = new Set<number>();
    for (let i = 0; i < this.n; i++) {
      const role = this.deadRole[i];
      if (role === null || role === undefined || role === 'sniper') continue;
      for (const nb of neighbors4(this.size, i)) if (this.status[nb] === UNKNOWN) out.add(nb);
    }
    return [...out];
  }

  /** Whether a piece of `role` could lie on `fp` given everything known. */
  allows(role: RoleId, fp: Footprint): boolean {
    const mask = this.excluded.get(role);
    let intact = false;
    for (const c of fp.cells) {
      const s = this.status[c];
      if (s === EMPTY || s === ROCK || s === DEAD) return false;
      if (role !== 'amphibian' ? this.radarEmpty[c] : this.radarEmptyAll[c]) return false;
      if (mask && mask[c]) return false;
      if (s !== HIT) intact = true;
    }
    // A piece with every cell hit would already be destroyed.
    if (!intact) return false;
    if (role === 'sniper') {
      for (const r of fp.ring) {
        const s = this.status[r];
        if (s === HIT || s === SPOTTED || s === DEAD) return false;
      }
    }
    if (role === 'antenna' && !fp.ring.some((r) => this.status[r] === ROCK || this.status[r] === UNKNOWN)) return false;
    return true;
  }
}
