import { Group, Mesh, Vector3 } from 'three';
import { easeOutBack, easeOutCubic } from '../anim/easing';
import type { Tweens } from '../anim/tweens';
import { TILE_TOP, cellCenter, type Side } from '../board/layout';
import { activeUnitFactories, type UnitFactoryRegistry } from './factories';
import { flagGeometry, flagMaterial } from './flag';
import {
  ROLE_SHAPES,
  footprintCells,
  resolveRole,
  rotateOffsets,
  shapeCentroid,
  shapeExtent,
  type CellOffset,
  type QuarterTurns,
  type TeamId,
  type UnitRole,
} from './roles';
import { MAX_SCORCH_CELLS, createUnitMaterial, type UnitBodyMaterial } from './unitMaterial';
import type { UnitEmitKind, UnitModel, WreckContext } from './unitModel';

export interface UnitPlacement {
  /** A role id, or a legacy id (soldier/tank/tower) which is mapped to a role. */
  role: UnitRole | string;
  team: TeamId;
  side: Side;
  /** Top-left cell of the rotated footprint (same convention as the core). */
  origin: CellOffset;
  rotation?: QuarterTurns;
  /** Squeeze the model into the origin cell (one-cell legacy matches). */
  compact?: boolean;
  factories?: UnitFactoryRegistry;
}

export type UnitEmitter = (kind: UnitEmitKind, world: Vector3) => void;

/**
 * A unit standing on the board. Owns the role model and its per-unit material
 * (hit flash, per-cell scorch, charred wreck) and places the model over its
 * footprint: mirrored for the far field, rotated in quarter turns.
 */
export class UnitPiece {
  readonly group = new Group();
  readonly role: UnitRole;
  readonly team: TeamId;
  readonly side: Side;
  readonly cells: readonly CellOffset[];
  readonly model: UnitModel;
  readonly #lift = new Group();
  readonly #material: UnitBodyMaterial;
  readonly #phase: number;
  #emit: UnitEmitter = () => undefined;
  #destroyed = false;
  #flash = 0;
  #flagMesh: Mesh | null = null;

  constructor(placement: UnitPlacement) {
    this.role = resolveRole(placement.role);
    this.team = placement.team;
    this.side = placement.side;
    const rotation = placement.rotation ?? 0;
    this.cells = placement.compact ? [placement.origin] : footprintCells(this.role, placement.origin, rotation);

    this.#material = createUnitMaterial(this.team);
    const factories = placement.factories ?? activeUnitFactories(this.team);
    this.model = factories[this.role]({ team: this.team, body: this.#material });

    const orient = new Group();
    orient.rotation.y = -rotation * (Math.PI / 2);
    orient.add(this.model);
    this.#lift.add(orient);
    this.group.add(this.#lift);

    // Centre of the rotated footprint, in world space.
    const rotated = rotateOffsets(ROLE_SHAPES[this.role], rotation);
    const centre = placement.compact ? { col: 0, row: 0 } : shapeCentroid(rotated);
    const col = placement.origin.col + centre.col;
    const row = placement.origin.row + centre.row;
    this.group.position.copy(cellCenter(this.side, col, row, TILE_TOP));
    // The far field runs the other way along z; mirroring keeps the footprint exact.
    if (this.side === 'enemy') this.group.scale.z = -1;
    if (placement.compact) {
      const extent = shapeExtent(ROLE_SHAPES[this.role]);
      this.model.scale.setScalar(Math.min(1, 1.15 / Math.max(extent.cols, extent.rows)));
    }

    this.#phase = this.group.position.x * 1.3 + this.group.position.z * 0.7;
    this.#writeScorchCells();
    this.#attachFlag();
    this.group.name = `unit-${this.team}-${this.role}`;
    this.group.traverse((object) => {
      if (object instanceof Mesh) object.userData.unitPiece = this;
    });
  }

  /** Legacy alias used by the match code. */
  get player(): TeamId {
    return this.team;
  }

  get type(): UnitRole {
    return this.role;
  }

  get destroyed(): boolean {
    return this.#destroyed;
  }

  get material(): UnitBodyMaterial {
    return this.#material;
  }

  /** Routes sparks/smoke requests from the wreck animations to the effects layer. */
  setEmitter(emit: UnitEmitter): void {
    this.#emit = emit;
  }

  occupies(col: number, row: number): boolean {
    return this.cells.some((cell) => cell.col === col && cell.row === row);
  }

  update(time: number, calm: boolean, dt = 1 / 60): void {
    if (this.#flash > 0) {
      this.#flash = Math.max(0, this.#flash - dt * 3.2);
      this.#material.userData.unit.flash.value = this.#flash * this.#flash;
    }
    if (this.#destroyed || calm) return;
    this.model.idle(time + this.#phase, dt);
  }

  /** White-hot blink, used for hits and hit-stops. */
  flash(level = 1): void {
    this.#flash = Math.max(this.#flash, level);
    this.#material.userData.unit.flash.value = this.#flash * this.#flash;
  }

  /** Marks one covered cell as hit: it scorches and the whole piece flashes. */
  hitCell(col: number, row: number, tweens?: Tweens): void {
    const index = this.cells.findIndex((cell) => cell.col === col && cell.row === row);
    const target = this.#material.userData.unit.scorch.value[index];
    this.flash(1);
    if (!target) return;
    if (!tweens) {
      target.w = 1;
      return;
    }
    void tweens.run(0.5, (t) => {
      target.w = Math.max(target.w, easeOutCubic(t));
    });
  }

  isCellHit(col: number, row: number): boolean {
    const index = this.cells.findIndex((cell) => cell.col === col && cell.row === row);
    return (this.#material.userData.unit.scorch.value[index]?.w ?? 0) > 0.5;
  }

  /** Pops the piece out of a freshly opened tile. */
  async rise(tweens: Tweens): Promise<void> {
    this.#lift.scale.setScalar(0.001);
    await tweens.run(0.38, (t) => {
      this.#lift.scale.setScalar(Math.max(0.001, easeOutBack(t)));
      this.#lift.position.y = -0.2 * (1 - easeOutCubic(t));
    });
  }

  /**
   * Plays the role's destruction and leaves a charred wreck. The second
   * argument is ignored and kept only so older callers still compile.
   */
  async destroy(tweens: Tweens, _legacyCharred?: unknown): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    const state = this.#material.userData.unit;
    this.flash(1);
    state.scorch.value.slice(0, this.cells.length).forEach((cell) => (cell.w = Math.max(cell.w, 0.6)));
    const context: WreckContext = { tweens, random: Math.random, emit: (kind, world) => this.#emit(kind, world) };
    const char = tweens.run(1.2, (t) => {
      state.char.value = easeOutCubic(t) * 0.9;
      if (this.role !== 'generator') state.lights.value = 1 - t;
    });
    if (this.#flagMesh) this.#flagMesh.visible = false;
    await Promise.all([this.model.wreck(context), char]);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.#material.dispose();
  }

  #attachFlag(): void {
    const anchor = this.model.flagAnchor;
    if (!anchor || this.role === 'workshop') return;
    const flag = new Mesh(flagGeometry(), flagMaterial(this.team));
    flag.scale.setScalar(0.7);
    flag.castShadow = true;
    anchor.add(flag);
    this.#flagMesh = flag;
  }

  #writeScorchCells(): void {
    const slots = this.#material.userData.unit.scorch.value;
    this.cells.slice(0, MAX_SCORCH_CELLS).forEach((cell, i) => {
      const centre = this.cells.length === 1 ? this.group.position : cellCenter(this.side, cell.col, cell.row);
      slots[i]?.set(centre.x, 0, centre.z, 0);
    });
  }
}

