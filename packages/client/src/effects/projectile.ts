import { Color, Mesh, MeshBasicMaterial, SphereGeometry, Vector3, type Group } from 'three';
import type { Tweens } from '../anim/tweens';
import type { EffectsDirector } from './fx';

const tmp = new Vector3();

/** A glowing shell that arcs from the attacker's side to the target. */
export class Projectile {
  readonly #mesh: Mesh<SphereGeometry, MeshBasicMaterial>;
  readonly #fx: EffectsDirector;

  constructor(parent: Group, fx: EffectsDirector) {
    this.#fx = fx;
    this.#mesh = new Mesh(
      new SphereGeometry(0.11, 16, 12),
      new MeshBasicMaterial({ color: new Color(7, 4.2, 1.6), toneMapped: false }),
    );
    this.#mesh.visible = false;
    this.#mesh.name = 'projectile';
    parent.add(this.#mesh);
  }

  /** Resolves when the shell lands. `onApex` fires as it crosses the middle. */
  async fire(from: Vector3, to: Vector3, tweens: Tweens, onApex?: (at: Vector3) => void): Promise<void> {
    const distance = from.distanceTo(to);
    const height = 2.2 + distance * 0.22;
    const duration = 0.55 + distance * 0.018;
    let apexReported = false;

    this.#fx.muzzle(from);
    this.#mesh.visible = true;
    await tweens.run(duration, (t) => {
      tmp.lerpVectors(from, to, t);
      tmp.y += Math.sin(Math.PI * t) * height;
      this.#mesh.position.copy(tmp);
      this.#mesh.scale.setScalar(1 + Math.sin(t * 40) * 0.12);
      this.#fx.trail(tmp);
      if (!apexReported && t >= 0.5) {
        apexReported = true;
        onApex?.(tmp.clone());
      }
    });
    this.#mesh.visible = false;
  }
}
