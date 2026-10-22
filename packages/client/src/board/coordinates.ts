import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { COLS, FRAME_BORDER, FRAME_TOP, PLATE_HALF_X, PLATE_HALF_Z, ROWS, cellX, cellZ, columnLabel, rowLabel, type Side } from './layout';

/**
 * - `engraved`: plaques lying on the frame, turned so they read upright from
 *   wherever the camera is (landscape, portrait, flipped);
 * - `billboard`: plaques standing up and always facing the camera;
 * - `off`: hidden.
 */
export type CoordinateMode = 'engraved' | 'billboard' | 'off';

const GLYPH_PX = 128;
const GLYPHS = [...Array.from({ length: COLS }, (_, c) => columnLabel(c)), ...Array.from({ length: ROWS }, (_, r) => rowLabel(r))];
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = Math.ceil(GLYPHS.length / ATLAS_COLUMNS);

/** Light glyph on a near-black plaque with a gilded rim: contrast well above 7:1 on any frame tint. */
function createAtlas(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * GLYPH_PX;
  canvas.height = ATLAS_ROWS * GLYPH_PX;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  GLYPHS.forEach((glyph, i) => {
    const x0 = (i % ATLAS_COLUMNS) * GLYPH_PX;
    const y0 = Math.floor(i / ATLAS_COLUMNS) * GLYPH_PX;
    const pad = GLYPH_PX * 0.08;
    ctx.fillStyle = 'rgba(14, 10, 6, 0.94)';
    ctx.beginPath();
    ctx.roundRect(x0 + pad, y0 + pad, GLYPH_PX - pad * 2, GLYPH_PX - pad * 2, GLYPH_PX * 0.2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(214, 170, 82, 0.95)';
    ctx.lineWidth = GLYPH_PX * 0.045;
    ctx.stroke();
    ctx.font = `800 ${GLYPH_PX * 0.62}px Georgia, "Times New Roman", serif`;
    const cx = x0 + GLYPH_PX / 2;
    const cy = y0 + GLYPH_PX / 2 + GLYPH_PX * 0.04;
    ctx.strokeStyle = 'rgba(0, 0, 0, 1)';
    ctx.lineWidth = GLYPH_PX * 0.08;
    ctx.strokeText(glyph, cx, cy);
    ctx.fillStyle = '#fff3d2';
    ctx.fillText(glyph, cx, cy);
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const vertexShader = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec2 aCell;
  attribute float aKind;
  attribute float aIndex;
  attribute float aSide;
  uniform float uBillboard;
  uniform float uSize;
  uniform float uMaxSize;
  uniform float uPixelWorld;
  uniform float uMinPx;
  uniform vec2 uUp;
  uniform vec3 uHover;
  uniform vec2 uAtlas;
  varying vec2 vUv;
  varying float vHot;
  void main() {
    // Columns light up by index, rows by index and side.
    float colHot = (1.0 - aKind) * step(abs(aIndex - uHover.x), 0.1);
    float rowHot = aKind * step(abs(aIndex - uHover.y), 0.1) * step(abs(aSide - uHover.z), 0.1);
    vHot = max(colHot, rowHot);
    vec4 centre = modelViewMatrix * vec4(aOffset, 1.0);
    float depth = max(0.1, -centre.z);
    // Never smaller than uMinPx CSS pixels on screen, never bigger than the frame allows.
    float size = clamp(max(uSize, uMinPx * uPixelWorld * depth), uSize, uMaxSize) * (1.0 + vHot * 0.3);
    vUv = vec2((aCell.x + uv.x) / uAtlas.x, 1.0 - (aCell.y + 1.0 - uv.y) / uAtlas.y);
    if (uBillboard > 0.5) {
      vec4 mv = modelViewMatrix * vec4(aOffset + vec3(0.0, size * 0.55, 0.0), 1.0);
      mv.xy += position.xy * size;
      gl_Position = projectionMatrix * mv;
    } else {
      vec3 up = vec3(uUp.x, 0.0, uUp.y);
      vec3 right = vec3(-up.z, 0.0, up.x);
      vec3 world = aOffset + right * position.x * size + up * position.y * size;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
    }
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying float vHot;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.02) discard;
    // The echoed row/column glows warm gold.
    c.rgb = mix(c.rgb, c.rgb * vec3(1.25, 1.05, 0.6) + vec3(0.25, 0.16, 0.0), vHot);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`;

const tmpUp = new Vector3();
const tmpForward = new Vector3();
const tmpSize = new Vector2();

/**
 * Column letters and row numbers around the board, drawn as one instanced
 * mesh. The cell under the cursor is echoed: its letter and number grow and
 * glow on every edge.
 */
export class CoordinateLabels {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  #mode: CoordinateMode = 'engraved';

  constructor() {
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));

    const offsets: number[] = [];
    const cells: number[] = [];
    const kinds: number[] = [];
    const indices: number[] = [];
    const sides: number[] = [];
    const mid = FRAME_BORDER / 2;
    const y = FRAME_TOP + 0.006;
    const add = (glyph: string, x: number, z: number, kind: 0 | 1, index: number, side: number) => {
      const i = GLYPHS.indexOf(glyph);
      offsets.push(x, y, z);
      cells.push(i % ATLAS_COLUMNS, Math.floor(i / ATLAS_COLUMNS));
      kinds.push(kind);
      indices.push(index);
      sides.push(side);
    };
    for (let col = 0; col < COLS; col++) {
      add(columnLabel(col), cellX(col), PLATE_HALF_Z + mid, 0, col, 0);
      add(columnLabel(col), cellX(col), -PLATE_HALF_Z - mid, 0, col, 0);
    }
    for (const side of ['own', 'enemy'] as const) {
      for (let row = 0; row < ROWS; row++) {
        const s = side === 'own' ? 1 : -1;
        add(rowLabel(row), -PLATE_HALF_X - mid, cellZ(side, row), 1, row, s);
        add(rowLabel(row), PLATE_HALF_X + mid, cellZ(side, row), 1, row, s);
      }
    }
    geometry.setAttribute('aOffset', new InstancedBufferAttribute(new Float32Array(offsets), 3));
    geometry.setAttribute('aCell', new InstancedBufferAttribute(new Float32Array(cells), 2));
    geometry.setAttribute('aKind', new InstancedBufferAttribute(new Float32Array(kinds), 1));
    geometry.setAttribute('aIndex', new InstancedBufferAttribute(new Float32Array(indices), 1));
    geometry.setAttribute('aSide', new InstancedBufferAttribute(new Float32Array(sides), 1));
    geometry.instanceCount = kinds.length;

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uMap: { value: createAtlas() },
        uBillboard: { value: 0 },
        uSize: { value: 0.82 },
        uMaxSize: { value: 1.3 },
        uPixelWorld: { value: 0.002 },
        uMinPx: { value: 18 },
        uUp: { value: new Vector2(0, -1) },
        uHover: { value: new Vector3(-10, -10, 0) },
        uAtlas: { value: new Vector2(ATLAS_COLUMNS, ATLAS_ROWS) },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'coordinates';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.onBeforeRender = (renderer: WebGLRenderer, _scene, camera: Camera) => this.#follow(renderer, camera);
  }

  get mode(): CoordinateMode {
    return this.#mode;
  }

  setMode(mode: CoordinateMode): void {
    this.#mode = mode;
    this.mesh.visible = mode !== 'off';
    const u = this.mesh.material.uniforms;
    u.uBillboard!.value = mode === 'billboard' ? 1 : 0;
    u.uSize!.value = mode === 'billboard' ? 0.62 : 0.82;
    u.uMaxSize!.value = mode === 'billboard' ? 1.6 : 1.3;
    u.uMinPx!.value = mode === 'billboard' ? 20 : 18;
  }

  /** Echoes a cell on the edges (null clears). */
  setHover(cell: { side: Side; col: number; row: number } | null): void {
    const hover = this.mesh.material.uniforms.uHover!.value as Vector3;
    if (!cell) hover.set(-10, -10, 0);
    else hover.set(cell.col, cell.row, cell.side === 'own' ? 1 : -1);
  }

  dispose(): void {
    (this.mesh.material.uniforms.uMap!.value as CanvasTexture).dispose();
    this.mesh.material.dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }

  /** Keeps the plaques upright for the current view and at a readable pixel size. */
  #follow(renderer: WebGLRenderer, camera: Camera): void {
    const u = this.mesh.material.uniforms;
    const perspective = camera as PerspectiveCamera;
    const height = renderer.domElement.clientHeight || renderer.getSize(tmpSize).y || 600;
    if (perspective.isPerspectiveCamera) u.uPixelWorld!.value = (2 * Math.tan((perspective.fov * Math.PI) / 360)) / height;
    // Screen "up" projected onto the table; when it degenerates use the view direction.
    tmpUp.setFromMatrixColumn(camera.matrixWorld, 1).setY(0);
    if (tmpUp.lengthSq() < 1e-4) {
      camera.getWorldDirection(tmpForward);
      tmpUp.copy(tmpForward).setY(0);
    }
    if (tmpUp.lengthSq() < 1e-6) tmpUp.set(0, 0, -1);
    tmpUp.normalize();
    (u.uUp!.value as Vector2).set(tmpUp.x, tmpUp.z);
  }
}
