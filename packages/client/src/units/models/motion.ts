import { Vector3, type Object3D } from 'three';
import { easeOutBounce, easeOutCubic } from '../../anim/easing';
import type { WreckContext } from '../unitModel';

/**
 * Throws a part along a parabola to `to` (in its parent's space), spinning it
 * by `spin` radians per axis, and settles it with a small bounce.
 */
export async function throwPart(
  ctx: WreckContext,
  part: Object3D,
  to: Vector3,
  height: number,
  duration: number,
  spin: Vector3,
  finalRotation?: Vector3,
): Promise<void> {
  const start = part.position.clone();
  const r0 = new Vector3(part.rotation.x, part.rotation.y, part.rotation.z);
  const r1 = finalRotation ?? r0.clone().add(spin);
  await ctx.tweens.run(duration, (t) => {
    part.position.lerpVectors(start, to, t);
    part.position.y = start.y + (to.y - start.y) * t + Math.sin(Math.PI * t) * height;
    const e = easeOutCubic(t);
    part.rotation.set(r0.x + (r1.x - r0.x) * e, r0.y + (r1.y - r0.y) * e, r0.z + (r1.z - r0.z) * e);
  });
  // Little hop on landing.
  const rest = part.position.y;
  await ctx.tweens.run(0.28, (t) => {
    part.position.y = rest + Math.sin(Math.PI * t) * height * 0.12;
  });
  part.position.y = rest;
}

/** Rotates an object around one local axis to `angle` with a bouncy landing. */
export function topple(
  ctx: WreckContext,
  part: Object3D,
  axis: 'x' | 'y' | 'z',
  angle: number,
  duration: number,
  delay = 0,
): Promise<void> {
  const start = part.rotation[axis];
  return ctx.tweens.run(
    duration,
    (t) => {
      part.rotation[axis] = start + easeOutBounce(t) * angle;
    },
    { delay },
  );
}

/** Short violent shake before something gives way. */
export function shudder(ctx: WreckContext, part: Object3D, amount: number, duration = 0.2): Promise<void> {
  const base = part.position.clone();
  return ctx.tweens.run(duration, (t) => {
    const k = Math.sin(t * Math.PI * 11) * (1 - t) * amount;
    part.position.set(base.x + k, base.y, base.z - k * 0.6);
  });
}

export function lerpTo(ctx: WreckContext, duration: number, apply: (e: number) => void, delay = 0): Promise<void> {
  return ctx.tweens.run(duration, (t) => apply(easeOutCubic(t)), { delay });
}
