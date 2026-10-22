import {
  ABILITIES,
  ENERGY,
  MAX_EXTRA_SHOTS,
  REPAIR_GUARD_TURNS,
  SHIELD_TURNS,
  type AbilityId,
  type AbilityRequest,
} from './abilities.ts';
import {
  addStrike,
  disconnect as clockDisconnect,
  graceExpired,
  graceLeft,
  initialClock,
  reconnect as clockReconnect,
  registerShot,
  resolveClock,
  spendTurn,
  turnDeadline,
  type ClockConfig,
  type ClockPresetId,
  type ClockState,
} from './clock.ts';
import {
  resolveConfig,
  sizedConfig,
  unitCellCount,
  validateConfig,
  type EnergyRule,
  type FieldConfig,
  type PresetId,
  type UnitSpec,
} from './config.ts';
import { extraPieceFor, modifiersFor, resolveFaction, TOWER_PERIOD, type FactionDef, type FactionId } from './factions.ts';
import { BANK_ROW, block3x3, coordOf, indexOf, isInside, lineCells, neighbors4, plusShape, type GridSize } from './grid.ts';
import type { LogEntry, MatchRecord } from './log.ts';
import { DOUBLE_SHOTS, FOG_FADE_TURNS, isMutatorId, TIDE, tideAt, type MutatorId } from './mutators.ts';
import {
  autoPlace as autoPlaceLayout,
  buildPieces,
  generateTerrain,
  LayoutBoard,
  type PieceSpec,
  type Placement,
  type PlacementError,
} from './placement.ts';
import { ROLES, type RoleId } from './roles.ts';
import { createRng, hashSeed, type Rng } from './rng.ts';
import { SHOT_KINDS, shotCells, specialForMode, type SpecialShotRequest } from './shots.ts';
import { opponentOf, PLAYERS, type Coord, type PlayerId, type Result, type Rotation, type Terrain } from './types.ts';
import type {
  AbilityBlocker,
  AbilityOutcome,
  AbilityStatus,
  AttackOutcome,
  DestroyedPiece,
  EnemyCell,
  EnemyFactionView,
  HistoryEntry,
  MatchPhase,
  MutatorView,
  OwnCell,
  OwnFactionView,
  PlayerClockView,
  PlayerView,
  ProbeIntel,
  RadarIntel,
  RoleCount,
  ShotReport,
  SpecialBlocker,
  SpecialOutcome,
  SpecialStatus,
  SpyIntel,
  WinReason,
} from './view.ts';

export interface MatchOptions {
  readonly seed: number;
  /** A preset id or a full config. Default: 'full'. */
  readonly config?: FieldConfig | PresetId;
  readonly firstTurn?: PlayerId;
  /** Default: 'unlimited'. */
  readonly clock?: ClockPresetId | ClockConfig;
  /** Clock time (ms) when the match is created. Default 0. */
  readonly startTime?: number;
  /** Faction of each player; missing = 'neutra' (the original rules). */
  readonly factions?: Readonly<Partial<Record<PlayerId, FactionId | FactionDef>>>;
  /** Field size other than the preset's (rocks scale with the area; see sizedConfig). */
  readonly size?: { readonly cols: number; readonly rows: number };
  /** Rule changes: 'mare', 'tiro-duplo', 'neblina'. */
  readonly mutators?: readonly MutatorId[];
}

export type MatchError =
  | PlacementError
  | 'wrong-phase'
  | 'finished'
  | 'already-confirmed'
  | 'layout-incomplete'
  | 'not-your-turn'
  | 'out-of-bounds'
  | 'already-revealed'
  | 'unknown-ability'
  | 'abilities-disabled'
  | 'ability-used'
  | 'cooldown'
  | 'energy'
  | 'missing-piece'
  | 'invalid-target'
  | 'submerged'
  | 'no-special'
  | 'special-used'
  | 'no-charges'
  | 'no-target';

export type ActionResult = Result<object, MatchError>;
export type AttackResult = Result<{ readonly outcome: AttackOutcome }, MatchError>;
export type AbilityResult = Result<{ readonly outcome: AbilityOutcome }, MatchError>;
export type SpecialResult = Result<{ readonly outcome: SpecialOutcome }, MatchError>;
export type AutoPlaceResult = Result<{ readonly placements: readonly Placement[] }, MatchError>;

export type ClockEvent =
  | { readonly type: 'timeout'; readonly player: PlayerId; readonly forfeit: boolean }
  | { readonly type: 'abandon'; readonly player: PlayerId };

interface Side {
  readonly faction: FactionDef;
  /** This army: the preset units plus faction pieces. */
  readonly units: readonly UnitSpec[];
  readonly pieces: readonly PieceSpec[];
  readonly unitCells: number;
  readonly terrain: readonly Terrain[];
  readonly board: LayoutBoard;
  readonly destroyed: boolean[];
  /** Cells the enemy has uncovered. A repaired cell goes back to 0. */
  readonly struck: Uint8Array;
  /** Turn number when each cell was uncovered (fog). */
  readonly struckAt: Int32Array;
  /** Cells where the enemy saw a shield absorb a shot. */
  readonly shieldMarks: Set<number>;
  confirmed: boolean;
  energy: number;
  cooldowns: Record<AbilityId, number>;
  shield: { slot: number; turnsLeft: number } | null;
  /** What this player learned about the enemy field. */
  readonly radar: RadarIntel[];
  readonly spy: SpyIntel[];
  readonly probes: ProbeIntel[];
  /** Enemy cells this player probed and saw empty. */
  readonly probed: Map<number, 'earth' | 'rock'>;
  readonly spotted: Set<number>;
  clock: ClockState;
  autoCount: number;
  unitHits: number;
  specialCharges: number | null;
  specialCooldown: number;
  testudoUsed: boolean;
  ownTurns: number;
}

interface StoredHistory {
  readonly entry: HistoryEntry;
  /** When set, other players get `redacted` instead. */
  readonly owner: PlayerId | null;
  readonly redacted: HistoryEntry | null;
}

const fail = <E extends string>(error: E) => ({ ok: false as const, error });

/**
 * The authoritative match. It holds both secret layouts; players should only
 * ever receive `viewFor(player)` and the outcomes returned by the actions.
 *
 * Time never comes from the system: call `tick(now)` with the current time
 * before applying actions when a turn clock is in use.
 */
export class Match {
  readonly #seed: number;
  readonly #config: FieldConfig;
  readonly #clock: ClockConfig;
  readonly #clockOption: ClockPresetId | ClockConfig;
  readonly #size: GridSize;
  readonly #basePieces: readonly PieceSpec[];
  readonly #first: PlayerId;
  readonly #startTime: number;
  readonly #rng: Rng;
  readonly #factionOption: MatchOptions['factions'];
  readonly #mutators: readonly MutatorId[];
  /** Faction mechanics run only in modes with energy. */
  readonly #factionsActive: boolean;
  readonly #energy: EnergyRule;
  readonly #sides: Record<PlayerId, Side>;
  readonly #log: LogEntry[] = [];
  readonly #history: StoredHistory[] = [];

  #phase: MatchPhase = 'placing';
  #turn: PlayerId;
  #turnNumber = 1;
  #extraShots = 0;
  #abilityUsed = false;
  #specialUsed = false;
  #shotsTaken = 0;
  #winner: PlayerId | null = null;
  #winReason: WinReason | null = null;
  #now: number;
  #turnStartedAt: number;
  #frozenSince: number | null = null;

  constructor(options: MatchOptions) {
    this.#seed = options.seed >>> 0;
    const base = resolveConfig(options.config);
    this.#config = options.size ? sizedConfig(base, options.size.cols, options.size.rows) : base;
    validateConfig(this.#config);
    this.#energy = { ...ENERGY, ...this.#config.energy };
    this.#clockOption = options.clock ?? 'unlimited';
    this.#clock = resolveClock(options.clock);
    this.#size = { cols: this.#config.cols, rows: this.#config.rows };
    this.#basePieces = buildPieces(this.#config);
    this.#first = options.firstTurn ?? 'blue';
    this.#turn = this.#first;
    this.#startTime = options.startTime ?? 0;
    this.#now = this.#startTime;
    this.#turnStartedAt = this.#startTime;
    this.#rng = createRng(hashSeed(this.#seed, 'events'));
    this.#factionOption = options.factions;
    const mutators: MutatorId[] = [];
    for (const id of options.mutators ?? []) {
      if (!isMutatorId(id)) throw new Error(`Unknown mutator: ${String(id)}`);
      if (!mutators.includes(id)) mutators.push(id);
    }
    this.#mutators = mutators;
    this.#factionsActive = this.#config.abilities.length > 0;
    this.#sides = { blue: this.#createSide('blue'), red: this.#createSide('red') };
  }

  /** Rebuilds a match from its seed, config and log. */
  static fromLog(
    seed: number,
    config: FieldConfig | PresetId,
    log: readonly LogEntry[],
    options: Omit<MatchOptions, 'seed' | 'config'> = {},
  ): Match {
    const match = new Match({ ...options, seed, config });
    log.forEach((entry, i) => {
      if (entry.type === 'tower') {
        // Towers fire by themselves during the replay; the entry only checks it.
        const mine = match.#log[i];
        if (
          !mine ||
          mine.type !== 'tower' ||
          mine.player !== entry.player ||
          mine.target.col !== entry.target.col ||
          mine.target.row !== entry.target.row
        ) {
          throw new Error('Log entry rejected (tower): replay diverged');
        }
        return;
      }
      match.#replay(entry);
    });
    return match;
  }

  static fromRecord(record: MatchRecord): Match {
    return Match.fromLog(record.seed, record.config, record.log, {
      firstTurn: record.firstTurn,
      clock: record.clock,
      startTime: record.startTime,
      ...(record.factions ? { factions: record.factions } : {}),
      ...(record.mutators ? { mutators: record.mutators } : {}),
    });
  }

  #createSide(player: PlayerId): Side {
    const faction = resolveFaction(this.#factionOption?.[player]);
    const extra = this.#factionsActive ? extraPieceFor(faction, this.#config.name) : null;
    const units: UnitSpec[] = [...this.#config.units];
    if (extra && extra.count > 0) units.push({ role: extra.role, count: extra.count });
    const army: FieldConfig = { ...this.#config, units };
    const pieces = extra ? buildPieces(army) : this.#basePieces;
    const terrain = generateTerrain(this.#size, this.#config.rocks, pieces, createRng(hashSeed(this.#seed, 'terrain', player)));
    const cells = this.#size.cols * this.#size.rows;
    const special = this.#factionsActive ? specialForMode(faction.specialShot, this.#config.name) : null;
    return {
      faction,
      units,
      pieces,
      unitCells: unitCellCount(army),
      terrain,
      board: new LayoutBoard(this.#size, terrain, pieces),
      destroyed: pieces.map(() => false),
      struck: new Uint8Array(cells),
      struckAt: new Int32Array(cells),
      shieldMarks: new Set(),
      confirmed: false,
      energy: this.#config.abilities.length > 0 ? this.#energy.start + this.#passive(faction, 'energyStart') : 0,
      cooldowns: { radar: 0, bomb: 0, shield: 0, repair: 0, spy: 0 },
      shield: null,
      radar: [],
      spy: [],
      probes: [],
      probed: new Map(),
      spotted: new Set(),
      clock: initialClock(this.#clock),
      autoCount: 0,
      unitHits: 0,
      specialCharges: special ? special.charges : null,
      specialCooldown: 0,
      testudoUsed: false,
      ownTurns: 0,
    };
  }

  #passive(faction: FactionDef, key: 'energyStart' | 'energyPerKill' | 'energyMax' | 'shieldTurns' | 'repairGuardTurns'): number {
    return this.#factionsActive ? (faction.passives[key] ?? 0) : 0;
  }

  #has(player: PlayerId, key: 'radarSeesAmphibians' | 'spyRanked' | 'testudo' | 'bombPierce'): boolean {
    return this.#factionsActive && this.#sides[player].faction.passives[key] === true;
  }

  // ------------------------------------------------------------ state

  get seed(): number {
    return this.#seed;
  }

  get config(): FieldConfig {
    return this.#config;
  }

  get phase(): MatchPhase {
    return this.#phase;
  }

  get turn(): PlayerId {
    return this.#turn;
  }

  get turnNumber(): number {
    return this.#turnNumber;
  }

  get winner(): PlayerId | null {
    return this.#winner;
  }

  get winReason(): WinReason | null {
    return this.#winReason;
  }

  get now(): number {
    return this.#now;
  }

  /** Piece list of the preset army, without faction pieces (see `piecesOf`). */
  get pieces(): readonly PieceSpec[] {
    return this.#basePieces;
  }

  /** Piece list of one player's army (faction pieces included). Public information. */
  piecesOf(player: PlayerId): readonly PieceSpec[] {
    return this.#sides[player].pieces;
  }

  factionOf(player: PlayerId): FactionDef {
    return this.#sides[player].faction;
  }

  get mutators(): readonly MutatorId[] {
    return this.#mutators;
  }

  get log(): readonly LogEntry[] {
    return [...this.#log];
  }

  toRecord(): MatchRecord {
    const factions = this.#factionOption && Object.keys(this.#factionOption).length > 0 ? { factions: { ...this.#factionOption } } : {};
    return {
      seed: this.#seed,
      config: this.#config,
      firstTurn: this.#first,
      clock: this.#clockOption,
      startTime: this.#startTime,
      log: this.log,
      ...factions,
      ...(this.#mutators.length > 0 ? { mutators: [...this.#mutators] } : {}),
    };
  }

  // ------------------------------------------------------------ placement

  place(player: PlayerId, pieceId: string, anchor: Coord, rotation: Rotation = 0): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const slot = side.board.slotOf(pieceId);
    if (slot < 0) return fail('unknown-piece');
    const error = side.board.place(slot, anchor, rotation);
    if (error) return fail(error);
    this.#record({ type: 'place', player, pieceId, anchor: { col: anchor.col, row: anchor.row }, rotation, at: this.#now });
    return { ok: true };
  }

  move(player: PlayerId, pieceId: string, anchor: Coord): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const slot = side.board.slotOf(pieceId);
    if (slot < 0) return fail('unknown-piece');
    const current = side.board.placementOf(slot);
    if (!current) return fail('not-placed');
    const error = side.board.place(slot, anchor, current.rotation);
    if (error) return fail(error);
    this.#record({ type: 'move', player, pieceId, anchor: { col: anchor.col, row: anchor.row }, at: this.#now });
    return { ok: true };
  }

  /** Turns a placed piece in place; without `rotation` it adds a quarter turn. */
  rotate(player: PlayerId, pieceId: string, rotation?: Rotation): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const slot = side.board.slotOf(pieceId);
    if (slot < 0) return fail('unknown-piece');
    const current = side.board.placementOf(slot);
    if (!current) return fail('not-placed');
    const next = rotation ?? (((current.rotation + 1) % 4) as Rotation);
    const error = side.board.place(slot, current.anchor, next);
    if (error) return fail(error);
    this.#record({ type: 'rotate', player, pieceId, rotation: next, at: this.#now });
    return { ok: true };
  }

  remove(player: PlayerId, pieceId: string): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const slot = side.board.slotOf(pieceId);
    if (slot < 0) return fail('unknown-piece');
    if (!side.board.placementOf(slot)) return fail('not-placed');
    side.board.clear(slot);
    this.#record({ type: 'remove', player, pieceId, at: this.#now });
    return { ok: true };
  }

  /** Replaces the whole layout at once; it must be complete and legal. */
  setLayout(player: PlayerId, placements: readonly Placement[]): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const board = this.#sides[player].board;
    const previous = board.placements();
    const issue = board.applyLayout(placements);
    if (issue) {
      board.applyLayout(previous);
      return fail(issue.error);
    }
    this.#record({ type: 'layout', player, placements: board.placements(), at: this.#now });
    return { ok: true };
  }

  /**
   * Random legal layout. Without a seed one is derived from the match seed, so
   * the result is still reproducible; the log stores the seed used.
   */
  autoPlace(player: PlayerId, seed?: number): AutoPlaceResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const used = (seed ?? hashSeed(this.#seed, 'auto', player, side.autoCount)) >>> 0;
    side.autoCount++;
    const placements = autoPlaceLayout(this.#size, side.terrain, side.pieces, createRng(used));
    side.board.applyLayout(placements);
    this.#record({ type: 'auto', player, seed: used, at: this.#now });
    return { ok: true, placements };
  }

  confirm(player: PlayerId): ActionResult {
    const gate = this.#placingGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const issue = side.board.issues()[0];
    if (issue) return fail(issue.error === 'not-placed' ? 'layout-incomplete' : issue.error);
    side.confirmed = true;
    this.#record({ type: 'confirm', player, at: this.#now });
    if (PLAYERS.every((p) => this.#sides[p].confirmed)) this.#startPlaying();
    return { ok: true };
  }

  #placingGate(player: PlayerId): MatchError | null {
    if (this.#phase === 'finished') return 'finished';
    if (this.#phase !== 'placing') return 'wrong-phase';
    if (this.#sides[player].confirmed) return 'already-confirmed';
    return null;
  }

  #startPlaying(): void {
    this.#phase = 'playing';
    this.#turn = this.#first;
    this.#turnNumber = 1;
    if (PLAYERS.some((p) => this.#sides[p].clock.disconnectedAt !== null)) this.#frozenSince = this.#now;
    this.#beginTurn(this.#first, this.#now);
  }

  // ------------------------------------------------------------ tide and fog

  #tideUp(): boolean {
    return this.#phase === 'playing' && this.#mutators.includes('mare') && tideAt(this.#turnNumber).submerged;
  }

  /** The water covers this cell right now (same rows on both fields). */
  #isSubmerged(index: number): boolean {
    return this.#tideUp() && TIDE.rows.includes(Math.floor(index / this.#size.cols));
  }

  /** Every cell `defender` still hides is under water: shots there are allowed and fizzle. */
  #onlySubmergedLeft(defender: PlayerId): boolean {
    if (!this.#tideUp()) return false;
    const struck = this.#sides[defender].struck;
    for (let i = 0; i < struck.length; i++) if (!struck[i] && !this.#isSubmerged(i)) return false;
    return true;
  }

  /** Under fog, an old miss on `defender`'s field no longer shows on the attacker's map. */
  #faded(defender: PlayerId, index: number): boolean {
    if (!this.#mutators.includes('neblina')) return false;
    const side = this.#sides[defender];
    if (!side.struck[index] || (side.board.occupant[index] ?? -1) >= 0 || side.shieldMarks.has(index)) return false;
    return this.#turnNumber - (side.struckAt[index] ?? 0) >= FOG_FADE_TURNS;
  }

  get #doubleShot(): boolean {
    return this.#mutators.includes('tiro-duplo');
  }

  // ------------------------------------------------------------ combat

  attack(player: PlayerId, target: Coord): AttackResult {
    const gate = this.#turnGate(player);
    if (gate) return fail(gate);
    if (!isInside(this.#size, target)) return fail('out-of-bounds');
    const defender = opponentOf(player);
    const index = indexOf(this.#size, target);
    const refaded = this.#faded(defender, index);
    if (this.#sides[defender].struck[index] && !refaded) return fail('already-revealed');
    if (this.#isSubmerged(index) && !this.#onlySubmergedLeft(defender)) return fail('submerged');

    const attackerSide = this.#sides[player];
    attackerSide.clock = registerShot(attackerSide.clock);
    const turnNumber = this.#turnNumber;
    let report: ShotReport;
    let extra = false;
    if (refaded) {
      // Shooting a miss the fog hid again: the shot is spent and shows the same terrain.
      const side = this.#sides[defender];
      side.struckAt[index] = this.#turnNumber;
      report = { target: coordOf(this.#size, index), result: side.terrain[index] ?? 'earth', destroyed: null, sniperReveal: null };
    } else {
      ({ report, extra } = this.#strike(player, index));
    }
    this.#record({ type: 'attack', player, target: { col: target.col, row: target.row }, at: this.#now });

    const flow = this.#shotFlow(player, extra);
    this.#pushHistory({ kind: 'shot', turn: turnNumber, by: player, report, extraShot: flow.extraShot });
    this.#endShot(player, flow);

    return {
      ok: true,
      outcome: {
        ...report,
        attacker: player,
        defender,
        turnNumber,
        extraShot: flow.extraShot,
        extraShotsLeft: flow.extraShot ? MAX_EXTRA_SHOTS - this.#extraShots : 0,
        nextTurn: this.#winner ? null : this.#turn,
        winner: this.#winner,
      },
    };
  }

  /** Decides what a shot leads to, before history and turn changes. */
  #shotFlow(player: PlayerId, extra: boolean): { won: boolean; extraShot: boolean } {
    const won = this.#allDestroyed(opponentOf(player));
    const extraShot = !won && !this.#doubleShot && extra && this.#extraShots < MAX_EXTRA_SHOTS;
    return { won, extraShot };
  }

  #endShot(player: PlayerId, flow: { won: boolean; extraShot: boolean }): void {
    if (flow.won) this.#finish(player, 'destroyed');
    else if (this.#doubleShot) {
      this.#shotsTaken++;
      if (this.#shotsTaken >= DOUBLE_SHOTS) this.#passTurn(this.#now);
    } else if (flow.extraShot) this.#extraShots++;
    else this.#passTurn(this.#now);
  }

  #turnGate(player: PlayerId): MatchError | null {
    if (this.#phase === 'finished') return 'finished';
    if (this.#phase !== 'playing') return 'wrong-phase';
    if (player !== this.#turn) return 'not-your-turn';
    return null;
  }

  /** Strikes one cell of the attacker's opponent. The caller checked it is not uncovered. */
  #strike(attacker: PlayerId, index: number): { report: ShotReport; extra: boolean } {
    const defender = opponentOf(attacker);
    const side = this.#sides[defender];
    const target = coordOf(this.#size, index);
    const slot = side.board.occupant[index] ?? -1;
    const piece = slot >= 0 ? side.pieces[slot] : undefined;

    // Tide: the water takes the shot and nothing is uncovered, unless a (swimming) amphibian is there.
    if (this.#isSubmerged(index) && piece?.role !== 'amphibian') {
      return { report: { target, result: 'submerged', destroyed: null, sniperReveal: null }, extra: false };
    }

    if (slot >= 0 && side.shield?.slot === slot) {
      side.shieldMarks.add(index);
      return { report: { target, result: 'shield', destroyed: null, sniperReveal: null }, extra: false };
    }

    if (slot >= 0 && this.#has(defender, 'testudo') && !side.testudoUsed && this.#inTestudo(defender, slot)) {
      side.testudoUsed = true;
      side.shieldMarks.add(index);
      return { report: { target, result: 'shield', destroyed: null, sniperReveal: null, absorbedBy: 'testudo' }, extra: false };
    }

    side.struck[index] = 1;
    side.struckAt[index] = this.#turnNumber;
    if (slot < 0 || !piece) {
      return { report: { target, result: side.terrain[index] ?? 'earth', destroyed: null, sniperReveal: null }, extra: false };
    }

    side.unitHits++;
    const cells = side.board.cellsOf(slot);
    const damaged = cells.filter((i) => side.struck[i]).length;
    // Bunker concrete: no extra shot until its second cell is down.
    const extra = piece.role === 'bunker' ? damaged >= 2 : true;

    if (damaged < cells.length) return { report: { target, result: 'hit', destroyed: null, sniperReveal: null }, extra };

    side.destroyed[slot] = true;
    if (side.shield?.slot === slot) side.shield = null;
    const attackerSide = this.#sides[attacker];
    if (this.#config.abilities.length > 0) {
      const max = this.#energy.max + this.#passive(attackerSide.faction, 'energyMax');
      attackerSide.energy = Math.min(max, attackerSide.energy + this.#energy.perKill + this.#passive(attackerSide.faction, 'energyPerKill'));
    }
    const destroyed: DestroyedPiece = { role: piece.role, cells: cells.map((i) => coordOf(this.#size, i)) };
    const sniperReveal = piece.role === 'sniper' ? this.#sniperLastShot(defender) : null;
    return { report: { target, result: 'destroyed', destroyed, sniperReveal }, extra };
  }

  /** Testudo covers a live bunker and every piece touching it. */
  #inTestudo(player: PlayerId, slot: number): boolean {
    const side = this.#sides[player];
    const cells = new Set(side.board.cellsOf(slot));
    return side.pieces.some((piece, b) => {
      if (piece.role !== 'bunker' || side.destroyed[b]) return false;
      if (b === slot) return true;
      return side.board.cellsOf(b).some((i) => neighbors4(this.#size, i).some((n) => cells.has(n)));
    });
  }

  /** The fallen sniper's owner learns one random intact unit cell of the shooter. */
  #sniperLastShot(owner: PlayerId): Coord | null {
    const shooter = this.#sides[opponentOf(owner)];
    const known = this.#sides[owner].spotted;
    const candidates: number[] = [];
    for (let i = 0; i < shooter.struck.length; i++) {
      if ((shooter.board.occupant[i] ?? -1) >= 0 && !shooter.struck[i] && !known.has(i)) candidates.push(i);
    }
    if (candidates.length === 0) return null;
    const index = this.#rng.pick(candidates);
    known.add(index);
    return coordOf(this.#size, index);
  }

  #allDestroyed(player: PlayerId): boolean {
    const side = this.#sides[player];
    return side.unitHits >= side.unitCells;
  }

  surrender(player: PlayerId): ActionResult {
    if (this.#phase === 'finished') return fail('finished');
    this.#record({ type: 'surrender', player, at: this.#now });
    this.#finish(opponentOf(player), 'surrender');
    return { ok: true };
  }

  // ------------------------------------------------------------ abilities

  useAbility(player: PlayerId, request: AbilityRequest): AbilityResult {
    const gate = this.#turnGate(player);
    if (gate) return fail(gate);
    const def = ABILITIES[request.ability];
    if (!def) return fail('unknown-ability');
    const status = this.#abilityStatus(player, def.id);
    if (status.blocker) return fail(BLOCKER_ERROR[status.blocker]);
    const targetError = this.#validateAbility(player, request);
    if (targetError) return fail(targetError);

    const side = this.#sides[player];
    side.energy -= status.cost;
    side.cooldowns[def.id] = status.cooldown;
    this.#abilityUsed = true;
    const turn = this.#turnNumber;
    const outcome = this.#runAbility(player, request);
    this.#record({ type: 'ability', player, request, at: this.#now });

    const isPublic = outcome.ability === 'bomb';
    this.#history.push({
      entry: { kind: 'ability', turn, by: player, ability: def.id, outcome },
      owner: isPublic ? null : player,
      redacted: isPublic ? null : { kind: 'ability', turn, by: player, ability: def.id, outcome: null },
    });
    if (outcome.ability === 'bomb' && outcome.winner) this.#finish(player, 'destroyed');
    return { ok: true, outcome };
  }

  #hasAlive(player: PlayerId, role: RoleId): boolean {
    return this.#countAlive(player, role) > 0;
  }

  #countAlive(player: PlayerId, role: RoleId): number {
    const side = this.#sides[player];
    return side.pieces.filter((piece, slot) => piece.role === role && !side.destroyed[slot] && side.board.placementOf(slot) !== null).length;
  }

  #abilityCost(player: PlayerId, id: AbilityId): number {
    const mod = this.#factionsActive ? modifiersFor(this.#sides[player].faction, this.#config.name)[id] : undefined;
    return Math.max(0, ABILITIES[id].cost + (mod?.cost ?? 0));
  }

  #abilityCooldown(player: PlayerId, id: AbilityId): number {
    const def = ABILITIES[id];
    const base = def.cooldownWith && this.#hasAlive(player, def.cooldownWith.role) ? def.cooldownWith.cooldown : def.cooldown;
    const mod = this.#factionsActive ? modifiersFor(this.#sides[player].faction, this.#config.name)[id] : undefined;
    return Math.max(1, base + (mod?.cooldown ?? 0));
  }

  #abilityStatus(player: PlayerId, id: AbilityId): AbilityStatus {
    const def = ABILITIES[id];
    const side = this.#sides[player];
    const cost = this.#abilityCost(player, id);
    const cooldown = this.#abilityCooldown(player, id);
    const cooldownLeft = side.cooldowns[id];
    let blocker: AbilityBlocker | null = null;
    if (!this.#config.abilities.includes(id)) blocker = 'disabled';
    else if (this.#phase !== 'playing' || this.#turn !== player) blocker = 'not-your-turn';
    else if (this.#abilityUsed) blocker = 'already-used';
    else if (def.requires && !this.#hasAlive(player, def.requires)) blocker = 'missing-piece';
    else if (cooldownLeft > 0) blocker = 'cooldown';
    else if (side.energy < cost) blocker = 'energy';
    return { id, cost, cooldown, cooldownLeft, ready: blocker === null, blocker };
  }

  #validateAbility(player: PlayerId, request: AbilityRequest): MatchError | null {
    const own = this.#sides[player];
    const enemy = this.#sides[opponentOf(player)];
    switch (request.ability) {
      case 'radar':
        return isInside(this.#size, request.target) ? null : 'out-of-bounds';
      case 'bomb': {
        if (!isInside(this.#size, request.target)) return 'out-of-bounds';
        const index = indexOf(this.#size, request.target);
        const open = plusShape(this.#size, index).some((i) => !enemy.struck[i]);
        const knownRock = enemy.struck[index] && enemy.terrain[index] === 'rock' && !this.#has(player, 'bombPierce');
        return knownRock || !open ? 'invalid-target' : null;
      }
      case 'shield': {
        const slot = own.board.slotOf(request.pieceId);
        if (slot < 0) return 'unknown-piece';
        if (own.destroyed[slot]) return 'invalid-target';
        const onBank = own.board.cellsOf(slot).some((i) => Math.floor(i / this.#size.cols) === BANK_ROW);
        return onBank ? 'invalid-target' : null;
      }
      case 'repair': {
        if (!isInside(this.#size, request.target)) return 'out-of-bounds';
        const index = indexOf(this.#size, request.target);
        const slot = own.board.occupant[index] ?? -1;
        if (slot < 0 || !own.struck[index] || own.destroyed[slot]) return 'invalid-target';
        const nearEarth = neighbors4(this.#size, index).some(
          (n) => own.terrain[n] === 'earth' && (own.board.occupant[n] ?? -1) < 0,
        );
        return nearEarth ? null : 'invalid-target';
      }
      case 'spy': {
        const limit = request.axis === 'row' ? this.#size.rows : request.axis === 'col' ? this.#size.cols : 0;
        return Number.isInteger(request.index) && request.index >= 0 && request.index < limit ? null : 'out-of-bounds';
      }
      default:
        return 'unknown-ability';
    }
  }

  #runAbility(player: PlayerId, request: AbilityRequest): AbilityOutcome {
    const opponent = opponentOf(player);
    const own = this.#sides[player];
    const enemy = this.#sides[opponent];
    const turn = this.#turnNumber;

    switch (request.ability) {
      case 'radar': {
        const center = indexOf(this.#size, request.target);
        // Amphibians hide from radar, except from the Egyptian one or while the bank is under water.
        const seesAmphibians = this.#has(player, 'radarSeesAmphibians') || this.#tideUp();
        let count: number | null = null;
        if (enemy.terrain[center] !== 'rock') {
          count = block3x3(this.#size, center).filter((i) => {
            const slot = enemy.board.occupant[i] ?? -1;
            return slot >= 0 && (seesAmphibians || enemy.pieces[slot]?.role !== 'amphibian');
          }).length;
        }
        const target = coordOf(this.#size, center);
        own.radar.push(seesAmphibians ? { turn, center: target, count, amphibians: true } : { turn, center: target, count });
        return { ability: 'radar', target, count };
      }
      case 'bomb': {
        const center = indexOf(this.#size, request.target);
        const blocked = enemy.terrain[center] === 'rock' && !this.#has(player, 'bombPierce');
        const cells = blocked ? [center] : plusShape(this.#size, center);
        const shots: ShotReport[] = [];
        for (const index of cells) {
          if (enemy.struck[index]) continue;
          shots.push(this.#strike(player, index).report);
        }
        const winner = this.#allDestroyed(opponent) ? player : null;
        return { ability: 'bomb', target: coordOf(this.#size, center), shots, winner };
      }
      case 'shield': {
        const slot = own.board.slotOf(request.pieceId);
        const turns = SHIELD_TURNS + this.#passive(own.faction, 'shieldTurns');
        own.shield = { slot, turnsLeft: turns };
        return { ability: 'shield', pieceId: request.pieceId, turns };
      }
      case 'repair': {
        const index = indexOf(this.#size, request.target);
        const slot = own.board.occupant[index] ?? -1;
        own.struck[index] = 0;
        own.unitHits--;
        // Reinforcement: whoever remembers the hit runs into a shield next turn.
        const guard = REPAIR_GUARD_TURNS + this.#passive(own.faction, 'repairGuardTurns');
        if (!own.shield) own.shield = { slot, turnsLeft: guard };
        else if (own.shield.slot === slot) own.shield.turnsLeft = Math.max(own.shield.turnsLeft, guard);
        return { ability: 'repair', target: coordOf(this.#size, index), guardTurns: own.shield.slot === slot ? own.shield.turnsLeft : 0 };
      }
      case 'spy': {
        const slots: number[] = [];
        for (const index of lineCells(this.#size, request.axis, request.index)) {
          const slot = enemy.board.occupant[index] ?? -1;
          if (slot < 0 || enemy.destroyed[slot] || slots.includes(slot)) continue;
          slots.push(slot);
        }
        const ranked = this.#has(player, 'spyRanked');
        let role: RoleId | null = null;
        if (slots.length > 0) {
          if (ranked) {
            for (const slot of slots) {
              const r = enemy.pieces[slot]?.role;
              if (r && (role === null || ROLES[r].value > ROLES[role].value)) role = r;
            }
          } else {
            slots.sort((a, b) => a - b);
            const pick = createRng(hashSeed(this.#seed, 'spy', player, turn)).pick(slots);
            role = enemy.pieces[pick]?.role ?? null;
          }
        }
        own.spy.push({ turn, axis: request.axis, index: request.index, role, ranked });
        return { ability: 'spy', axis: request.axis, index: request.index, role, ranked };
      }
    }
  }

  // ------------------------------------------------------------ special shots

  /**
   * Fires the faction's special shot (one per turn). A probe is free-standing
   * like an ability; every other kind is the turn's shot.
   */
  special(player: PlayerId, request: SpecialShotRequest): SpecialResult {
    const gate = this.#turnGate(player);
    if (gate) return fail(gate);
    const side = this.#sides[player];
    const def = this.#factionsActive ? specialForMode(side.faction.specialShot, this.#config.name) : null;
    if (!def) return fail('no-special');
    const status = this.#specialStatus(player);
    if (status?.blocker) return fail(SPECIAL_BLOCKER_ERROR[status.blocker]);
    const cells = request && typeof request === 'object' ? shotCells(this.#size, def.kind, request) : null;
    if (!cells) {
      const inside = request && typeof request === 'object' && isInside(this.#size, request.target);
      return fail(inside ? 'invalid-target' : 'out-of-bounds');
    }
    const targetError = this.#validateSpecial(player, def.kind, cells);
    if (targetError) return fail(targetError);

    // Pay: a charge while there are any, otherwise the recharge price.
    const charged = side.specialCharges !== null && side.specialCharges > 0;
    side.energy -= status?.energy ?? 0;
    if (charged) side.specialCharges = (side.specialCharges ?? 1) - 1;
    side.specialCooldown = def.cooldown;
    this.#specialUsed = true;

    const defender = opponentOf(player);
    const turnNumber = this.#turnNumber;
    const kind = SHOT_KINDS[def.kind];
    const shots: ShotReport[] = [];
    let probe: ProbeIntel | null = null;
    let extra = false;
    const enemy = this.#sides[defender];
    const target = coordOf(this.#size, cells[0]!);

    switch (def.kind) {
      case 'probe': {
        const index = cells[0]!;
        const slot = enemy.board.occupant[index] ?? -1;
        const content = slot >= 0 ? 'unit' : (enemy.terrain[index] ?? 'earth');
        probe = { turn: turnNumber, target, content };
        side.probes.push(probe);
        if (content === 'unit') side.spotted.add(index);
        else if (enemy.struck[index]) enemy.struckAt[index] = turnNumber; // a faded miss shows again
        else side.probed.set(index, content);
        break;
      }
      case 'precise': {
        const index = this.#preciseCell(player, cells[0]!);
        if (index !== null) {
          const r = this.#strike(player, index);
          shots.push(r.report);
          extra = r.extra;
        }
        break;
      }
      case 'ricochet': {
        const first = this.#strike(player, cells[0]!);
        shots.push(first.report);
        extra = first.extra;
        if (first.report.result === 'earth') {
          const next = neighbors4(this.#size, cells[0]!).filter((n) => !enemy.struck[n] && !this.#isSubmerged(n));
          if (next.length > 0) {
            const bounce = createRng(hashSeed(this.#seed, 'ricochet', player, this.#log.length)).pick(next);
            const second = this.#strike(player, bounce);
            shots.push(second.report);
            extra = second.extra;
          }
        }
        break;
      }
      case 'cross': {
        const blocked = enemy.terrain[cells[0]!] === 'rock';
        for (const index of blocked ? [cells[0]!] : cells) {
          if (!enemy.struck[index]) shots.push(this.#strike(player, index).report);
        }
        break;
      }
      case 'line3': {
        for (const index of cells) {
          if (enemy.struck[index]) {
            if (enemy.terrain[index] === 'rock') break; // a known rock stops it too
            continue;
          }
          const r = this.#strike(player, index);
          shots.push(r.report);
          if (r.report.result === 'rock') break; // the rock stops the burst
        }
        break;
      }
      default: {
        // single and double
        for (const index of cells) {
          const r = this.#strike(player, index);
          shots.push(r.report);
          extra = r.extra;
        }
      }
    }
    this.#record({ type: 'special', player, request: copySpecialRequest(request), at: this.#now });

    let flow = { won: this.#allDestroyed(defender), extraShot: false };
    if (kind.isShot) {
      side.clock = registerShot(side.clock);
      flow = this.#shotFlow(player, kind.extraOnHit && extra);
    }
    const outcome = (): SpecialOutcome => ({
      special: def.id,
      kind: def.kind,
      target,
      shots,
      probe,
      attacker: player,
      defender,
      turnNumber,
      extraShot: flow.extraShot,
      extraShotsLeft: flow.extraShot ? MAX_EXTRA_SHOTS - this.#extraShots : 0,
      nextTurn: this.#winner ? null : this.#turn,
      winner: this.#winner,
    });
    const entry = { kind: 'special' as const, turn: turnNumber, by: player, special: def.id, shot: def.kind };
    const historyIndex = this.#history.length;
    this.#history.push({
      entry: { ...entry, outcome: null },
      owner: probe ? player : null,
      redacted: probe ? { ...entry, outcome: null } : null,
    });
    if (kind.isShot) this.#endShot(player, flow);
    else if (flow.won) this.#finish(player, 'destroyed');
    const result = outcome();
    // The stored entry gets the final outcome (next turn and winner known now).
    this.#history[historyIndex] = { ...this.#history[historyIndex]!, entry: { ...entry, outcome: result } };
    return { ok: true, outcome: result };
  }

  #validateSpecial(player: PlayerId, kind: SpecialOutcome['kind'], cells: readonly number[]): MatchError | null {
    const defender = opponentOf(player);
    const enemy = this.#sides[defender];
    const own = this.#sides[player];
    const wet = this.#onlySubmergedLeft(defender);
    const direct = (index: number): MatchError | null => {
      // A miss the fog hid can be shot again, like with a normal attack.
      if (enemy.struck[index] && !this.#faded(defender, index)) return 'already-revealed';
      if (this.#isSubmerged(index) && !wet) return 'submerged';
      return null;
    };
    switch (kind) {
      case 'probe': {
        const index = cells[0]!;
        if ((enemy.struck[index] && !this.#faded(defender, index)) || own.probed.has(index) || own.spotted.has(index)) return 'already-revealed';
        return this.#isSubmerged(index) ? 'submerged' : null;
      }
      case 'precise': {
        const index = cells[0]!;
        const reading = own.radar.some((r) => r.count !== null && r.count > 0 && indexOf(this.#size, r.center) === index);
        return reading ? null : 'invalid-target';
      }
      case 'single':
      case 'ricochet':
        return direct(cells[0]!);
      case 'double':
        return direct(cells[0]!) ?? direct(cells[1]!);
      case 'cross': {
        const center = cells[0]!;
        if (enemy.struck[center] && enemy.terrain[center] === 'rock') return 'invalid-target';
        return cells.some((i) => !enemy.struck[i] && (wet || !this.#isSubmerged(i))) ? null : 'invalid-target';
      }
      case 'line3':
        for (const i of cells) {
          if (enemy.struck[i] && enemy.terrain[i] === 'rock') break;
          if (!enemy.struck[i] && (wet || !this.#isSubmerged(i))) return null;
        }
        return 'invalid-target';
    }
  }

  /** Cell a precise shot lands on: an intact unit cell of the radar block, unshielded first. */
  #preciseCell(player: PlayerId, center: number): number | null {
    const enemy = this.#sides[opponentOf(player)];
    const open: number[] = [];
    const guarded: number[] = [];
    for (const i of block3x3(this.#size, center)) {
      const slot = enemy.board.occupant[i] ?? -1;
      if (slot < 0 || enemy.struck[i]) continue;
      if (this.#isSubmerged(i) && enemy.pieces[slot]?.role !== 'amphibian') continue;
      (enemy.shield?.slot === slot ? guarded : open).push(i);
    }
    const pool = open.length > 0 ? open : guarded;
    if (pool.length === 0) return null;
    return createRng(hashSeed(this.#seed, 'precise', player, this.#turnNumber)).pick(pool);
  }

  #specialStatus(player: PlayerId): SpecialStatus | null {
    const side = this.#sides[player];
    const def = specialForMode(side.faction.specialShot, this.#config.name);
    if (!def) return null;
    const outOfCharges = side.specialCharges !== null && side.specialCharges <= 0;
    const energy = outOfCharges && def.rechargeEnergy !== null ? def.rechargeEnergy : def.energy;
    let blocker: SpecialBlocker | null = null;
    if (!this.#factionsActive) blocker = 'disabled';
    else if (this.#phase !== 'playing' || this.#turn !== player) blocker = 'not-your-turn';
    else if (this.#specialUsed) blocker = 'already-used';
    else if (side.specialCooldown > 0) blocker = 'cooldown';
    else if (outOfCharges && def.rechargeEnergy === null) blocker = 'no-charges';
    else if (side.energy < energy) blocker = 'energy';
    else if (def.kind === 'precise' && !side.radar.some((r) => r.count !== null && r.count > 0)) blocker = 'no-target';
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      energy,
      cooldown: def.cooldown,
      cooldownLeft: side.specialCooldown,
      charges: side.specialCharges,
      ready: blocker === null,
      blocker,
    };
  }

  // ------------------------------------------------------------ turns and clock

  #beginTurn(player: PlayerId, at: number): void {
    const side = this.#sides[player];
    if (this.#config.abilities.length > 0) {
      const max = this.#energy.max + this.#passive(side.faction, 'energyMax');
      side.energy = Math.min(max, side.energy + this.#energy.perTurn);
      for (const id of Object.keys(side.cooldowns) as AbilityId[]) side.cooldowns[id] = Math.max(0, side.cooldowns[id] - 1);
    }
    side.specialCooldown = Math.max(0, side.specialCooldown - 1);
    side.ownTurns++;
    this.#extraShots = 0;
    this.#abilityUsed = false;
    this.#specialUsed = false;
    this.#shotsTaken = 0;
    this.#turnStartedAt = at;
    if (this.#mutators.includes('mare') && this.#turnNumber > 1) {
      const now = tideAt(this.#turnNumber).submerged;
      if (now !== tideAt(this.#turnNumber - 1).submerged) this.#pushHistory({ kind: 'tide', turn: this.#turnNumber, submerged: now });
    }
    this.#towerFire(player);
  }

  /** Auto towers fire at the start of every `TOWER_PERIOD`-th own turn, at a seeded random cell. */
  #towerFire(player: PlayerId): void {
    if (!this.#factionsActive || this.#phase !== 'playing') return;
    const side = this.#sides[player];
    if (side.ownTurns % TOWER_PERIOD !== 0) return;
    const towers = this.#countAlive(player, 'tower');
    const defender = opponentOf(player);
    const enemy = this.#sides[defender];
    for (let k = 0; k < towers && this.#phase === 'playing'; k++) {
      const candidates: number[] = [];
      for (let i = 0; i < enemy.struck.length; i++) if (!enemy.struck[i] && !this.#isSubmerged(i)) candidates.push(i);
      if (candidates.length === 0) return;
      const index = createRng(hashSeed(this.#seed, 'tower', player, side.ownTurns, k)).pick(candidates);
      const { report } = this.#strike(player, index);
      this.#record({ type: 'tower', player, target: coordOf(this.#size, index), at: this.#now });
      this.#pushHistory({ kind: 'tower', turn: this.#turnNumber, by: player, report });
      if (this.#allDestroyed(defender)) this.#finish(player, 'destroyed');
    }
  }

  #turnElapsed(at: number): number {
    return (this.#frozenSince ?? at) - this.#turnStartedAt;
  }

  #passTurn(at: number): void {
    const ending = this.#turn;
    const next = opponentOf(ending);
    const endingSide = this.#sides[ending];
    endingSide.clock = spendTurn(this.#clock, endingSide.clock, this.#turnElapsed(at));
    // An enemy turn of `next` just ended: its shield ticks down.
    const shield = this.#sides[next].shield;
    if (shield) {
      shield.turnsLeft--;
      if (shield.turnsLeft <= 0) this.#sides[next].shield = null;
    }
    this.#turn = next;
    this.#turnNumber++;
    this.#beginTurn(next, at);
  }

  /**
   * Advances the clock to `now` and applies whatever expired: turn timeouts
   * (possibly several if `now` jumped far) and disconnection grace.
   */
  tick(now: number): ClockEvent[] {
    if (now > this.#now) this.#now = now;
    const events: ClockEvent[] = [];
    if (this.#phase !== 'playing') return events;

    for (const player of PLAYERS) {
      if (graceExpired(this.#clock, this.#sides[player].clock, this.#now)) {
        this.#abandon(player);
        events.push({ type: 'abandon', player });
        return events;
      }
    }
    if (this.#frozenSince !== null) return events;

    for (let guard = 0; guard < 64 && this.#phase === 'playing'; guard++) {
      const player = this.#turn;
      const deadline = turnDeadline(this.#clock, this.#sides[player].clock, this.#turnStartedAt);
      if (deadline === null || this.#now < deadline) break;
      const forfeit = this.#timeout(player, deadline);
      events.push({ type: 'timeout', player, forfeit });
    }
    return events;
  }

  /** Server-side timeout for the player on turn (skips the turn and adds a strike). */
  applyTimeout(player: PlayerId): ActionResult {
    const gate = this.#turnGate(player);
    if (gate) return fail(gate);
    this.#timeout(player, this.#now);
    return { ok: true };
  }

  #timeout(player: PlayerId, at: number): boolean {
    const side = this.#sides[player];
    const { state, forfeit } = addStrike(this.#clock, side.clock);
    side.clock = state;
    this.#record({ type: 'timeout', player, at });
    this.#pushHistory({ kind: 'timeout', turn: this.#turnNumber, by: player });
    if (forfeit) this.#finish(opponentOf(player), 'timeout');
    else this.#passTurn(at);
    return forfeit;
  }

  /** The player's connection dropped: the turn clock freezes and grace starts counting. */
  disconnect(player: PlayerId): ActionResult {
    if (this.#phase === 'finished') return fail('finished');
    const side = this.#sides[player];
    if (side.clock.disconnectedAt !== null) return { ok: true };
    side.clock = clockDisconnect(side.clock, this.#now);
    if (this.#phase === 'playing' && this.#frozenSince === null) this.#frozenSince = this.#now;
    this.#record({ type: 'disconnect', player, at: this.#now });
    return { ok: true };
  }

  reconnect(player: PlayerId): ActionResult {
    if (this.#phase === 'finished') return fail('finished');
    const side = this.#sides[player];
    if (side.clock.disconnectedAt === null) return { ok: true };
    side.clock = clockReconnect(side.clock, this.#now);
    const anyoneAway = PLAYERS.some((p) => this.#sides[p].clock.disconnectedAt !== null);
    if (!anyoneAway && this.#frozenSince !== null) {
      this.#turnStartedAt += this.#now - this.#frozenSince;
      this.#frozenSince = null;
    }
    this.#record({ type: 'reconnect', player, at: this.#now });
    return { ok: true };
  }

  #abandon(player: PlayerId): void {
    this.#record({ type: 'abandon', player, at: this.#now });
    this.#finish(opponentOf(player), 'abandon');
  }

  #finish(winner: PlayerId, reason: WinReason): void {
    if (this.#phase === 'finished') return;
    this.#phase = 'finished';
    this.#winner = winner;
    this.#winReason = reason;
    this.#frozenSince = null;
    this.#pushHistory({ kind: 'end', turn: this.#turnNumber, winner, reason });
  }

  // ------------------------------------------------------------ log

  #record(entry: LogEntry): void {
    this.#log.push(entry);
  }

  #pushHistory(entry: HistoryEntry): void {
    this.#history.push({ entry, owner: null, redacted: null });
  }

  #replay(entry: LogEntry): void {
    this.#now = entry.at;
    let result: { ok: boolean; error?: string } = { ok: true };
    switch (entry.type) {
      case 'place':
        result = this.place(entry.player, entry.pieceId, entry.anchor, entry.rotation);
        break;
      case 'move':
        result = this.move(entry.player, entry.pieceId, entry.anchor);
        break;
      case 'rotate':
        result = this.rotate(entry.player, entry.pieceId, entry.rotation);
        break;
      case 'remove':
        result = this.remove(entry.player, entry.pieceId);
        break;
      case 'layout':
        result = this.setLayout(entry.player, entry.placements);
        break;
      case 'auto':
        result = this.autoPlace(entry.player, entry.seed);
        break;
      case 'confirm':
        result = this.confirm(entry.player);
        break;
      case 'attack':
        result = this.attack(entry.player, entry.target);
        break;
      case 'ability':
        result = this.useAbility(entry.player, entry.request);
        break;
      case 'special':
        result = this.special(entry.player, entry.request);
        break;
      case 'tower':
        break; // checked by fromLog
      case 'timeout':
        if (this.#phase !== 'playing' || this.#turn !== entry.player) result = { ok: false, error: 'not-your-turn' };
        else this.#timeout(entry.player, entry.at);
        break;
      case 'surrender':
        result = this.surrender(entry.player);
        break;
      case 'disconnect':
        result = this.disconnect(entry.player);
        break;
      case 'reconnect':
        result = this.reconnect(entry.player);
        break;
      case 'abandon':
        if (this.#phase === 'finished') result = { ok: false, error: 'finished' };
        else this.#abandon(entry.player);
        break;
    }
    if (!result.ok) throw new Error(`Log entry rejected (${entry.type}): ${result.error ?? 'unknown'}`);
  }

  // ------------------------------------------------------------ views

  viewFor(player: PlayerId): PlayerView {
    const opponent = opponentOf(player);
    const own = this.#sides[player];
    const enemy = this.#sides[opponent];
    const deadline =
      this.#phase === 'playing' && this.#frozenSince === null
        ? turnDeadline(this.#clock, this.#sides[this.#turn].clock, this.#turnStartedAt)
        : null;

    return {
      player,
      opponent,
      phase: this.#phase,
      turn: this.#turn,
      turnNumber: this.#turnNumber,
      winner: this.#winner,
      winReason: this.#winReason,
      config: this.#config,
      turnState: {
        extraShotsUsed: this.#extraShots,
        extraShotsLeft: MAX_EXTRA_SHOTS - this.#extraShots,
        abilityUsed: this.#abilityUsed,
        specialUsed: this.#specialUsed,
        shotsLeft: this.#doubleShot ? DOUBLE_SHOTS - this.#shotsTaken : null,
      },
      mutators: this.#mutatorView(),
      own: {
        units: own.units.map((u) => ({ ...u })),
        faction: this.#ownFaction(player),
        cells: this.#ownCells(player),
        pieces: own.pieces.map((piece, slot) => {
          const cells = own.board.cellsOf(slot);
          return {
            id: piece.id,
            role: piece.role,
            placement: own.board.placementOf(slot),
            cells: cells.map((i) => coordOf(this.#size, i)),
            damaged: cells.filter((i) => own.struck[i]).length,
            destroyed: own.destroyed[slot] ?? false,
            shieldTurns: own.shield?.slot === slot ? own.shield.turnsLeft : 0,
          };
        }),
        confirmed: own.confirmed,
        issues: this.#phase === 'placing' ? own.board.issues() : [],
        energy: own.energy,
        energyMax: this.#config.abilities.length > 0 ? this.#energy.max + this.#passive(own.faction, 'energyMax') : 0,
        abilities: this.#config.abilities.map((id) => this.#abilityStatus(player, id)),
        unitCellsTotal: own.unitCells,
        unitCellsLeft: own.unitCells - own.unitHits,
        clock: this.#playerClock(player),
      },
      enemy: {
        units: enemy.units.map((u) => ({ ...u })),
        faction: this.#enemyFaction(opponent),
        cells: this.#enemyCells(player),
        confirmed: enemy.confirmed,
        energy: enemy.energy,
        unitCellsTotal: enemy.unitCells,
        unitCellsLeft: enemy.unitCells - enemy.unitHits,
        remaining: this.#remaining(opponent),
        destroyed: enemy.pieces.flatMap((piece, slot) =>
          enemy.destroyed[slot] ? [{ role: piece.role, cells: enemy.board.cellsOf(slot).map((i) => coordOf(this.#size, i)) }] : [],
        ),
        shieldActive: enemy.shield !== null,
        clock: this.#playerClock(opponent),
        layout: this.#phase === 'finished' ? this.#revealLayout(opponent) : null,
      },
      intel: {
        radar: own.radar.map((r) => ({ ...r, center: { ...r.center } })),
        spy: own.spy.map((s) => ({ ...s })),
        probes: own.probes.map((p) => ({ ...p, target: { ...p.target } })),
      },
      clock: {
        preset: this.#clock.id,
        turnMs: this.#clock.turnMs,
        now: this.#now,
        turnStartedAt: this.#turnStartedAt,
        deadline,
        frozen: this.#frozenSince !== null,
      },
      history: this.#history.map((h) => (h.owner === null || h.owner === player ? h.entry : (h.redacted ?? h.entry))),
    };
  }

  #mutatorView(): MutatorView {
    const tide = this.#mutators.includes('mare')
      ? {
          ...tideAt(this.#phase === 'placing' ? 1 : this.#turnNumber),
          submerged: this.#tideUp(),
          rows: [...TIDE.rows],
          period: TIDE.period,
          duration: TIDE.duration,
        }
      : null;
    return {
      active: [...this.#mutators],
      tide,
      doubleShot: this.#doubleShot ? { shotsPerTurn: DOUBLE_SHOTS } : null,
      fog: this.#mutators.includes('neblina') ? { fadeAfterTurns: FOG_FADE_TURNS } : null,
    };
  }

  #towerView(player: PlayerId): { alive: number; nextFireIn: number } | null {
    const side = this.#sides[player];
    if (!this.#factionsActive || !side.pieces.some((p) => p.role === 'tower')) return null;
    return { alive: this.#countAlive(player, 'tower'), nextFireIn: TOWER_PERIOD - (side.ownTurns % TOWER_PERIOD) };
  }

  #ownFaction(player: PlayerId): OwnFactionView {
    const side = this.#sides[player];
    const f = side.faction;
    return {
      id: f.id,
      name: f.name,
      archetype: f.archetype,
      active: this.#factionsActive,
      special: this.#factionsActive ? this.#specialStatus(player) : null,
      testudo: this.#has(player, 'testudo') ? { used: side.testudoUsed } : null,
      tower: this.#towerView(player),
    };
  }

  #enemyFaction(player: PlayerId): EnemyFactionView {
    const side = this.#sides[player];
    const f = side.faction;
    const special = this.#factionsActive ? specialForMode(f.specialShot, this.#config.name) : null;
    return {
      id: f.id,
      name: f.name,
      archetype: f.archetype,
      active: this.#factionsActive,
      special: special
        ? { id: special.id, name: special.name, kind: special.kind, charges: side.specialCharges, cooldownLeft: side.specialCooldown }
        : null,
      testudo: this.#has(player, 'testudo') ? { used: side.testudoUsed } : null,
      tower: this.#towerView(player),
    };
  }

  #ownCells(player: PlayerId): OwnCell[] {
    const side = this.#sides[player];
    const enemyKnows = this.#sides[opponentOf(player)].spotted;
    return side.terrain.map((terrain, i) => {
      const slot = side.board.occupant[i] ?? -1;
      const piece = slot >= 0 ? side.pieces[slot] : undefined;
      const { col, row } = coordOf(this.#size, i);
      return {
        col,
        row,
        terrain,
        pieceId: piece?.id ?? null,
        role: piece?.role ?? null,
        struck: side.struck[i] === 1,
        exposed: piece !== undefined && !side.struck[i] && (enemyKnows.has(i) || side.shieldMarks.has(i)),
      };
    });
  }

  #enemyCells(player: PlayerId): EnemyCell[] {
    const opponent = opponentOf(player);
    const enemy = this.#sides[opponent];
    const own = this.#sides[player];
    return enemy.terrain.map((terrain, i) => {
      const { col, row } = coordOf(this.#size, i);
      const shield = enemy.shieldMarks.has(i);
      if (enemy.struck[i]) {
        const slot = enemy.board.occupant[i] ?? -1;
        if (slot < 0) {
          if (this.#faded(opponent, i)) return { col, row, state: 'hidden', role: null, shield: false };
          return { col, row, state: terrain, role: null, shield };
        }
        const role = enemy.destroyed[slot] ? (enemy.pieces[slot]?.role ?? null) : null;
        return { col, row, state: 'hit', role, shield };
      }
      // Spotted cells stay spotted only while the unit is still there (not repaired away).
      if ((own.spotted.has(i) || shield) && (enemy.board.occupant[i] ?? -1) >= 0) return { col, row, state: 'spotted', role: null, shield };
      const probed = own.probed.get(i);
      if (probed) return { col, row, state: probed, role: null, shield: false };
      return { col, row, state: 'hidden', role: null, shield: false };
    });
  }

  #remaining(player: PlayerId): RoleCount[] {
    const side = this.#sides[player];
    const counts = new Map<RoleId, number>();
    side.pieces.forEach((piece, slot) => {
      counts.set(piece.role, (counts.get(piece.role) ?? 0) + (side.destroyed[slot] ? 0 : 1));
    });
    return [...counts].map(([role, count]) => ({ role, count }));
  }

  #playerClock(player: PlayerId): PlayerClockView {
    const clock = this.#sides[player].clock;
    return {
      bankMs: clock.bankMs,
      strikes: clock.strikes,
      consecutiveStrikes: clock.consecutiveStrikes,
      connected: clock.disconnectedAt === null,
      graceLeftMs: graceLeft(this.#clock, clock, this.#now),
    };
  }

  #revealLayout(player: PlayerId) {
    const side = this.#sides[player];
    return {
      rocks: side.terrain.flatMap((t, i) => (t === 'rock' ? [coordOf(this.#size, i)] : [])),
      pieces: side.pieces.map((piece, slot) => ({
        id: piece.id,
        role: piece.role,
        cells: side.board.cellsOf(slot).map((i) => coordOf(this.#size, i)),
      })),
    };
  }

  /**
   * Complete authoritative state as plain data, for persistence checks and
   * debugging. It contains both layouts: never send it to a player.
   */
  serverState(): unknown {
    const side = (player: PlayerId) => {
      const s = this.#sides[player];
      return {
        faction: s.faction.id,
        terrain: s.terrain.join(''),
        placements: s.board.placements(),
        destroyed: [...s.destroyed],
        struck: Array.from(s.struck).join(''),
        struckAt: Array.from(s.struckAt),
        shieldMarks: [...s.shieldMarks].sort((a, b) => a - b),
        confirmed: s.confirmed,
        energy: s.energy,
        cooldowns: { ...s.cooldowns },
        shield: s.shield ? { ...s.shield } : null,
        radar: s.radar,
        spy: s.spy,
        probes: s.probes,
        probed: [...s.probed].sort((a, b) => a[0] - b[0]),
        spotted: [...s.spotted].sort((a, b) => a - b),
        clock: { ...s.clock },
        autoCount: s.autoCount,
        unitHits: s.unitHits,
        specialCharges: s.specialCharges,
        specialCooldown: s.specialCooldown,
        testudoUsed: s.testudoUsed,
        ownTurns: s.ownTurns,
      };
    };
    return {
      seed: this.#seed,
      mutators: this.#mutators,
      phase: this.#phase,
      turn: this.#turn,
      turnNumber: this.#turnNumber,
      extraShots: this.#extraShots,
      abilityUsed: this.#abilityUsed,
      specialUsed: this.#specialUsed,
      shotsTaken: this.#shotsTaken,
      winner: this.#winner,
      winReason: this.#winReason,
      turnStartedAt: this.#turnStartedAt,
      frozenSince: this.#frozenSince,
      rng: this.#rng.state,
      blue: side('blue'),
      red: side('red'),
      history: this.#history,
    };
  }
}

function copySpecialRequest(request: SpecialShotRequest): SpecialShotRequest {
  return {
    target: { col: request.target.col, row: request.target.row },
    ...(request.axis ? { axis: request.axis } : {}),
    ...(request.second ? { second: { col: request.second.col, row: request.second.row } } : {}),
  };
}

const BLOCKER_ERROR: Readonly<Record<AbilityBlocker, MatchError>> = {
  disabled: 'abilities-disabled',
  'not-your-turn': 'not-your-turn',
  'already-used': 'ability-used',
  cooldown: 'cooldown',
  energy: 'energy',
  'missing-piece': 'missing-piece',
};

const SPECIAL_BLOCKER_ERROR: Readonly<Record<SpecialBlocker, MatchError>> = {
  disabled: 'no-special',
  'not-your-turn': 'not-your-turn',
  'already-used': 'special-used',
  cooldown: 'cooldown',
  energy: 'energy',
  'no-charges': 'no-charges',
  'no-target': 'no-target',
};

/** Convenience used by tests and tools: both players auto-place and confirm. */
export function startAutoMatch(options: MatchOptions): Match {
  const match = new Match(options);
  for (const player of PLAYERS) {
    match.autoPlace(player);
    match.confirm(player);
  }
  return match;
}
