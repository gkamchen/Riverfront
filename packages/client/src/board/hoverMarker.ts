import { AdditiveBlending, Color, Mesh, PlaneGeometry, ShaderMaterial, type Vector3 } from 'three';
import { damp } from '../anim/easing';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  float roundedBox(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + r;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }

  void main() {
    vec2 p = vUv - 0.5;
    float d = roundedBox(p, vec2(0.36), 0.06);
    float rim = exp(-abs(d) * 38.0);
    float halo = exp(-max(d, 0.0) * 12.0) * 0.35;
    float pulse = 0.75 + 0.25 * sin(uTime * 5.0);
    float alpha = (rim + halo) * pulse * uOpacity;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

/** Golden glowing outline that hovers over the selected enemy tile. */
export class HoverMarker {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  #visible = 0;
  #targetVisible = 0;

  constructor() {
    const geometry = new PlaneGeometry(1.5, 1.5);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uColor: { value: new Color('#ffcf6b').multiplyScalar(1.6) },
        uTime: { value: 0 },
        uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.name = 'hover-marker';
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }

  show(position: Vector3): void {
    this.mesh.position.copy(position);
    this.mesh.position.y += 0.012;
    this.#targetVisible = 1;
  }

  hide(): void {
    this.#targetVisible = 0;
  }

  update(dt: number, time: number): void {
    this.#visible += (this.#targetVisible - this.#visible) * damp(16, dt);
    const material = this.mesh.material;
    material.uniforms.uTime!.value = time;
    material.uniforms.uOpacity!.value = this.#visible;
    this.mesh.visible = this.#visible > 0.01;
  }
}
