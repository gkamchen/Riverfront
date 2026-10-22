import { PerspectiveCamera, Vector3 } from 'three';
import { damp } from '../anim/easing';
import { OUTER_HALF_X, OUTER_HALF_Z } from '../board/layout';

export type ViewPreset = 'default' | 'top' | 'side';

interface Orbit {
  azimuth: number;
  polar: number;
  /** Multiplier on the distance that fits the board on screen. */
  zoom: number;
  target: Vector3;
}

const PRESETS: Record<ViewPreset, Omit<Orbit, 'target'> & { target: [number, number, number] }> = {
  default: { azimuth: 0, polar: 0.86, zoom: 1, target: [0, 0, 0.6] },
  top: { azimuth: 0, polar: 0.02, zoom: 1.0, target: [0, 0, 0] },
  side: { azimuth: Math.PI / 2, polar: 0.98, zoom: 0.95, target: [0, 0, 0] },
};

const POLAR_MIN = 0.02;
const POLAR_MAX = 1.32;

/**
 * Orbit camera with smooth, damped transitions between presets, user drag,
 * a 180° flip and a short trauma-based shake.
 */
export class CameraRig {
  readonly camera: PerspectiveCamera;
  readonly #current: Orbit;
  readonly #desired: Orbit;
  #preset: ViewPreset = 'default';
  #flipped = false;
  #focusOffset = 0;
  #trauma = 0;
  #time = 0;
  #reducedMotion = false;
  #portrait = false;
  #lookZ: number | null = null;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(36, aspect, 0.1, 400);
    const start = PRESETS.default;
    // Start a little further and lower so the first frames glide into place.
    this.#current = { azimuth: -0.5, polar: 1.2, zoom: 1.5, target: new Vector3(...start.target) };
    this.#desired = { azimuth: start.azimuth, polar: start.polar, zoom: start.zoom, target: new Vector3(...start.target) };
    this.#apply();
  }

  get preset(): ViewPreset {
    return this.#preset;
  }

  get flipped(): boolean {
    return this.#flipped;
  }

  setReducedMotion(reduced: boolean): void {
    this.#reducedMotion = reduced;
  }

  setPreset(preset: ViewPreset): void {
    this.#preset = preset;
    const p = PRESETS[preset];
    // On tall screens the default view turns sideways so the long board fills the height.
    const portraitDefault = preset === 'default' && this.#portrait;
    const azimuth = portraitDefault ? Math.PI / 2 : p.azimuth;
    this.#desired.azimuth = this.#nearestAzimuth(azimuth + (this.#flipped ? Math.PI : 0));
    this.#desired.polar = portraitDefault ? 0.55 : p.polar;
    this.#desired.zoom = p.zoom;
    this.#desired.target.set(...p.target);
    this.#applyFocus();
  }

  /** Spins the view half a turn around the board. */
  rotate180(): void {
    this.#flipped = !this.#flipped;
    this.#desired.azimuth += Math.PI;
    this.#applyFocus();
  }

  /** Leans the view towards the field that is about to be hit (-1 enemy, +1 own). */
  focusSide(direction: number): void {
    this.#focusOffset = direction;
    this.#applyFocus();
  }

  orbitBy(deltaAzimuth: number, deltaPolar: number): void {
    this.#desired.azimuth += deltaAzimuth;
    this.#desired.polar = Math.min(POLAR_MAX, Math.max(POLAR_MIN, this.#desired.polar + deltaPolar));
  }

  zoomBy(factor: number): void {
    this.#desired.zoom = Math.min(1.8, Math.max(0.45, this.#desired.zoom * factor));
  }

  /** Absolute zoom multiplier (1 = the whole board fits). */
  setZoom(zoom: number): void {
    this.#desired.zoom = Math.min(1.8, Math.max(0.45, zoom));
  }

  /** Centres the view on a depth of the table in any preset (null = the preset's own target). */
  lookAtZ(z: number | null): void {
    this.#lookZ = z;
    if (z === null) this.#desired.target.set(...PRESETS[this.#preset].target);
    this.#applyFocus();
  }

  shake(strength: number): void {
    if (this.#reducedMotion) return;
    this.#trauma = Math.min(1, this.#trauma + strength);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const portrait = aspect < 0.8;
    if (portrait !== this.#portrait) {
      this.#portrait = portrait;
      this.setPreset(this.#preset);
    }
  }

  update(dt: number): void {
    this.#time += dt;
    const k = damp(this.#reducedMotion ? 30 : 4.2, dt);
    this.#current.azimuth += (this.#desired.azimuth - this.#current.azimuth) * k;
    this.#current.polar += (this.#desired.polar - this.#current.polar) * k;
    this.#current.zoom += (this.#desired.zoom - this.#current.zoom) * k;
    this.#current.target.lerp(this.#desired.target, k);
    this.#trauma = Math.max(0, this.#trauma - dt * 1.6);
    this.#apply();
  }

  #applyFocus(): void {
    if (this.#lookZ !== null) {
      this.#desired.target.set(0, 0, this.#lookZ);
      return;
    }
    if (this.#preset !== 'default') return;
    const base = PRESETS.default.target;
    const towardsViewer = this.#flipped ? -1 : 1;
    this.#desired.target.set(base[0], base[1], base[2] * towardsViewer + this.#focusOffset * 0.9);
  }

  #nearestAzimuth(angle: number): number {
    const twoPi = Math.PI * 2;
    const current = this.#desired.azimuth;
    return angle + Math.round((current - angle) / twoPi) * twoPi;
  }

  /** Distance that keeps the whole framed board visible for the current aspect. */
  #fitDistance(polar: number, azimuth: number): number {
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const boardX = OUTER_HALF_X * 2 + 0.6;
    const boardZ = OUTER_HALF_Z * 2 + 0.6;
    const c = Math.abs(Math.cos(azimuth));
    const s = Math.abs(Math.sin(azimuth));
    const width = c * boardX + s * boardZ;
    const depth = (s * boardX + c * boardZ) * Math.cos(polar) + 1.6 * Math.sin(polar);
    const byWidth = width / 2 / Math.tan(hFov / 2);
    const byDepth = depth / 2 / Math.tan(vFov / 2);
    return Math.max(byWidth, byDepth) * 1.12 + 0.6;
  }

  #apply(): void {
    const { azimuth, polar, zoom, target } = this.#current;
    const distance = this.#fitDistance(polar, azimuth) * zoom;
    const sinPolar = Math.sin(polar);
    this.camera.position.set(
      target.x + distance * sinPolar * Math.sin(azimuth),
      target.y + distance * Math.cos(polar),
      target.z + distance * sinPolar * Math.cos(azimuth),
    );
    this.camera.lookAt(target);

    if (this.#trauma > 0) {
      const amount = this.#trauma * this.#trauma * 0.35;
      const t = this.#time * 37;
      this.camera.position.x += Math.sin(t) * amount;
      this.camera.position.y += Math.sin(t * 1.3 + 1) * amount * 0.6;
      this.camera.rotation.z += Math.sin(t * 0.9 + 2) * amount * 0.04;
    }
  }
}
