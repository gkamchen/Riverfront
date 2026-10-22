import {
  Color,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  type Texture,
} from 'three';
import { OUTER_HALF_X, OUTER_HALF_Z } from '../board/layout';
import {
  createCapTexture,
  createFrameWood,
  createScorchTexture,
  createSoilTexture,
  createTableWood,
} from './textures';

export interface MaterialLibrary {
  frame: MeshPhysicalMaterial;
  plate: MeshStandardMaterial;
  table: MeshStandardMaterial;
  tileCap: MeshPhysicalMaterial;
  tileSoil: MeshStandardMaterial;
  tileSide: MeshPhysicalMaterial;
  stone: MeshStandardMaterial;
  rock: MeshStandardMaterial;
  charred: MeshStandardMaterial;
  scorch: MeshStandardMaterial;
  debris: MeshStandardMaterial;
  unit: MeshPhysicalMaterial;
}

/**
 * Every tile shows a different window of the soil texture: a quarter turn, an
 * optional mirror and an offset picked from the tile's position. Without it the
 * same blotch repeats on all 350 open tiles.
 */
export function varySoilPerTile(material: MeshStandardMaterial): void {
  const chunk = /* glsl */ `
    #ifdef USE_INSTANCING
      vec2 tileKey = floor(instanceMatrix[3].xz + 0.5);
      float tileHash = fract(sin(dot(tileKey, vec2(12.9898, 78.233))) * 43758.5453);
      float tileHashB = fract(tileHash * 17.13 + 0.31);
      float tileHashC = fract(tileHashB * 9.7 + tileHash * 3.1);
      float quarter = floor(tileHash * 4.0) * 1.5707963;
      mat2 tileTurn = mat2(cos(quarter), sin(quarter), -sin(quarter), cos(quarter));
      vec2 tileShift = vec2(tileHashB, tileHashC) * 0.42 + 0.29;
      float tileMirror = tileHashC > 0.5 ? -1.0 : 1.0;
    #endif
  `;
  const remap = (name: string) => /* glsl */ `
    #ifdef USE_INSTANCING
      ${name} = tileTurn * ((${name} - 0.5) * vec2(tileMirror, 1.0)) * 0.58 + tileShift;
    #endif
  `;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      ${chunk}
      #ifdef USE_MAP
        ${remap('vMapUv')}
      #endif
      #ifdef USE_EMISSIVEMAP
        ${remap('vEmissiveMapUv')}
      #endif`,
    );
  };
  material.customProgramCacheKey = () => 'tile-soil-varied';
}

/** Colour of the thin light rim around rocks; themes set it (warm by lava, cool on ice). */
export const ROCK_RIM = { value: new Color('#b8b0a4') };

/**
 * Faceted stone with a soft view-dependent rim so rock cells separate from
 * dark soil and glowing rivers without needing a brighter base colour.
 */
function createRockMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRockRim = ROCK_RIM;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRockRim;')
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        float rockRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += uRockRim * rockRim * 0.35;`,
      );
  };
  material.customProgramCacheKey = () => 'rock-rim';
  return material;
}

function createUnitMaterial(): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.05,
    clearcoat: 0.9,
    clearcoatRoughness: 0.22,
    sheen: 0.2,
  });
}

export function createMaterialLibrary(): MaterialLibrary {
  const wood = createFrameWood(OUTER_HALF_X * 2, OUTER_HALF_Z * 2);
  const tableWood: Texture = createTableWood();
  tableWood.wrapS = RepeatWrapping;
  tableWood.wrapT = RepeatWrapping;
  tableWood.repeat.set(9, 9);

  const soil = new MeshStandardMaterial({ map: createSoilTexture(), roughness: 0.96 });
  varySoilPerTile(soil);

  return {
    frame: new MeshPhysicalMaterial({
      map: wood.map,
      roughnessMap: wood.roughness,
      roughness: 0.9,
      clearcoat: 0.6,
      clearcoatRoughness: 0.32,
      envMapIntensity: 0.7,
    }),
    plate: new MeshStandardMaterial({ color: new Color('#120d0a'), roughness: 0.7 }),
    table: new MeshStandardMaterial({ map: tableWood, roughness: 0.82, envMapIntensity: 0.35, color: new Color('#a89888') }),
    tileCap: new MeshPhysicalMaterial({
      map: createCapTexture(),
      roughness: 0.16,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
      envMapIntensity: 0.6,
    }),
    tileSoil: soil,
    tileSide: new MeshPhysicalMaterial({
      color: new Color('#3b2a1f'),
      roughness: 0.38,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25,
    }),
    stone: createRockMaterial(),
    rock: createRockMaterial(),
    charred: new MeshStandardMaterial({ vertexColors: true, color: new Color('#3a3330'), roughness: 0.92 }),
    scorch: new MeshStandardMaterial({
      map: createScorchTexture(),
      transparent: true,
      depthWrite: false,
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    }),
    debris: new MeshStandardMaterial({ roughness: 0.8, flatShading: true }),
    unit: createUnitMaterial(),
  };
}
