import { Color, DynamicDrawUsage, Euler, InstancedMesh, Matrix4, Quaternion, Vector3, type Material } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { easeInOutCubic, easeOutCubic, damp } from '../anim/easing';
import type { Tweens } from '../anim/tweens';
import type { MaterialLibrary } from '../materials/library';
import type { Palette } from '../materials/palettes';
import { hash2 } from '../util/random';
import { COLS, ROWS, TILE_HEIGHT, TILE_SIZE, cellIndexOf, cellX, cellZ, type Side } from './layout';

interface TileState {
  x: number;
  z: number;
  /** 0 = cap facing up (closed), 1 = soil facing up (open). */
  flip: number;
  lift: number;
  hover: number;
  hoverTarget: number;
  wobble: number;
  /** Tint of the marble cap (checker colour). */
  cap: Color;
  /** Tint of the soil face. */
  soil: Color;
  scorched: boolean;
}

/** Only the checker colours matter to the tiles (palettes and themes both provide them). */
export type TilePalette = Pick<Palette, 'capLight' | 'capDark'>;

/** Bevel subdivisions per quality: 3 → ~590 triangles per tile, 1 → 108. */
const BEVEL_SEGMENTS = { high: 3, low: 1 } as const;

function tileGeometry(segments: number): RoundedBoxGeometry {
  return new RoundedBoxGeometry(TILE_SIZE, TILE_HEIGHT, TILE_SIZE, segments, 0.045);
}

const HOVER_LIFT = 0.13;
const HOVER_BRIGHTEN = 1.45;
const SCORCH_TINT = new Color(0.32, 0.27, 0.24);

const tmpMatrix = new Matrix4();
const tmpPosition = new Vector3();
const tmpQuaternion = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3(1, 1, 1);
const tmpColor = new Color();

/**
 * One field of tiles drawn as a single instanced mesh. The box's top face is
 * the closed marble cap and the bottom face is soil, so "revealing" a tile is
 * literally flipping it over.
 */
export class TileField {
  readonly mesh: InstancedMesh;
  readonly side: Side;
  readonly #tiles: TileState[] = [];
  #hovered: number | null = null;
  #segments: number = BEVEL_SEGMENTS.high;
  #palette: TilePalette;

  constructor(side: Side, materials: MaterialLibrary, palette: TilePalette) {
    this.side = side;
    this.#palette = palette;
    const geometry = tileGeometry(BEVEL_SEGMENTS.high);
    // Box face order: +x, -x, +y, -y, +z, -z.
    const faceMaterials: Material[] = [
      materials.tileSide,
      materials.tileSide,
      materials.tileCap,
      materials.tileSoil,
      materials.tileSide,
      materials.tileSide,
    ];
    this.mesh = new InstancedMesh(geometry, faceMaterials, COLS * ROWS);
    this.mesh.name = `tiles-${side}`;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        this.#tiles[cellIndexOf(col, row)] = {
          x: cellX(col),
          z: cellZ(side, row),
          flip: side === 'own' ? 1 : 0,
          lift: 0,
          hover: 0,
          hoverTarget: 0,
          wobble: 0,
          cap: new Color(),
          soil: new Color(),
          scorched: false,
        };
      }
    }
    this.reset();
  }

  /** Swaps the tile mesh for a cheaper (or finer) bevel. */
  setQuality(quality: 'high' | 'low'): void {
    const segments = BEVEL_SEGMENTS[quality];
    if (segments === this.#segments) return;
    const old = this.mesh.geometry;
    this.mesh.geometry = tileGeometry(segments);
    this.#segments = segments;
    old.dispose();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }

  /** Closes (or, for the own field, opens) every tile again. */
  reset(): void {
    this.#tiles.forEach((tile, index) => {
      tile.flip = this.side === 'own' ? 1 : 0;
      tile.lift = 0;
      tile.hover = 0;
      tile.hoverTarget = 0;
      tile.wobble = 0;
      tile.scorched = false;
      this.#writeMatrix(index);
    });
    this.#hovered = null;
    this.applyPalette(this.#palette);
  }

  applyPalette(palette: TilePalette): void {
    this.#palette = palette;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const tile = this.#tile(cellIndexOf(col, row));
        const light = (col + row) % 2 === 0;
        // Soil only gets a gentle checker so the grid stays readable.
        const shade = (light ? 1 : 0.8) * (0.92 + hash2(col, row) * 0.12);
        tile.soil.setRGB(shade, shade, shade);
        tile.cap.copy(light ? palette.capLight : palette.capDark);
        this.#writeColor(cellIndexOf(col, row));
      }
    }
  }

  isOpen(index: number): boolean {
    return this.#tile(index).flip >= 1;
  }

  setHovered(index: number | null): void {
    if (index === this.#hovered) return;
    if (this.#hovered !== null) this.#tile(this.#hovered).hoverTarget = 0;
    if (index !== null) this.#tile(index).hoverTarget = 1;
    this.#hovered = index;
  }

  get hovered(): number | null {
    return this.#hovered;
  }

  /** World-space top centre of a tile, including its current lift. */
  topOf(index: number, target = new Vector3()): Vector3 {
    const tile = this.#tile(index);
    return target.set(tile.x, TILE_HEIGHT + tile.lift + tile.hover * HOVER_LIFT, tile.z);
  }

  scorch(index: number): void {
    this.#tile(index).scorched = true;
    this.#writeColor(index);
  }

  /** Quick dip used as click feedback before the shot lands. */
  async press(index: number, tweens: Tweens): Promise<void> {
    const tile = this.#tile(index);
    await tweens.run(0.16, (t) => {
      tile.lift = -0.06 * Math.sin(Math.PI * t);
      this.#writeMatrix(index);
    });
  }

  /** Throws the tile up, spins it over and lands it soil-side up. */
  async flipOpen(index: number, tweens: Tweens, onLand?: () => void): Promise<void> {
    const tile = this.#tile(index);
    tile.wobble = (hash2(index, 3) - 0.5) * 0.5;
    await tweens.run(0.62, (t) => {
      tile.flip = easeInOutCubic(t);
      tile.lift = Math.sin(Math.PI * t) * 1.05;
      this.#writeMatrix(index);
      this.#writeColor(index);
    });
    tile.flip = 1;
    tile.wobble = 0;
    onLand?.();
    await tweens.run(0.22, (t) => {
      tile.lift = -0.045 * Math.sin(Math.PI * easeOutCubic(t));
      this.#writeMatrix(index);
    });
    tile.lift = 0;
    this.#writeMatrix(index);
  }

  update(dt: number): void {
    const k = damp(14, dt);
    this.#tiles.forEach((tile, index) => {
      if (Math.abs(tile.hover - tile.hoverTarget) < 0.001) {
        if (tile.hover !== tile.hoverTarget) {
          tile.hover = tile.hoverTarget;
          this.#writeMatrix(index);
          this.#writeColor(index);
        }
        return;
      }
      tile.hover += (tile.hoverTarget - tile.hover) * k;
      this.#writeMatrix(index);
      this.#writeColor(index);
    });
  }

  #tile(index: number): TileState {
    const tile = this.#tiles[index];
    if (!tile) throw new Error(`Tile ${index} out of range`);
    return tile;
  }

  #writeMatrix(index: number): void {
    const tile = this.#tile(index);
    const hoverLift = this.side === 'enemy' && tile.flip < 1 ? tile.hover * HOVER_LIFT : 0;
    tmpPosition.set(tile.x, TILE_HEIGHT / 2 + tile.lift + hoverLift, tile.z);
    const spin = Math.sin(Math.PI * tile.flip) * tile.wobble;
    tmpEuler.set(Math.PI * tile.flip, spin, spin * 0.5);
    tmpQuaternion.setFromEuler(tmpEuler);
    tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
    this.mesh.setMatrixAt(index, tmpMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  #writeColor(index: number): void {
    const tile = this.#tile(index);
    tmpColor.copy(tile.flip > 0.5 ? tile.soil : tile.cap);
    if (tile.scorched) tmpColor.multiply(SCORCH_TINT);
    const glow = this.side === 'enemy' && tile.flip < 1 ? tile.hover * (HOVER_BRIGHTEN - 1) : 0;
    tmpColor.multiplyScalar(1 + glow);
    this.mesh.setColorAt(index, tmpColor);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
