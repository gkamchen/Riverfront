import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HalfFloatType,
  HemisphereLight,
  PCFShadowMap,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { ThemePalette } from '../materials/themes';
import { createBackdropTexture } from '../materials/textures';
import { QUALITY_PRESETS, pixelRatioCap, type QualityTier } from './quality';
import { SkyDecor } from './sky';

export type Quality = QualityTier;

/**
 * Tames tiny, extremely bright specular hits before bloom. Without it a single
 * glossy pixel facing the sun turns into a huge milky halo.
 */
const HighlightClampShader = {
  uniforms: { tDiffuse: { value: null }, uMax: { value: 3.0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uMax;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (any(isnan(color.rgb)) || any(isinf(color.rgb))) color.rgb = vec3(0.0);
      gl_FragColor = vec4(min(color.rgb, vec3(uMax)), color.a);
    }`,
};

/** Direction the key light comes from; the lake shader reuses it for its glints. */
export const SUN_DIRECTION = new Vector3(-0.55, 1, 0.45).normalize();

interface LightLook {
  sun: Color;
  sunIntensity: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  rim: Color;
  rimIntensity: number;
  exposure: number;
  environment: number;
  fog: Color;
  backdrop: readonly string[];
  duskSun: Color;
  duskBackdrop: readonly string[];
}

function mixHex(a: string, b: string, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

/**
 * Renderer, scene, lights, sky decor and the optional bloom pipeline.
 * Everything about how the frame is produced lives here, nothing about the game.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly sky = new SkyDecor();
  readonly #sun = new DirectionalLight(new Color('#ffe9cf'), 2.6);
  readonly #hemi = new HemisphereLight(new Color('#c8d8ff'), new Color('#3a2414'), 0.55);
  readonly #rim = new DirectionalLight(new Color('#8fb0ff'), 0.7);
  readonly #fog = new Fog(new Color('#1c140e'), 38, 95);
  readonly #camera: PerspectiveCamera;
  #composer: EffectComposer | null = null;
  #bloom: UnrealBloomPass | null = null;
  #quality: Quality = 'high';
  #look: LightLook;
  #dusk = 0;
  #gloom = 0;
  #backdrop: Texture | null = null;
  #backdropDirty = false;
  #backdropBuiltAt = -1;
  #fogRange: { near: number; far: number } | null = null;
  #time = 0;

  constructor(canvas: HTMLCanvasElement, camera: PerspectiveCamera) {
    this.#camera = camera;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.#look = {
      sun: new Color('#ffe9cf'),
      sunIntensity: 2.6,
      hemiSky: new Color('#c8d8ff'),
      hemiGround: new Color('#3a2414'),
      hemiIntensity: 0.55,
      rim: new Color('#8fb0ff'),
      rimIntensity: 0.7,
      exposure: 0.95,
      environment: 0.55,
      fog: new Color('#1c140e'),
      backdrop: ['#07090d', '#1a1712', '#2a2018', '#120c08'],
      duskSun: new Color('#ff9a52'),
      duskBackdrop: ['#0b0a1a', '#2a1a28', '#4a2a22', '#140c0a'],
    };
    this.#setupEnvironment();
    this.#setupLights();
    this.scene.add(this.sky.group);
    this.#applyLook();
  }

  get quality(): Quality {
    return this.#quality;
  }

  get dusk(): number {
    return this.#dusk;
  }

  setQuality(quality: Quality): void {
    this.#quality = quality;
    const preset = QUALITY_PRESETS[quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap(quality)));
    this.#sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    this.#sun.shadow.radius = preset.shadowRadius;
    this.#sun.shadow.map?.dispose();
    this.#sun.shadow.map = null;

    if (preset.bloom && !this.#composer) this.#createComposer();
    if (!preset.bloom && this.#composer) {
      this.#composer.dispose();
      this.#composer = null;
      this.#bloom = null;
    }
    this.resize();
  }

  /** Light, fog and backdrop of a theme (the old backdrop texture is freed). */
  applyTheme(palette: ThemePalette): void {
    this.#look = {
      sun: new Color(palette.sun),
      sunIntensity: palette.sunIntensity,
      hemiSky: new Color(palette.hemiSky),
      hemiGround: new Color(palette.hemiGround),
      hemiIntensity: palette.hemiIntensity,
      rim: new Color(palette.rim),
      rimIntensity: palette.rimIntensity,
      exposure: palette.exposure,
      environment: palette.environment,
      fog: new Color(palette.fog),
      backdrop: palette.backdrop,
      duskSun: new Color(palette.duskSun),
      duskBackdrop: palette.duskBackdrop,
    };
    this.#applyLook();
  }

  /**
   * 0 = day, 1 = evening light. Lights follow at once; the backdrop canvas is
   * rebuilt at most a few times per second while a slider is being dragged.
   */
  setDusk(amount: number): void {
    const next = Math.min(1, Math.max(0, amount));
    if (next === this.#dusk) return;
    this.#dusk = next;
    this.#applyLook(false);
    this.#backdropDirty = true;
  }

  /**
   * Fixes the fog distances. Pass null to go back to the automatic range,
   * which follows the camera distance so far (portrait) views do not drown.
   */
  setFogRange(range: { near: number; far: number } | null): void {
    this.#fogRange = range;
    this.#updateFog();
  }

  /** Darker, flatter light for rain (0..1). */
  setGloom(amount: number): void {
    const next = Math.min(1, Math.max(0, amount));
    if (Math.abs(next - this.#gloom) < 0.01) return;
    this.#gloom = next;
    this.#applyLook(false);
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.#composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.#composer?.setSize(width, height);
    this.#bloom?.setSize(width / 2, height / 2);
  }

  /** Canvas height in device pixels, used to size point sprites. */
  get drawingHeight(): number {
    return this.renderer.getDrawingBufferSize(new Vector2()).y;
  }

  /**
   * Compiles every material currently in the scene without stalling a frame
   * (uses the parallel-compile extension when the driver has it).
   */
  async precompile(): Promise<void> {
    const renderer = this.renderer as WebGLRenderer & { compileAsync?: (scene: Scene, camera: PerspectiveCamera) => Promise<unknown> };
    if (renderer.compileAsync) await renderer.compileAsync(this.scene, this.#camera);
    else renderer.compile(this.scene, this.#camera);
  }

  render(dt = 1 / 60): void {
    this.#time += dt;
    if (this.#backdropDirty && this.#time - this.#backdropBuiltAt > 0.15) this.#rebuildBackdrop();
    this.#updateFog();
    this.sky.update(dt, this.#time);
    if (this.#composer) this.#composer.render();
    else this.renderer.render(this.scene, this.#camera);
  }

  #applyLook(rebuildBackdrop = true): void {
    const look = this.#look;
    const d = this.#dusk;
    const g = this.#gloom;
    this.#sun.color.copy(look.sun).lerp(look.duskSun, d * 0.8);
    this.#sun.intensity = look.sunIntensity * (1 - d * 0.5) * (1 - g * 0.55);
    this.#hemi.color.copy(look.hemiSky).lerp(look.duskSun, d * 0.25);
    this.#hemi.groundColor.copy(look.hemiGround);
    this.#hemi.intensity = look.hemiIntensity * (1 - d * 0.35) * (1 - g * 0.3);
    this.#rim.color.copy(look.rim);
    this.#rim.intensity = look.rimIntensity * (1 + d * 0.3);
    this.renderer.toneMappingExposure = look.exposure * (1 - g * 0.18);
    this.scene.environmentIntensity = look.environment * (1 - d * 0.3);
    this.#fog.color.copy(look.fog).multiplyScalar(1 - g * 0.3);
    if (rebuildBackdrop) this.#rebuildBackdrop();
  }

  #rebuildBackdrop(): void {
    const look = this.#look;
    const stops = look.backdrop.map((stop, i) => mixHex(stop, look.duskBackdrop[i] ?? stop, this.#dusk));
    this.#backdrop?.dispose();
    this.#backdrop = createBackdropTexture(stops);
    this.scene.background = this.#backdrop;
    this.#backdropDirty = false;
    this.#backdropBuiltAt = this.#time;
  }

  /** Same proportions the old fixed 38..95 range had at the default landscape distance (~29). */
  #updateFog(): void {
    if (this.#fogRange) {
      this.#fog.near = this.#fogRange.near;
      this.#fog.far = this.#fogRange.far;
      return;
    }
    const distance = Math.max(10, this.#camera.position.length());
    this.#fog.near = distance * 1.32;
    this.#fog.far = distance * 3.3;
  }

  /** Frees the renderer and every GPU resource the stage created. */
  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.#composer?.dispose();
    this.#composer = null;
    this.#bloom = null;
    this.#backdrop?.dispose();
    this.#backdrop = null;
    this.scene.environment?.dispose();
    this.scene.environment = null;
    this.#sun.shadow.map?.dispose();
    this.sky.dispose();
    this.renderer.dispose();
  }

  #setupEnvironment(): void {
    const pmrem = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, 0.06).texture;
    this.scene.environmentIntensity = 0.55;
    room.dispose();
    pmrem.dispose();
    this.scene.fog = this.#fog;
  }

  #setupLights(): void {
    this.#sun.position.copy(SUN_DIRECTION).multiplyScalar(30);
    this.#sun.castShadow = true;
    const shadowCamera = this.#sun.shadow.camera;
    shadowCamera.left = -17;
    shadowCamera.right = 17;
    shadowCamera.top = 13;
    shadowCamera.bottom = -13;
    shadowCamera.near = 5;
    shadowCamera.far = 70;
    this.#sun.shadow.bias = -0.0004;
    this.#sun.shadow.normalBias = 0.025;
    this.scene.add(this.#sun, this.#sun.target, this.#hemi);
    this.#rim.position.set(12, 9, -18);
    this.scene.add(this.#rim);
  }

  #createComposer(): void {
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(size.x, size.y, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.#camera));
    composer.addPass(new ShaderPass(HighlightClampShader));
    const bloom = new UnrealBloomPass(new Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 2.4);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    this.#composer = composer;
    this.#bloom = bloom;
  }
}
