import { DoubleSide, MeshStandardMaterial, PlaneGeometry, type IUniform } from 'three';
import { TEAM_COLORS } from '../materials/palettes';
import type { TeamId } from './roles';

const FLAG_WIDTH = 0.3;
const FLAG_HEIGHT = 0.19;

/** Shared clock for every flag so they all wave from one uniform. */
export const flagTime: IUniform<number> = { value: 0 };

let geometry: PlaneGeometry | null = null;
const materials = new Map<TeamId, MeshStandardMaterial>();

export function flagGeometry(): PlaneGeometry {
  if (!geometry) {
    geometry = new PlaneGeometry(FLAG_WIDTH, FLAG_HEIGHT, 12, 4);
    // Hang it from its top-left corner (the pole).
    geometry.translate(FLAG_WIDTH / 2, -FLAG_HEIGHT / 2, 0);
  }
  return geometry;
}

export function flagMaterial(team: TeamId): MeshStandardMaterial {
  const existing = materials.get(team);
  if (existing) return existing;

  const material = new MeshStandardMaterial({ emissiveIntensity: 0.25, roughness: 0.6, side: DoubleSide });
  // Share the palette colours so a colour-blind switch recolours flags too.
  material.color = TEAM_COLORS[team].main;
  material.emissive = TEAM_COLORS[team].dark;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = flagTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        float flagPhase = modelMatrix[3].x * 1.7 + modelMatrix[3].z * 2.3;
        float along = position.x / ${FLAG_WIDTH.toFixed(2)};
        transformed.z += sin(position.x * 18.0 - uTime * 5.5 + flagPhase) * 0.035 * along;
        transformed.y += sin(position.x * 11.0 - uTime * 3.7 + flagPhase) * 0.012 * along;`,
      );
  };
  material.customProgramCacheKey = () => 'waving-flag';
  materials.set(team, material);
  return material;
}
