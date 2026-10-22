import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
} from 'three';
import { FIELD_OUTER_Z, PLATE_HALF_X } from '../layout';
import { newGroup, type LifeModule, type WildlifeContext, type WildlifeQuality } from './shared';

const swarmVertex = /* glsl */ `
  attribute float aPhase;
  uniform float uTime;
  uniform float uScale;
  uniform float uSize;
  varying float vBlink;
  #include <fog_pars_vertex>
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float blink = pow(max(0.0, sin(uTime * (1.3 + fract(aPhase * 7.1)) + aPhase * 6.283)), 6.0);
    vBlink = blink;
    gl_PointSize = uSize * uScale * (0.4 + blink * 0.8) / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
    vec4 mvPosition = mv;
    #include <fog_vertex>
  }
`;

const swarmFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uSteady;
  varying float vBlink;
  #include <fog_pars_fragment>
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = pow(smoothstep(0.5, 0.0, d), 2.2);
    float a = core * uIntensity * mix(vBlink, 1.0, uSteady);
    gl_FragColor = vec4(uColor * a, a);
    // Additive and alpha sprites both simply fade out into the fog.
    #ifdef USE_FOG
      gl_FragColor *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
    #endif
  }
`;

/**
 * Points that wander on their own (fireflies, snow): positions are moved on
 * the CPU, the twinkle happens in the shader.
 */
export class Swarm {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  readonly #positions: Float32Array;
  readonly count: number;

  constructor(count: number, color: Color, size: number, additive: boolean, steady = 0) {
    this.count = count;
    this.#positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = Math.random();
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.#positions, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aPhase', new BufferAttribute(phases, 1));
    const material = new ShaderMaterial({
      vertexShader: swarmVertex,
      fragmentShader: swarmFragment,
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        uTime: { value: 0 },
        uScale: { value: 500 },
        uSize: { value: size },
        uColor: { value: color },
        uIntensity: { value: 1 },
        uSteady: { value: steady },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      fog: true,
    });
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  get positions(): Float32Array {
    return this.#positions;
  }

  commit(time: number): void {
    (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.points.material.uniforms.uTime!.value = time;
  }

  setScale(scale: number): void {
    this.points.material.uniforms.uScale!.value = scale;
  }

  set intensity(value: number) {
    this.points.material.uniforms.uIntensity!.value = value;
    this.points.visible = value > 0.01;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

/** Fireflies over the banks; they only come out as the light goes. */
export class FirefliesModule implements LifeModule {
  readonly group = newGroup('fireflies');
  readonly #ctx: WildlifeContext;
  #swarm: Swarm;
  #seeds: Vector3[] = [];
  #dusk = 0;
  #scale = 500;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#swarm = this.#build(ctx.quality);
  }

  setQuality(quality: WildlifeQuality): void {
    this.#swarm.dispose();
    this.#swarm = this.#build(quality);
  }

  setDusk(amount: number): void {
    this.#dusk = amount;
  }

  setScale(scale: number): void {
    this.#scale = scale;
    this.#swarm.setScale(scale);
  }

  update(): void {
    const time = this.#ctx.time;
    this.#swarm.intensity = this.#dusk * 2.2;
    if (this.#dusk <= 0.01) return;
    const p = this.#swarm.positions;
    this.#seeds.forEach((seed, i) => {
      p[i * 3] = seed.x + Math.sin(time * 0.31 + i * 1.7) * 0.6 + Math.sin(time * 0.77 + i) * 0.2;
      p[i * 3 + 1] = seed.y + Math.sin(time * 0.53 + i * 2.3) * 0.18;
      p[i * 3 + 2] = seed.z + Math.cos(time * 0.27 + i * 1.1) * 0.5;
    });
    this.#swarm.commit(time);
  }

  dispose(): void {
    this.#swarm.dispose();
    this.group.removeFromParent();
  }

  #build(quality: WildlifeQuality): Swarm {
    const rng = this.#ctx.rng;
    const count = quality === 'high' ? 48 : 18;
    const swarm = new Swarm(count, new Color(1.6, 1.9, 0.5), 0.14, true);
    swarm.setScale(this.#scale);
    this.#seeds = Array.from({ length: count }, () => {
      const side = rng.chance(0.5) ? 1 : -1;
      return new Vector3(rng.range(-PLATE_HALF_X, PLATE_HALF_X), rng.range(0.35, 1.1), side * rng.range(0.6, FIELD_OUTER_Z * 0.6));
    });
    this.group.add(swarm.points);
    return swarm;
  }
}

/** Unseen birds: an occasional FM chirp from somewhere along the banks. */
export class BirdsongModule implements LifeModule {
  readonly group = newGroup('birdsong');
  readonly #ctx: WildlifeContext;
  #next: number;
  #quiet = 0;

  constructor(ctx: WildlifeContext) {
    this.#ctx = ctx;
    this.#next = ctx.rng.range(4, 10);
  }

  onExplosion(): void {
    this.#quiet = 8;
  }

  update(dt: number): void {
    this.#quiet = Math.max(0, this.#quiet - dt);
    this.#next -= dt;
    if (this.#next > 0) return;
    this.#next = this.#ctx.rng.range(9, 24);
    if (this.#quiet > 0) return;
    this.#ctx.sound('bird', new Vector3(this.#ctx.rng.range(-12, 12), 1, this.#ctx.rng.range(-8, 8)));
  }

  dispose(): void {
    this.group.removeFromParent();
  }
}
