import { BufferGeometry, Vector3, type Mesh, type Object3D } from 'three';
import { cached, merge, mesh } from '../../units/parts';
import type { UnitBodyMaterial } from '../../units/unitMaterial';
import type { WreckContext } from '../../units/unitModel';
import type { Parts } from './pieces';
import type { KitStyle } from './style';

/** One merged, cached, vertex-coloured mesh of a kit piece. */
export function piece(k: KitStyle, body: UnitBodyMaterial, name: string, build: () => Parts): Mesh {
  return mesh(
    cached(`${k.key}:${name}`, () => {
      const parts = build();
      // Some styles have nothing to show (no shield, say): keep an empty mesh so the rig stays the same.
      return parts.length > 0 ? merge(parts) : new BufferGeometry();
    }),
    body,
    name,
  );
}


/**
 * An animal (or anything) bolting off its footprint: it turns away, runs a
 * short distance and shrinks out of sight. Used instead of showing harm.
 */
export function bolt(ctx: WreckContext, part: Object3D, direction: Vector3, duration = 1.3): Promise<void> {
  const start = part.position.clone();
  const scale = part.scale.x;
  const yaw = part.rotation.y;
  const turn = Math.atan2(-direction.z, -direction.x) * 0.5;
  return ctx.tweens.run(duration, (t) => {
    const e = t * t;
    part.position.set(start.x + direction.x * e, start.y + Math.abs(Math.sin(t * Math.PI * 7)) * 0.03 * (1 - t), start.z + direction.z * e);
    part.rotation.y = yaw + turn * Math.min(1, t * 3);
    part.scale.setScalar(Math.max(0.001, scale * (1 - Math.max(0, (t - 0.55) / 0.45))));
  });
}

/** Simple flicker for flame meshes. */
export function flicker(flames: readonly Object3D[], time: number, base = 1): void {
  flames.forEach((f, i) => {
    const s = base * (0.85 + Math.sin(time * 13 + i * 2.1) * 0.1 + Math.sin(time * 23 + i) * 0.06);
    f.scale.set(s, s * (1 + Math.sin(time * 17 + i * 3) * 0.12), s);
  });
}

