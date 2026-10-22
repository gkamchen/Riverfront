import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  type Color,
  type Vector3,
} from 'three';
import { rand } from '../util/random';

const vertexShader = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uScale;
  varying vec4 vColor;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vSeed = aSeed;
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uBillow;
  varying vec4 vColor;
  varying float vSeed;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float soft = smoothstep(0.5, 0.0, d);
    if (uBillow > 0.0) {
      float n = noise(c * 5.0 + vSeed * 13.0) * 0.6 + noise(c * 11.0 - vSeed * 7.0) * 0.4;
      soft *= smoothstep(0.2, 0.9, n * 0.75 + soft * 0.65);
    } else {
      soft = pow(soft, 1.6);
    }
    gl_FragColor = vec4(vColor.rgb, vColor.a * soft);
  }
`;

export interface EmitOptions {
  origin: Vector3;
  count: number;
  /** Random offset radius around the origin. */
  radius?: number;
  speed: readonly [number, number];
  /** 0 = straight up, 0.5 = upper hemisphere, 1 = full sphere. */
  spread?: number;
  /** Extra upward velocity added to every particle. */
  lift?: number;
  life: readonly [number, number];
  size: readonly [number, number];
  /** Multiplier for the end size relative to the start size. */
  grow?: number;
  color: Color;
  colorEnd?: Color;
  opacity?: number;
  gravity?: number;
  drag?: number;
}

/**
 * CPU-simulated point sprites. Live particles are kept packed at the front of
 * the buffers so the draw range only covers what is alive.
 */
export class ParticleSystem {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly #capacity: number;
  #count = 0;

  readonly #position: Float32Array;
  readonly #color: Float32Array;
  readonly #size: Float32Array;
  readonly #seed: Float32Array;
  readonly #velocity: Float32Array;
  readonly #age: Float32Array;
  readonly #life: Float32Array;
  readonly #sizeRange: Float32Array;
  readonly #colorRange: Float32Array;
  readonly #physics: Float32Array;

  constructor(capacity: number, additive: boolean) {
    this.#capacity = capacity;
    this.#position = new Float32Array(capacity * 3);
    this.#color = new Float32Array(capacity * 4);
    this.#size = new Float32Array(capacity);
    this.#seed = new Float32Array(capacity);
    this.#velocity = new Float32Array(capacity * 3);
    this.#age = new Float32Array(capacity);
    this.#life = new Float32Array(capacity);
    this.#sizeRange = new Float32Array(capacity * 2);
    this.#colorRange = new Float32Array(capacity * 7);
    this.#physics = new Float32Array(capacity * 2);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.#position, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aColor', new BufferAttribute(this.#color, 4).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aSize', new BufferAttribute(this.#size, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aSeed', new BufferAttribute(this.#seed, 1).setUsage(DynamicDrawUsage));
    geometry.setDrawRange(0, 0);

    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { uScale: { value: 400 }, uBillow: { value: additive ? 0 : 1 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });

    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 4 : 3;
  }

  /** Pixels per world unit at distance 1, derived from the camera and canvas. */
  setScale(viewportHeightPx: number, fovDegrees: number): void {
    const scale = viewportHeightPx / (2 * Math.tan((fovDegrees * Math.PI) / 360));
    this.points.material.uniforms.uScale!.value = scale;
  }

  emit(options: EmitOptions): void {
    const spread = options.spread ?? 1;
    const radius = options.radius ?? 0;
    const end = options.colorEnd ?? options.color;
    const opacity = options.opacity ?? 1;

    for (let n = 0; n < options.count; n++) {
      if (this.#count >= this.#capacity) return;
      const i = this.#count++;

      // Random direction inside a cone around +y whose width is set by spread.
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = 1 - Math.random() * spread * 2;
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const speed = rand(options.speed[0], options.speed[1]);

      this.#position[i * 3] = options.origin.x + rand(-radius, radius);
      this.#position[i * 3 + 1] = options.origin.y + rand(0, radius * 0.6);
      this.#position[i * 3 + 2] = options.origin.z + rand(-radius, radius);
      this.#velocity[i * 3] = Math.cos(theta) * sinPhi * speed;
      this.#velocity[i * 3 + 1] = cosPhi * speed + (options.lift ?? 0);
      this.#velocity[i * 3 + 2] = Math.sin(theta) * sinPhi * speed;

      this.#age[i] = 0;
      this.#life[i] = rand(options.life[0], options.life[1]);
      const size = rand(options.size[0], options.size[1]);
      this.#sizeRange[i * 2] = size;
      this.#sizeRange[i * 2 + 1] = size * (options.grow ?? 1);
      this.#seed[i] = Math.random();

      const c = i * 7;
      this.#colorRange[c] = options.color.r;
      this.#colorRange[c + 1] = options.color.g;
      this.#colorRange[c + 2] = options.color.b;
      this.#colorRange[c + 3] = end.r;
      this.#colorRange[c + 4] = end.g;
      this.#colorRange[c + 5] = end.b;
      this.#colorRange[c + 6] = opacity;
      this.#physics[i * 2] = options.gravity ?? 0;
      this.#physics[i * 2 + 1] = options.drag ?? 0;
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.#count) {
      this.#age[i]! += dt;
      if (this.#age[i]! >= this.#life[i]!) {
        this.#moveParticle(this.#count - 1, i);
        this.#count--;
        continue;
      }
      this.#step(i, dt);
      i++;
    }

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.#count);
    for (const name of ['position', 'aColor', 'aSize', 'aSeed']) {
      const attribute = geometry.getAttribute(name) as BufferAttribute;
      attribute.needsUpdate = true;
    }
  }

  clear(): void {
    this.#count = 0;
    this.points.geometry.setDrawRange(0, 0);
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  #step(i: number, dt: number): void {
    const t = this.#age[i]! / this.#life[i]!;
    const gravity = this.#physics[i * 2]!;
    const drag = Math.exp(-this.#physics[i * 2 + 1]! * dt);

    this.#velocity[i * 3 + 1]! -= gravity * dt;
    for (let k = 0; k < 3; k++) {
      this.#velocity[i * 3 + k]! *= drag;
      this.#position[i * 3 + k]! += this.#velocity[i * 3 + k]! * dt;
    }

    this.#size[i] = this.#sizeRange[i * 2]! + (this.#sizeRange[i * 2 + 1]! - this.#sizeRange[i * 2]!) * t;
    const c = i * 7;
    const fadeIn = Math.min(1, t * 12);
    const fadeOut = 1 - t * t;
    this.#color[i * 4] = this.#colorRange[c]! + (this.#colorRange[c + 3]! - this.#colorRange[c]!) * t;
    this.#color[i * 4 + 1] = this.#colorRange[c + 1]! + (this.#colorRange[c + 4]! - this.#colorRange[c + 1]!) * t;
    this.#color[i * 4 + 2] = this.#colorRange[c + 2]! + (this.#colorRange[c + 5]! - this.#colorRange[c + 2]!) * t;
    this.#color[i * 4 + 3] = this.#colorRange[c + 6]! * fadeIn * fadeOut;
  }

  #moveParticle(from: number, to: number): void {
    if (from === to) return;
    copy(this.#position, from, to, 3);
    copy(this.#velocity, from, to, 3);
    copy(this.#color, from, to, 4);
    copy(this.#size, from, to, 1);
    copy(this.#seed, from, to, 1);
    copy(this.#age, from, to, 1);
    copy(this.#life, from, to, 1);
    copy(this.#sizeRange, from, to, 2);
    copy(this.#colorRange, from, to, 7);
    copy(this.#physics, from, to, 2);
  }
}

function copy(array: Float32Array, from: number, to: number, stride: number): void {
  array.copyWithin(to * stride, from * stride, from * stride + stride);
}
