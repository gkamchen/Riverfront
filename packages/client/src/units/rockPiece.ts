import { Color, Float32BufferAttribute, Group, IcosahedronGeometry, Mesh, Vector3, type BufferGeometry, type Material } from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { easeOutBack, easeOutCubic } from '../anim/easing';
import type { Tweens } from '../anim/tweens';
import { noise3 } from '../materials/noise';
import { place } from '../util/geometry';

const VARIANTS = 6;
const variants: BufferGeometry[] = [];

/** A lumpy low-poly stone with faceted, slightly varied face colours. */
function stone(seed: number, radius: number): BufferGeometry {
  let geometry: BufferGeometry = new IcosahedronGeometry(1, 1);
  geometry.deleteAttribute('normal');
  geometry.deleteAttribute('uv');
  geometry = mergeVertices(geometry);

  const position = geometry.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    const bump = 1 + (noise3(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6, seed) - 0.5) * 0.7;
    v.multiplyScalar(bump);
    position.setXYZ(i, v.x * radius * 1.15, Math.max(v.y, -0.35) * radius * 0.72, v.z * radius);
  }

  geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();

  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  // Mid-grey stone (the theme tints it): dark rocks disappeared on basalt and dark soil.
  const base = new Color().setHSL(0.08 + (seed % 3) * 0.02, 0.08, 0.26 + (seed % 4) * 0.025);
  const moss = new Color('#5d7a3a');
  const face = new Color();
  for (let tri = 0; tri < normals.count; tri += 3) {
    const shade = 0.82 + noise3(tri * 0.37, seed, 1.3) * 0.36;
    // Lighter tops and darker undersides keep the form readable under any light.
    const ny = normals.getY(tri);
    const lift = ny > 0.55 ? 1.22 : ny < -0.1 ? 0.62 : 1;
    face.copy(base).multiplyScalar(shade * lift);
    if (normals.getY(tri) > 0.8 && noise3(tri * 0.11, seed * 3.3, 0) > 0.62) face.lerp(moss, 0.55);
    for (let k = 0; k < 3; k++) {
      colors[(tri + k) * 3] = face.r;
      colors[(tri + k) * 3 + 1] = face.g;
      colors[(tri + k) * 3 + 2] = face.b;
    }
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function rockVariant(index: number): BufferGeometry {
  const i = index % VARIANTS;
  let geometry = variants[i];
  if (!geometry) {
    const seed = i * 7 + 3;
    const parts = [place(stone(seed, 0.27), { y: 0.1, ry: i })];
    parts.push(place(stone(seed + 1, 0.13), { x: 0.24, y: 0.05, z: 0.12 }));
    if (i % 2 === 0) parts.push(place(stone(seed + 2, 0.1), { x: -0.2, y: 0.04, z: -0.16 }));
    geometry = mergeGeometries(parts);
    geometry.computeBoundingSphere();
    variants[i] = geometry;
  }
  return geometry;
}

/** A rock cell: a cluster of stones that can crack apart when struck. */
export class RockPiece {
  readonly group = new Group();
  readonly #whole: Mesh;
  readonly #material: Material;
  readonly #variant: number;
  #cracked = false;

  constructor(material: Material, position: Vector3, variant: number) {
    this.#material = material;
    this.#variant = variant;
    this.#whole = new Mesh(rockVariant(variant), material);
    this.#whole.castShadow = true;
    this.#whole.receiveShadow = true;
    this.group.add(this.#whole);
    this.group.position.copy(position);
    this.group.rotation.y = variant * 1.1;
  }

  async rise(tweens: Tweens): Promise<void> {
    this.group.scale.setScalar(0.001);
    await tweens.run(0.32, (t) => this.group.scale.setScalar(Math.max(0.001, easeOutBack(t))));
  }

  /** Shakes, then splits into three chunks that slide apart. */
  async crack(tweens: Tweens): Promise<void> {
    if (this.#cracked) return;
    this.#cracked = true;

    await tweens.run(0.18, (t) => {
      const shake = Math.sin(t * Math.PI * 9) * (1 - t) * 0.05;
      this.#whole.position.set(shake, 0, -shake * 0.6);
    });

    this.#whole.visible = false;
    const chunks = [0, 1, 2].map((k) => {
      const chunk = new Mesh(rockVariant(this.#variant + k + 1), this.#material);
      chunk.castShadow = true;
      chunk.receiveShadow = true;
      chunk.scale.setScalar(0.62);
      this.group.add(chunk);
      const angle = (k / 3) * Math.PI * 2 + this.#variant;
      return { chunk, dir: new Vector3(Math.cos(angle), 0, Math.sin(angle)), spin: (k - 1) * 0.6 };
    });

    await tweens.run(0.45, (t) => {
      const e = easeOutCubic(t);
      for (const { chunk, dir, spin } of chunks) {
        chunk.position.copy(dir).multiplyScalar(e * 0.17);
        chunk.position.y = Math.sin(Math.PI * t) * 0.08;
        chunk.rotation.set(dir.z * e * 0.5, spin * e, -dir.x * e * 0.5);
      }
    });
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
