import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../materials/library';
import { noise3 } from '../materials/noise';
import { paint } from '../util/geometry';
import {
  FIELD_INNER_Z,
  FRAME_TOP,
  OUTER_HALF_X,
  OUTER_HALF_Z,
  PLATE_HALF_X,
  PLATE_HALF_Z,
  TABLE_Y,
  riverBedY,
  type Side,
} from './layout';

const FRAME_BOTTOM = TABLE_Y;
const BEVEL = 0.07;

/** The static parts of the board: table, frame, plate and lake banks (coordinates live in coordinates.ts). */
export function createBoardShell(materials: MaterialLibrary): Group {
  const shell = new Group();
  shell.name = 'board-shell';
  shell.add(createTable(materials), createFrame(materials), createPlate(materials));
  shell.add(createBank(materials, 'own'), createBank(materials, 'enemy'));
  return shell;
}

function roundedRect(shape: Shape, halfX: number, halfY: number, radius: number): void {
  shape.moveTo(-halfX + radius, -halfY);
  shape.lineTo(halfX - radius, -halfY);
  shape.quadraticCurveTo(halfX, -halfY, halfX, -halfY + radius);
  shape.lineTo(halfX, halfY - radius);
  shape.quadraticCurveTo(halfX, halfY, halfX - radius, halfY);
  shape.lineTo(-halfX + radius, halfY);
  shape.quadraticCurveTo(-halfX, halfY, -halfX, halfY - radius);
  shape.lineTo(-halfX, -halfY + radius);
  shape.quadraticCurveTo(-halfX, -halfY, -halfX + radius, -halfY);
}

function createFrame(materials: MaterialLibrary): Mesh {
  const outer = new Shape();
  roundedRect(outer, OUTER_HALF_X, OUTER_HALF_Z, 0.45);
  const hole = new Shape();
  roundedRect(hole, PLATE_HALF_X, PLATE_HALF_Z, 0.05);
  outer.holes.push(hole);

  const geometry = new ExtrudeGeometry(outer, {
    depth: FRAME_TOP - FRAME_BOTTOM - BEVEL * 2,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 4,
    curveSegments: 10,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, FRAME_BOTTOM + BEVEL, 0);
  normaliseFrameUvs(geometry);

  const mesh = new Mesh(geometry, materials.frame);
  mesh.name = 'frame';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Extrude UVs are in shape units; remap so the single wood canvas spans the frame. */
function normaliseFrameUvs(geometry: BufferGeometry): void {
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + OUTER_HALF_X) / (OUTER_HALF_X * 2), (uv.getY(i) + OUTER_HALF_Z) / (OUTER_HALF_Z * 2));
  }
  uv.needsUpdate = true;
}

/** Two slabs under the fields with a trench between them for the river. */
function createPlate(materials: MaterialLibrary): Group {
  const group = new Group();
  group.name = 'plate';
  const depth = PLATE_HALF_Z + 0.05 - (FIELD_INNER_Z - 0.03);
  for (const sign of [-1, 1]) {
    const geometry = new BoxGeometry(PLATE_HALF_X * 2 + 0.1, 0.36, depth);
    geometry.translate(0, -0.18, sign * (FIELD_INNER_Z - 0.03 + depth / 2));
    const mesh = new Mesh(geometry, materials.plate);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.add(createRiverBed());
  return group;
}

/** Sandy, pebbly bed seen through the water (or under lava/ice in other themes). */
function createRiverBed(): Mesh {
  const width = PLATE_HALF_X * 2 + 0.1;
  const depth = FIELD_INNER_Z * 2 + 0.06;
  const geometry = new PlaneGeometry(width, depth, 140, 18);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const sand = new Color('#8a7350');
  const mud = new Color('#3b3022');
  const pebble = new Color('#5e5a52');
  const weed = new Color('#3d5a2a');
  const tint = new Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const n = noise3(x * 1.7, z * 1.7, 0.3, 9);
    const fine = noise3(x * 9, z * 9, 1.1, 4);
    position.setY(i, riverBedY(z) + (n - 0.5) * 0.03);
    const shallow = Math.abs(z) / FIELD_INNER_Z;
    tint.copy(mud).lerp(sand, Math.min(1, shallow * 0.9 + (n - 0.5) * 0.6));
    if (fine > 0.72) tint.lerp(pebble, 0.7);
    if (n > 0.66 && shallow > 0.35) tint.lerp(weed, 0.55);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, riverBedMaterial);
  mesh.receiveShadow = true;
  mesh.name = 'river-bed';
  return mesh;
}

/** Shared so themes can retint the bed (basalt, frozen silt...). */
export const riverBedMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, color: new Color('#ffffff') });

function createTable(materials: MaterialLibrary): Mesh {
  const geometry = new PlaneGeometry(160, 160);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, materials.table);
  mesh.position.y = FRAME_BOTTOM;
  mesh.receiveShadow = true;
  mesh.name = 'table';
  return mesh;
}

// ---------------------------------------------------------------- lake banks

/** A row of rounded stones lining the lake on one side. */
function createBank(materials: MaterialLibrary, side: Side): Mesh {
  const sign = side === 'own' ? 1 : -1;
  const stones: BufferGeometry[] = [];
  const matrix = new Matrix4();
  const tint = new Color();
  let seed = side === 'own' ? 3 : 7;

  for (let x = -PLATE_HALF_X + 0.15; x < PLATE_HALF_X - 0.1; x += 0.22 + ((seed * 37) % 10) * 0.012) {
    seed += 1;
    const radius = 0.09 + ((seed * 13) % 7) * 0.012;
    const stone = new IcosahedronGeometry(radius, 0);
    const z = sign * (FIELD_INNER_Z - 0.08 - ((seed * 7) % 5) * 0.02);
    matrix.makeScale(1.3, 0.75, 1).setPosition(x, 0.1, z);
    stone.applyMatrix4(matrix);
    // Mid-tone stones: the theme tint and the rock rim keep them apart from soil and river.
    const shade = 0.2 + noise3(x, z, seed) * 0.12;
    tint.setRGB(shade, shade * 0.97, shade * 0.92);
    stones.push(paint(stone, tint));
  }

  const geometry = mergeGeometries(stones);
  const mesh = new Mesh(geometry, materials.stone);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `bank-${side}`;
  return mesh;
}
