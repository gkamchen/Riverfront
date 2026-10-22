import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, RingGeometry, type Group, type Vector3 } from 'three';
import { easeOutCubic } from '../anim/easing';

interface Wave {
  mesh: Mesh<RingGeometry, MeshBasicMaterial>;
  age: number;
  duration: number;
  maxScale: number;
  active: boolean;
}

/** Flat expanding rings for impacts. */
export class Shockwaves {
  readonly #waves: Wave[] = [];

  constructor(parent: Group, poolSize = 6) {
    const geometry = new RingGeometry(0.9, 1, 64);
    geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < poolSize; i++) {
      const material = new MeshBasicMaterial({
        color: new Color(1, 1, 1),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this.#waves.push({ mesh, age: 0, duration: 0.5, maxScale: 2, active: false });
    }
  }

  spawn(position: Vector3, color: Color, maxScale = 2, duration = 0.5): void {
    const wave = this.#waves.find((w) => !w.active) ?? this.#waves[0];
    if (!wave) return;
    wave.active = true;
    wave.age = 0;
    wave.duration = duration;
    wave.maxScale = maxScale;
    wave.mesh.material.color.copy(color);
    wave.mesh.position.copy(position);
    wave.mesh.position.y += 0.03;
    wave.mesh.visible = true;
  }

  dispose(): void {
    this.#waves[0]?.mesh.geometry.dispose();
    for (const wave of this.#waves) {
      wave.mesh.material.dispose();
      wave.mesh.removeFromParent();
    }
    this.#waves.length = 0;
  }

  update(dt: number): void {
    for (const wave of this.#waves) {
      if (!wave.active) continue;
      wave.age += dt;
      const t = Math.min(1, wave.age / wave.duration);
      wave.mesh.scale.setScalar(0.15 + easeOutCubic(t) * wave.maxScale);
      wave.mesh.material.opacity = (1 - t) * (1 - t) * 0.8;
      if (t >= 1) {
        wave.active = false;
        wave.mesh.visible = false;
      }
    }
  }
}
