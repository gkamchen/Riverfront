import { Float32BufferAttribute, Matrix4, type BufferGeometry, type Color, Euler, Quaternion, Vector3 } from 'three';

/** Bakes a flat vertex colour into the geometry so parts can be merged into one mesh. */
export function paint(source: BufferGeometry, color: Color): BufferGeometry {
  // Primitives disagree on being indexed; merging needs them all the same.
  const geometry = source.index ? source.toNonIndexed() : source;
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpScale = new Vector3();
const tmpPos = new Vector3();

export interface Placement {
  x?: number;
  y?: number;
  z?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

/** Applies a translate/rotate/scale to the geometry in place and returns it. */
export function place(geometry: BufferGeometry, p: Placement): BufferGeometry {
  tmpEuler.set(p.rx ?? 0, p.ry ?? 0, p.rz ?? 0);
  tmpQuat.setFromEuler(tmpEuler);
  tmpScale.set(p.sx ?? 1, p.sy ?? 1, p.sz ?? 1);
  tmpPos.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
  tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
  geometry.applyMatrix4(tmpMatrix);
  return geometry;
}
