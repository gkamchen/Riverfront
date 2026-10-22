import { AdditiveBlending, Color, DoubleSide, Group, Mesh, PlaneGeometry, ShaderMaterial } from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uSeed;
  varying vec2 vUv;

  float hash(float n) { return fract(sin(n) * 43758.5453); }
  float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i), hash(i + 1.0), f * f * (3.0 - 2.0 * f)); }

  void main() {
    float x = vUv.x * 6.0 + uSeed;
    // Folding curtain: the base line wanders, rays run upwards from it.
    float wave = noise(x * 0.8 + uTime * 0.05) * 0.25 + sin(x * 1.7 + uTime * 0.2) * 0.06;
    float base = 0.18 + wave;
    float above = vUv.y - base;
    float rays = 0.55 + 0.45 * noise(vUv.x * 90.0 + uTime * 0.6 + uSeed * 3.0);
    float curtain = smoothstep(0.0, 0.04, above) * exp(-max(above, 0.0) * 3.2) * rays;
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    vec3 color = mix(uColorA, uColorB, smoothstep(0.05, 0.55, above));
    float a = curtain * edge * uIntensity;
    gl_FragColor = vec4(color * a, a);
  }
`;

/** Distant decor behind the board: aurora curtains for the tundra theme. */
export class SkyDecor {
  readonly group = new Group();
  readonly #curtains: Mesh<PlaneGeometry, ShaderMaterial>[] = [];
  #level = 0;
  #target = 0;

  constructor() {
    const specs: Array<[number, number, number, number, number]> = [
      // x, y, z, width, yaw
      [-14, 9, -46, 60, 0.15],
      [12, 11, -52, 70, -0.2],
      [0, 14, -60, 80, 0.05],
    ];
    specs.forEach(([x, y, z, w, yaw], i) => {
      const material = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uIntensity: { value: 0 },
          uColorA: { value: new Color(0.25, 1.4, 0.75) },
          uColorB: { value: new Color(0.55, 0.25, 1.1) },
          uSeed: { value: i * 7.3 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
        fog: false,
      });
      const mesh = new Mesh(new PlaneGeometry(w, 26, 1, 1), material);
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.group.add(mesh);
      this.#curtains.push(mesh);
    });
    this.group.name = 'sky';
  }

  setAurora(on: boolean): void {
    this.#target = on ? 1 : 0;
  }

  update(dt: number, time: number): void {
    this.#level += (this.#target - this.#level) * Math.min(1, dt * 0.8);
    for (const mesh of this.#curtains) {
      mesh.visible = this.#level > 0.01;
      mesh.material.uniforms.uTime!.value = time;
      mesh.material.uniforms.uIntensity!.value = this.#level * 0.9;
    }
  }

  dispose(): void {
    for (const mesh of this.#curtains) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.group.removeFromParent();
  }
}
