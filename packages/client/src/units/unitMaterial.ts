import { MeshStandardMaterial, Vector4, type IUniform } from 'three';
import { TEAM_COLORS } from '../materials/palettes';
import type { TeamId } from './roles';

export const MAX_SCORCH_CELLS = 4;

/** Uniforms shared by every unit; themes tweak them once for the whole army. */
export const UNIT_THEME_UNIFORMS = {
  uSnow: { value: 0 } as IUniform<number>,
  uHeat: { value: 0 } as IUniform<number>,
  uUnitTime: { value: 0 } as IUniform<number>,
};

export interface UnitMaterialState {
  /** 0..1 white-hot hit flash. */
  flash: IUniform<number>;
  /** 0..1 burnt look of the whole piece once destroyed. */
  char: IUniform<number>;
  /** Emissive parts (lamps, coils, lenses): 1 alive, 0 dead. */
  lights: IUniform<number>;
  /** World xz of each covered cell in .xz and scorch amount in .w. */
  scorch: IUniform<Vector4[]>;
}

export type UnitBodyMaterial = MeshStandardMaterial & { userData: { unit: UnitMaterialState } };

const vertexHead = /* glsl */ `
attribute float aTeam;
varying float vTeam;
varying vec3 vUnitWorld;
varying vec3 vUnitNormal;
`;

const fragmentHead = /* glsl */ `
#define MAX_SCORCH ${MAX_SCORCH_CELLS}
uniform vec3 uTeamMain;
uniform vec3 uTeamDark;
uniform vec3 uTeamGlow;
uniform float uFlash;
uniform float uChar;
uniform float uLights;
uniform float uSnow;
uniform float uHeat;
uniform float uUnitTime;
uniform vec4 uScorch[MAX_SCORCH];
varying float vTeam;
varying vec3 vUnitWorld;
varying vec3 vUnitNormal;

float uHash(vec3 p) { return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
float uNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(uHash(i), uHash(i + vec3(1,0,0)), f.x), mix(uHash(i + vec3(0,1,0)), uHash(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(uHash(i + vec3(0,0,1)), uHash(i + vec3(1,0,1)), f.x), mix(uHash(i + vec3(0,1,1)), uHash(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float scorchAmount() {
  float s = 0.0;
  for (int i = 0; i < MAX_SCORCH; i++) {
    vec4 c = uScorch[i];
    if (c.w <= 0.0) continue;
    vec2 d = abs(vUnitWorld.xz - c.xz);
    float inside = 1.0 - smoothstep(0.42, 0.56, max(d.x, d.y));
    s = max(s, inside * c.w);
  }
  return s;
}
`;

const colorChunk = /* glsl */ `
#include <color_fragment>
if (vTeam > 0.5) {
  vec3 teamTint = vTeam < 1.5 ? uTeamMain : (vTeam < 2.5 ? uTeamDark : uTeamGlow);
  diffuseColor.rgb *= teamTint;
}
float unitNoise = uNoise(vUnitWorld * 9.0) * 0.6 + uNoise(vUnitWorld * 23.0) * 0.4;
float unitScorch = scorchAmount() * smoothstep(0.25, 0.6, unitNoise + 0.25);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.04, 0.035) * (0.6 + unitNoise), unitScorch * 0.85);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.06, 0.055, 0.05) * (0.7 + unitNoise * 0.6), uChar);
// Snow settles only on faces that look up (normal.y > ~0.6) and never on the
// team-coloured slots, so stripes and accents stay readable on the tundra.
float snowUp = smoothstep(0.6, 0.85, vUnitNormal.y + (unitNoise - 0.5) * 0.2);
float snowCover = uSnow * snowUp * smoothstep(0.3, 0.62, unitNoise) * step(vTeam, 0.5);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.95, 1.0), snowCover * 0.85);
`;

const emissiveChunk = /* glsl */ `
#include <emissivemap_fragment>
if (vTeam > 2.5) totalEmissiveRadiance += uTeamGlow * 1.6 * uLights;
totalEmissiveRadiance += vec3(1.0, 0.92, 0.82) * uFlash * 1.8;
float embers = smoothstep(0.84, 0.98, uNoise(vUnitWorld * 14.0 + vec3(0.0, uUnitTime * 0.6, 0.0)));
totalEmissiveRadiance += vec3(1.6, 0.42, 0.06) * embers * max(unitScorch, uChar * 0.6) * (0.55 + 0.45 * sin(uUnitTime * 3.0 + unitNoise * 9.0));
totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * uHeat * smoothstep(0.35, 0.0, vUnitWorld.y) * 0.35;
`;

/**
 * Body material for one unit: vertex colours for fixed parts, team colours via
 * an `aTeam` slot (1 main, 2 dark, 3 glow), plus hit flash, per-cell scorch and
 * a charred state. Every instance shares one shader program.
 */
export function createUnitMaterial(team: TeamId): UnitBodyMaterial {
  const state: UnitMaterialState = {
    flash: { value: 0 },
    char: { value: 0 },
    lights: { value: 1 },
    scorch: { value: Array.from({ length: MAX_SCORCH_CELLS }, () => new Vector4(0, 0, 0, 0)) },
  };
  const colors = TEAM_COLORS[team];
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 }) as UnitBodyMaterial;
  material.userData.unit = state;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uTeamMain: { value: colors.main },
      uTeamDark: { value: colors.dark },
      uTeamGlow: { value: colors.glow },
      uFlash: state.flash,
      uChar: state.char,
      uLights: state.lights,
      uScorch: state.scorch,
      ...UNIT_THEME_UNIFORMS,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vertexHead}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vTeam = aTeam;
        vUnitWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vUnitNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${fragmentHead}`)
      .replace('#include <color_fragment>', colorChunk)
      .replace('#include <emissivemap_fragment>', emissiveChunk);
  };
  material.customProgramCacheKey = () => 'unit-body-v2';
  return material;
}
