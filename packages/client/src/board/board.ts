import { Color, Group, type Raycaster, type Texture, type Vector3 } from 'three';
import type { EffectsDirector } from '../effects/fx';
import { ROCK_RIM, type MaterialLibrary } from '../materials/library';
import type { Palette } from '../materials/palettes';
import type { ThemeDef } from '../materials/themes';
import { SUN_DIRECTION } from '../scene/stage';
import { RockPiece } from '../units/rockPiece';
import { inferPlacement, resolveRole, type QuarterTurns, type TeamId } from '../units/roles';
import { UNIT_THEME_UNIFORMS } from '../units/unitMaterial';
import { UnitPiece, type UnitPlacement } from '../units/unitPiece';
import { BankProps } from './bankProps';
import { CoordinateLabels, type CoordinateMode } from './coordinates';
import { createBoardShell, riverBedMaterial } from './frame';
import { HoverMarker } from './hoverMarker';
import { COLS, cellCenter, cellIndexOf, type Side } from './layout';
import { ResultMarkers, type ResultKind } from './resultMarkers';
import { TileField } from './tiles';
import { Lake } from './water';
import { WildlifeController, type WildlifeQuality } from './wildlife/controller';

export type CellPiece = UnitPiece | RockPiece;

/**
 * What the board needs to know about a cell. Matches the current core views
 * structurally; the optional role fields let multi-cell units be placed whole.
 */
export interface CellContent {
  readonly col: number;
  readonly row: number;
  /** 'earth' | 'rock' | 'unit' (older views) ... */
  readonly kind?: string;
  /** ... or terrain + role (newer views). */
  readonly terrain?: string;
  /** Legacy unit id (soldier/tank/tower) or a role id. */
  readonly unit?: string | null;
  readonly role?: string | null;
  /** Top-left cell of the unit's footprint, if the view provides it. */
  readonly origin?: { readonly col: number; readonly row: number } | null;
  readonly rotation?: number | null;
  readonly unitId?: string | number | null;
}

/** A whole unit as multi-cell views describe it. */
export interface PieceContent {
  readonly id?: string;
  readonly role: string;
  readonly cells: readonly { readonly col: number; readonly row: number }[];
  readonly placement?: { readonly anchor: { readonly col: number; readonly row: number }; readonly rotation: number } | null;
}

function kindOf(cell: CellContent): string {
  if (cell.kind) return cell.kind;
  if (cell.role || cell.unit) return 'unit';
  return cell.terrain ?? 'earth';
}

/**
 * Everything that sits on the table: the static shell, both tile fields, the
 * river with its wildlife, result markers and the pieces on the cells.
 */
export class Board {
  readonly group = new Group();
  readonly ownTiles: TileField;
  readonly enemyTiles: TileField;
  readonly lake: Lake;
  readonly wildlife: WildlifeController;
  readonly markers = new ResultMarkers();
  readonly marker = new HoverMarker();
  readonly bankProps = new BankProps();
  /** Column letters and row numbers; see setCoordinateMode. */
  readonly coordinates = new CoordinateLabels();
  #hoverKey = -2;
  readonly #materials: MaterialLibrary;
  readonly #pieces = new Group();
  readonly #contents: Record<Side, Map<number, CellPiece>> = { own: new Map(), enemy: new Map() };
  readonly #themeTextures: Texture[] = [];
  #fx: EffectsDirector | null = null;

  constructor(materials: MaterialLibrary, palette: Palette, reducedMotion: () => boolean) {
    this.#materials = materials;
    this.ownTiles = new TileField('own', materials, palette);
    this.enemyTiles = new TileField('enemy', materials, palette);
    this.lake = new Lake(SUN_DIRECTION, reducedMotion);
    this.wildlife = new WildlifeController(this.lake, {
      species: ['fish', 'lilypads', 'heron', 'dragonflies', 'drifters', 'fireflies', 'birdsong'],
      reducedMotion,
    });
    this.#pieces.name = 'pieces';
    this.group.add(
      createBoardShell(materials),
      this.ownTiles.mesh,
      this.enemyTiles.mesh,
      this.lake.group,
      this.wildlife.group,
      this.bankProps.group,
      this.coordinates.mesh,
      this.#pieces,
      this.markers.group,
      this.marker.mesh,
    );
  }

  applyPalette(palette: Palette): void {
    this.ownTiles.applyPalette(palette);
    this.enemyTiles.applyPalette(palette);
    this.#materials.frame.color.copy(palette.frameTint);
  }

  /** Lets wreck animations ask for sparks/smoke/dust. */
  attachEffects(fx: EffectsDirector): void {
    this.#fx = fx;
    for (const side of ['own', 'enemy'] as const) {
      for (const piece of this.#contents[side].values()) if (piece instanceof UnitPiece) this.#wire(piece);
    }
  }

  /** Retextures terrain, river and wildlife for a theme. Old theme textures are freed. */
  applyTheme(theme: ThemeDef): void {
    const m = this.#materials;
    const p = theme.palette;
    const caps = { capLight: new Color(p.capLight), capDark: new Color(p.capDark) };
    this.ownTiles.applyPalette(caps);
    this.enemyTiles.applyPalette(caps);
    m.frame.color.set(p.frameTint);
    m.table.color.set(p.table);
    m.plate.color.set(p.plate);
    m.stone.color.set(p.bankStone);
    m.rock.color.set(p.rock);
    ROCK_RIM.value.set(p.rockRim ?? '#b8b0a4');
    riverBedMaterial.color.set(p.riverBed);

    const soil = theme.terrain.soil();
    const oldMap = m.tileSoil.map;
    const oldGlow = m.tileSoil.emissiveMap;
    m.tileSoil.map = soil.map;
    m.tileSoil.emissiveMap = soil.glow ?? null;
    m.tileSoil.emissive.set(soil.glow ? (theme.terrain.soilGlowColor ?? '#ff6a20') : '#000000');
    m.tileSoil.emissiveIntensity = soil.glow ? (theme.terrain.soilGlowIntensity ?? 1) : 1;
    m.tileSoil.roughness = theme.terrain.soilRoughness;
    m.tileSoil.needsUpdate = true;
    oldMap?.dispose();
    oldGlow?.dispose();
    this.#themeTextures.length = 0;
    this.#themeTextures.push(soil.map, ...(soil.glow ? [soil.glow] : []));

    this.lake.setParams(theme.water);
    this.bankProps.setKinds(theme.bankProps ?? []);
    this.wildlife.setSpecies(theme.ambientLife);
    this.wildlife.setDusk(theme.dusk);
    UNIT_THEME_UNIFORMS.uSnow.value = theme.unitLook.snow;
    UNIT_THEME_UNIFORMS.uHeat.value = theme.unitLook.heat;
  }

  /** Coordinates on the frame: 'engraved' (default), 'billboard' (camera facing) or 'off'. */
  setCoordinateMode(mode: CoordinateMode): void {
    this.coordinates.setMode(mode);
  }

  /** Wildlife cast size and tile bevel detail. */
  setQuality(quality: WildlifeQuality | 'alto' | 'baixo'): void {
    this.wildlife.setQuality(quality);
    const tier = quality === 'low' || quality === 'baixo' ? 'low' : 'high';
    this.ownTiles.setQuality(tier);
    this.enemyTiles.setQuality(tier);
  }

  /** Clears every piece and marker and closes the enemy tiles for a new match. */
  reset(): void {
    for (const side of ['own', 'enemy'] as const) {
      for (const piece of new Set(this.#contents[side].values())) piece.dispose();
      this.#contents[side].clear();
    }
    this.markers.clear();
    this.ownTiles.reset();
    this.enemyTiles.reset();
  }

  /**
   * Places the player's own rocks and units, which they are allowed to see.
   * With `pieces` (multi-cell views) units are placed whole from them and
   * only rocks are taken from `cells`.
   */
  populateOwn(cells: readonly CellContent[], player: TeamId, pieces?: readonly PieceContent[]): void {
    const placed = new Set<string>();
    if (pieces) {
      for (const piece of pieces) this.placePiece(piece, player, 'own');
      for (const cell of cells) if (kindOf(cell) === 'rock') this.#createPiece('own', { ...cell, kind: 'rock' }, player);
      return;
    }
    for (const cell of cells) {
      const kind = kindOf(cell);
      if (kind === 'earth') continue;
      if (kind === 'rock') {
        this.#createPiece('own', { ...cell, kind }, player);
        continue;
      }
      const role = cell.role ?? cell.unit;
      if (role && cell.origin) {
        const key = String(cell.unitId ?? `${cell.origin.col}:${cell.origin.row}`);
        if (placed.has(key)) continue;
        placed.add(key);
        this.placeUnit({ role, team: player, side: 'own', origin: cell.origin, rotation: ((cell.rotation ?? 0) & 3) as 0 | 1 | 2 | 3 });
        continue;
      }
      this.#createPiece('own', cell, player);
    }
  }

  /** Spawns the piece uncovered under an enemy tile (null for plain earth). */
  revealEnemy(col: number, row: number, revealed: Omit<CellContent, 'col' | 'row'>, owner: TeamId): CellPiece | null {
    return this.#createPiece('enemy', { ...revealed, col, row }, owner);
  }

  /**
   * Places a unit from a view that lists its cells (and maybe its anchor and
   * rotation). Returns null if the cells do not fit the role's shape.
   */
  placePiece(piece: PieceContent, team: TeamId, side: Side): UnitPiece | null {
    const role = resolveRole(piece.role);
    const fromView = piece.placement ? { origin: piece.placement.anchor, rotation: (piece.placement.rotation & 3) as QuarterTurns } : null;
    const fit = fromView ?? inferPlacement(role, piece.cells);
    if (!fit) return null;
    const unit = this.placeUnit({ role, team, side, origin: fit.origin, rotation: fit.rotation });
    if (piece.id) unit.group.userData.pieceId = piece.id;
    return unit;
  }

  /** Places a whole (possibly multi-cell) unit. */
  placeUnit(placement: UnitPlacement): UnitPiece {
    const piece = new UnitPiece(placement);
    for (const cell of piece.cells) this.#contents[placement.side].set(cellIndexOf(cell.col, cell.row), piece);
    this.#wire(piece);
    this.#pieces.add(piece.group);
    return piece;
  }

  pieceAt(side: Side, col: number, row: number): CellPiece | null {
    return this.#contents[side].get(cellIndexOf(col, row)) ?? null;
  }

  unitAt(side: Side, col: number, row: number): UnitPiece | null {
    const piece = this.pieceAt(side, col, row);
    return piece instanceof UnitPiece ? piece : null;
  }

  /** Every unit piece currently on the board (each once). */
  units(side?: Side): UnitPiece[] {
    const sides: Side[] = side ? [side] : ['own', 'enemy'];
    const out = new Set<UnitPiece>();
    for (const s of sides) for (const piece of this.#contents[s].values()) if (piece instanceof UnitPiece) out.add(piece);
    return [...out];
  }

  /** Persistent symbol on a revealed cell (X earth, diamond rock, burst unit). */
  markResult(side: Side, col: number, row: number, kind: ResultKind): void {
    this.markers.mark(side, col, row, kind);
  }

  /** Forwards an impact to the river life (fish flee, frogs dive, ice cracks...). */
  onImpact(at: Vector3, power = 1): void {
    this.wildlife.onExplosion(at, power);
    this.bankProps.gust(power * 0.6);
  }

  /** Index of the closed enemy tile under the ray, if any. */
  pickEnemy(raycaster: Raycaster): number | null {
    const hit = raycaster.intersectObject(this.enemyTiles.mesh, false)[0];
    if (hit?.instanceId === undefined) return null;
    return this.enemyTiles.isOpen(hit.instanceId) ? null : hit.instanceId;
  }

  update(dt: number, time: number, calm: boolean): void {
    UNIT_THEME_UNIFORMS.uUnitTime.value = time;
    this.ownTiles.update(dt);
    this.enemyTiles.update(dt);
    this.#echoHover();
    this.lake.update(dt);
    this.wildlife.update(dt);
    this.bankProps.update(dt);
    this.markers.update(dt);
    this.marker.update(dt, time);
    for (const side of ['own', 'enemy'] as const) {
      let last: CellPiece | null = null;
      for (const piece of this.#contents[side].values()) {
        // Multi-cell units appear once per cell; consecutive entries are the common case.
        if (piece === last) continue;
        last = piece;
        if (piece instanceof UnitPiece) piece.update(time, calm, dt);
      }
    }
  }

  dispose(): void {
    this.reset();
    this.wildlife.dispose();
    this.bankProps.dispose();
    this.coordinates.dispose();
    this.ownTiles.dispose();
    this.enemyTiles.dispose();
    this.lake.dispose();
    this.markers.dispose();
    for (const texture of this.#themeTextures) texture.dispose();
    this.group.removeFromParent();
  }

  /** The aimed cell's letter and number light up on the frame edges. */
  #echoHover(): void {
    const enemy = this.enemyTiles.hovered;
    const own = this.ownTiles.hovered;
    const key = enemy !== null ? enemy : own !== null ? 1000 + own : -1;
    if (key === this.#hoverKey) return;
    this.#hoverKey = key;
    if (key < 0) this.coordinates.setHover(null);
    else {
      const index = key % 1000;
      this.coordinates.setHover({ side: key >= 1000 ? 'own' : 'enemy', col: index % COLS, row: Math.floor(index / COLS) });
    }
  }

  #wire(piece: UnitPiece): void {
    const fx = this.#fx;
    if (fx) piece.setEmitter((kind, world) => fx.unitEmit(kind, world));
  }

  #createPiece(side: Side, cell: CellContent, owner: TeamId): CellPiece | null {
    const { col, row } = cell;
    let piece: CellPiece | null = null;
    if (kindOf(cell) === 'rock') {
      piece = new RockPiece(this.#materials.rock, cellCenter(side, col, row), (col * 7 + row * 3) % 6);
    } else if (kindOf(cell) === 'unit') {
      const role = cell.role ?? cell.unit;
      if (!role) return null;
      if (cell.origin) {
        const rotation = ((cell.rotation ?? 0) & 3) as 0 | 1 | 2 | 3;
        return this.placeUnit({ role, team: owner, side, origin: cell.origin, rotation });
      }
      piece = new UnitPiece({ role, team: owner, side, origin: { col, row }, compact: true });
      this.#wire(piece);
    }
    if (piece) {
      this.#contents[side].set(cellIndexOf(col, row), piece);
      this.#pieces.add(piece.group);
    }
    return piece;
  }
}
