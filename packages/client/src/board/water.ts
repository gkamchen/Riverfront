import { Color, Group, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3, Vector4 } from 'three';
import { rand } from '../util/random';
import { FIELD_INNER_Z, LAKE_WIDTH, PLATE_HALF_X, RIVER_DEPTH, WATER_LEVEL } from './layout';

const MAX_RIPPLES = 24;
const MAX_REFLECTIONS = 8;
const MAX_CRACKS = 16;
const MAX_HOLES = 4;

export type WaterMode = 'water' | 'lava' | 'ice';

/** Look of the river surface; every theme provides one. */
export interface WaterParams {
  mode: WaterMode;
  deep: string;
  shallow: string;
  skyLow: string;
  skyHigh: string;
  foam: string;
  /** Downstream drift speed of the surface detail. */
  flow: number;
  /** How far one can see into the water (higher = clearer). */
  clarity: number;
  /** Extra surface chop for open-sea rivers (0 = calm river, 1 = choppy sea). */
  chop?: number;
}

const DEFAULT_WATER: WaterParams = {
  mode: 'water',
  deep: '#06303d',
  shallow: '#2a7a6c',
  skyLow: '#3b3a36',
  skyHigh: '#9fb6c4',
  foam: '#eaf2f0',
  flow: 0.25,
  clarity: 1,
};

const MODE_ID: Record<WaterMode, number> = { water: 0, lava: 1, ice: 2 };

const vertexShader = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    #if WATER_MODE == 0
      world.y += 0.012 * sin(world.x * 0.9 + uTime * 1.2) + 0.008 * sin(world.z * 3.1 - uTime * 1.7);
    #elif WATER_MODE == 1
      world.y += 0.01 * sin(world.x * 0.5 + uTime * 0.5) * sin(world.z * 1.7 - uTime * 0.3);
    #endif
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #define MAX_RIPPLES ${MAX_RIPPLES}
  #define MAX_REFLECTIONS ${MAX_REFLECTIONS}
  #define MAX_CRACKS ${MAX_CRACKS}
  #define MAX_HOLES ${MAX_HOLES}
  uniform float uTime;
  uniform float uHalfDepth;
  uniform float uHalfWidth;
  uniform float uWaterLevel;
  uniform float uBedDepth;
  uniform float uFlow;
  uniform float uClarity;
  uniform float uChop;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSkyLow;
  uniform vec3 uSkyHigh;
  uniform vec3 uFoam;
  uniform vec3 uSunDir;
  uniform vec4 uRipples[MAX_RIPPLES];
  uniform vec4 uLights[MAX_REFLECTIONS];
  uniform vec3 uLightColors[MAX_REFLECTIONS];
  uniform vec4 uCracks[MAX_CRACKS];
  uniform vec3 uHoles[MAX_HOLES];
  varying vec3 vWorld;
  #include <fog_pars_fragment>

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; }
    return s;
  }

  float ripples(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < MAX_RIPPLES; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (r.w <= 0.0 || age < 0.0 || age > 3.5) continue;
      float d = distance(p, r.xy);
      float front = d - age * 1.1;
      if (abs(front) > 0.7) continue;
      h +=sin(front * 18.0) * exp(-front * front * 14.0) * exp(-age * 1.2) * r.w;
    }
    return h;
  }

  float bedY(float z) {
    float t = min(1.0, abs(z) / (uHalfDepth + 0.02));
    return -uBedDepth * (1.0 - t * t) * (1.0 - 0.15 * t);
  }

  vec3 reflections(vec3 p, vec3 n, vec3 viewDir) {
    vec3 r = reflect(-viewDir, n);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < MAX_REFLECTIONS; i++) {
      vec4 l = uLights[i];
      if (l.w <= 0.0) continue;
      vec3 toLight = normalize(l.xyz - p);
      float a = max(dot(r, toLight), 0.0);
      sum += uLightColors[i] * l.w * (pow(a, 90.0) * 2.5 + pow(a, 10.0) * 0.18);
    }
    return sum;
  }

  // Distance to the nearest Voronoi edge, used for ice cracks.
  float voronoiEdge(vec2 p) {
    vec2 g = floor(p); vec2 f = fract(p);
    float d1 = 8.0; float d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = o + hash2(g + o) - f;
      float d = dot(c, c);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
    }
    return sqrt(d2) - sqrt(d1);
  }

  void main() {
    vec2 p = vWorld.xz;
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float shoreDist = min(uHalfDepth - abs(p.y), uHalfWidth - abs(p.x));
    vec2 flowP = p - vec2(uTime * uFlow, 0.0);
    vec3 color;
    float alpha = 1.0;

  #if WATER_MODE == 0
    float e = 0.03;
    float rip = ripples(p);
    float h0 = 0.5 * sin(p.x * 1.4 + uTime * 1.1 + sin(p.y * 2.0)) + 0.6 * noise(flowP * 3.2) + 0.4 * noise(flowP * 7.0);
    float hx = 0.5 * sin((p.x + e) * 1.4 + uTime * 1.1 + sin(p.y * 2.0)) + 0.6 * noise((flowP + vec2(e, 0.0)) * 3.2) + 0.4 * noise((flowP + vec2(e, 0.0)) * 7.0);
    float hz = 0.5 * sin(p.x * 1.4 + uTime * 1.1 + sin((p.y + e) * 2.0)) + 0.6 * noise((flowP + vec2(0.0, e)) * 3.2) + 0.4 * noise((flowP + vec2(0.0, e)) * 7.0);
    float rx = ripples(p + vec2(e, 0.0));
    float rz = ripples(p + vec2(0.0, e));
    float waveK = 0.02 * (1.0 + uChop * 1.6);
    vec3 n = normalize(vec3(-((hx - h0) * waveK + (rx - rip) * 0.04) / e, 1.0, -((hz - h0) * waveK + (rz - rip) * 0.04) / e));

    float thickness = max(0.0, uWaterLevel - bedY(p.y));
    float murk = 1.0 - exp(-thickness * 6.5 / uClarity);
    vec3 base = mix(uShallow, uDeep, murk);
    float caustic = pow(noise(p * 5.0 + n.xz * 6.0 + uTime * 0.6), 4.0) * (1.0 - murk) * 0.6;
    base += vec3(0.25, 0.4, 0.38) * caustic;

    vec3 reflected = reflect(-viewDir, n);
    vec3 sky = mix(uSkyLow, uSkyHigh, clamp(reflected.y, 0.0, 1.0));
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    color = mix(base, sky, fresnel * 0.8);
    float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 180.0);
    color += vec3(1.0, 0.92, 0.75) * spec * 2.5;
    color += reflections(vWorld, n, viewDir);

    float foamNoise = noise(flowP * 6.0 + vec2(0.0, -uTime * 0.3));
    float shoreFoam = smoothstep(0.3, 0.0, shoreDist) * smoothstep(0.35, 0.75, foamNoise + 0.25 * sin(uTime * 2.0 + p.x * 3.0));
    float rippleFoam = smoothstep(0.3, 0.9, rip);
    float foam = clamp(shoreFoam * 0.8 + rippleFoam * 0.7, 0.0, 1.0);
    color = mix(color, uFoam, foam);
    alpha = clamp(0.35 + murk * 0.6 + fresnel * 0.5 + foam, 0.0, 1.0);

  #elif WATER_MODE == 1
    // Lava: a slow crust drifting over a glowing core.
    float rip = ripples(p);
    // Large, slow plates: low frequencies only, so the river reads as one
    // body of molten rock instead of busy static.
    float warp = fbm(flowP * 0.45 + uTime * 0.03);
    float crust = fbm(flowP * 1.1 + warp * 1.2);
    float cells = smoothstep(0.04, 0.16, voronoiEdge(flowP * 1.35 + warp * 0.8));
    float cool = smoothstep(0.4, 0.6, crust) * cells;
    float pulse = 0.92 + 0.08 * sin(uTime * 1.1 + p.x * 0.35);
    vec3 hot = mix(uShallow, uFoam, smoothstep(0.32, 0.12, crust) * 0.7) * (0.85 * pulse);
    vec3 dark = uDeep * (0.75 + 0.3 * noise(p * 2.2));
    float edge = smoothstep(0.35, 0.0, shoreDist);
    color = mix(hot, dark, clamp(cool + edge * 0.6, 0.0, 1.0));
    color += uFoam * 1.1 * smoothstep(0.25, 0.85, rip);
    vec3 n = vec3(0.0, 1.0, 0.0);
    color += reflections(vWorld, n, viewDir) * 0.3;

  #else
    // Ice: frosted plate, faint inner fractures, fresh cracks around hits.
    float frost = fbm(p * 1.3);
    vec3 base = mix(uDeep, uShallow, smoothstep(0.25, 0.75, frost));
    float snow = smoothstep(0.42, 0.05, shoreDist) * (0.6 + 0.4 * noise(p * 4.0));
    base = mix(base, uFoam, clamp(snow + smoothstep(0.62, 0.8, fbm(p * 3.0 + 7.0)) * 0.5, 0.0, 1.0));
    float old = smoothstep(0.035, 0.0, voronoiEdge(p * 1.6)) * 0.35 * smoothstep(0.4, 0.7, noise(p * 0.7));
    float fresh = 0.0;
    for (int i = 0; i < MAX_CRACKS; i++) {
      vec4 c = uCracks[i];
      if (c.w <= 0.0) continue;
      float age = uTime - c.z;
      float radius = c.w * smoothstep(0.0, 1.4, age);
      float d = distance(p, c.xy);
      if (d > radius + 0.3) continue;
      vec2 q = p - c.xy;
      float ang = atan(q.y, q.x);
      float radial = smoothstep(0.08, 0.0, abs(fract(ang * 1.1 + noise(q * 3.0) * 0.6) - 0.5) * d * 2.4);
      float web = smoothstep(0.05, 0.0, voronoiEdge(p * 4.0 + c.xy));
      float mask = smoothstep(radius, radius * 0.6, d);
      fresh = max(fresh, max(radial, web * 0.8) * mask);
    }
    vec3 n = normalize(vec3((noise(p * 8.0) - 0.5) * 0.08, 1.0, (noise(p * 8.0 + 3.0) - 0.5) * 0.08));
    vec3 reflected = reflect(-viewDir, n);
    vec3 sky = mix(uSkyLow, uSkyHigh, clamp(reflected.y, 0.0, 1.0));
    float fresnel = 0.05 + 0.95 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    color = mix(base, sky, fresnel * 0.6);
    color = mix(color, uDeep * 0.35, clamp(old + fresh, 0.0, 1.0));
    color += vec3(0.6, 0.85, 1.0) * fresh * 0.25;
    for (int i = 0; i < MAX_HOLES; i++) {
      vec3 hole = uHoles[i];
      if (hole.z <= 0.0) continue;
      float d = distance(p, hole.xy);
      float wobble = noise(vec2(atan(p.y - hole.y, p.x - hole.x) * 2.0, 0.0)) * 0.05;
      color = mix(color, uDeep * 0.25 + vec3(0.0, 0.03, 0.06), smoothstep(hole.z + wobble, hole.z - 0.03 + wobble, d));
      color = mix(color, uFoam, smoothstep(0.05, 0.0, abs(d - hole.z - wobble - 0.03)) * 0.7);
    }
    float spec = pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 60.0);
    color += vec3(1.0, 0.97, 0.9) * spec * 0.8;
    color += reflections(vWorld, n, viewDir) * 0.8;
  #endif

    gl_FragColor = vec4(color, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface ReflectedLight {
  position: Vector3;
  color: Color;
  intensity: number;
}

/**
 * The river between both fields. One shader handles water, lava and ice; a
 * theme picks the mode, which recompiles the material (the old one is freed).
 */
export class Lake {
  readonly group = new Group();
  readonly #mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  readonly #ripples: Vector4[] = Array.from({ length: MAX_RIPPLES }, () => new Vector4(0, 0, -100, 0));
  readonly #lights: Vector4[] = Array.from({ length: MAX_REFLECTIONS }, () => new Vector4(0, 0, 0, 0));
  readonly #lightColors: Color[] = Array.from({ length: MAX_REFLECTIONS }, () => new Color());
  readonly #cracks: Vector4[] = Array.from({ length: MAX_CRACKS }, () => new Vector4(0, 0, 0, 0));
  readonly #holes: Vector3[] = Array.from({ length: MAX_HOLES }, () => new Vector3(0, 0, 0));
  readonly #reducedMotion: () => boolean;
  readonly #sun: Vector3;
  #params: WaterParams = DEFAULT_WATER;
  #nextRipple = 0;
  #nextCrack = 0;
  #nextAmbientDrop = 1;
  #rain = 0;
  #time = 0;

  constructor(sunDirection: Vector3, reducedMotion: () => boolean) {
    this.#reducedMotion = reducedMotion;
    this.#sun = sunDirection.clone().normalize();
    const geometry = new PlaneGeometry(PLATE_HALF_X * 2, LAKE_WIDTH, 120, 16);
    geometry.rotateX(-Math.PI / 2);
    this.#mesh = new Mesh(geometry, this.#createMaterial(DEFAULT_WATER));
    this.#mesh.position.y = WATER_LEVEL;
    this.#mesh.name = 'lake';
    this.#mesh.renderOrder = 1;
    this.group.add(this.#mesh);
  }

  get mode(): WaterMode {
    return this.#params.mode;
  }

  get time(): number {
    return this.#time;
  }

  get material(): ShaderMaterial {
    return this.#mesh.material;
  }

  /** Switches look (and possibly mode); the previous shader is disposed. */
  setParams(params: WaterParams): void {
    const old = this.#mesh.material;
    this.#params = params;
    this.#mesh.material = this.#createMaterial(params);
    old.dispose();
    for (const crack of this.#cracks) crack.w = 0;
    for (const ripple of this.#ripples) ripple.w = 0;
  }

  addRipple(x: number, z: number, strength = 1): void {
    const ripple = this.#ripples[this.#nextRipple];
    if (!ripple) return;
    ripple.set(x, z, this.#time, strength);
    this.#nextRipple = (this.#nextRipple + 1) % MAX_RIPPLES;
  }

  /** A crack in the ice that grows up to `radius` over a second or so. */
  addCrack(x: number, z: number, radius: number): void {
    const crack = this.#cracks[this.#nextCrack];
    if (!crack) return;
    crack.set(x, z, this.#time, radius);
    this.#nextCrack = (this.#nextCrack + 1) % MAX_CRACKS;
  }

  setHole(index: number, x: number, z: number, radius: number): void {
    this.#holes[index]?.set(x, z, radius);
  }

  /** Bright points (fireworks, flares) mirrored on the surface. */
  setReflections(lights: readonly ReflectedLight[]): void {
    for (let i = 0; i < MAX_REFLECTIONS; i++) {
      const light = lights[i];
      const slot = this.#lights[i]!;
      if (!light) {
        slot.w = 0;
        continue;
      }
      slot.set(light.position.x, light.position.y, light.position.z, light.intensity);
      this.#lightColors[i]!.copy(light.color);
    }
  }

  /** 0..1, adds raindrop rings all over the river. */
  setRain(amount: number): void {
    this.#rain = amount;
  }

  /** Approximate surface height for floating things. */
  surfaceY(x: number, z: number): number {
    if (this.#params.mode === 'ice') return WATER_LEVEL;
    const t = this.#time;
    return WATER_LEVEL + 0.012 * Math.sin(x * 0.9 + t * 1.2) + 0.008 * Math.sin(z * 3.1 - t * 1.7);
  }

  update(dt: number): void {
    this.#time += dt;
    this.#mesh.material.uniforms.uTime!.value = this.#time;
    if (this.#params.mode !== 'water') return;

    this.#nextAmbientDrop -= dt * (1 + this.#rain * 14);
    if (this.#nextAmbientDrop <= 0 && !this.#reducedMotion()) {
      const strength = this.#rain > 0 ? rand(0.15, 0.35) : rand(0.25, 0.55);
      this.addRipple(rand(-PLATE_HALF_X + 1, PLATE_HALF_X - 1), rand(-1.1, 1.1), strength);
      this.#nextAmbientDrop = rand(1.4, 3.2);
    }
  }

  dispose(): void {
    this.#mesh.geometry.dispose();
    this.#mesh.material.dispose();
    this.group.removeFromParent();
  }

  #createMaterial(params: WaterParams): ShaderMaterial {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: { WATER_MODE: MODE_ID[params.mode] },
      // Fog uniforms are cloned; the arrays below must stay shared references.
      uniforms: {
        ...UniformsUtils.clone(UniformsLib.fog),
        uTime: { value: this.#time },
        uHalfDepth: { value: FIELD_INNER_Z },
        uHalfWidth: { value: PLATE_HALF_X },
        uWaterLevel: { value: WATER_LEVEL },
        uBedDepth: { value: RIVER_DEPTH },
        uFlow: { value: params.flow },
        uClarity: { value: params.clarity },
        uChop: { value: params.chop ?? 0 },
        uDeep: { value: new Color(params.deep) },
        uShallow: { value: new Color(params.shallow) },
        uSkyLow: { value: new Color(params.skyLow) },
        uSkyHigh: { value: new Color(params.skyHigh) },
        uFoam: { value: new Color(params.foam) },
        uSunDir: { value: this.#sun },
        uRipples: { value: this.#ripples },
        uLights: { value: this.#lights },
        uLightColors: { value: this.#lightColors },
        uCracks: { value: this.#cracks },
        uHoles: { value: this.#holes },
      },
      transparent: params.mode === 'water',
      depthWrite: params.mode !== 'water',
      fog: true,
    });
    return material;
  }
}
