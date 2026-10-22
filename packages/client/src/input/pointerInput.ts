import { Vector2 } from 'three';

export interface PointerCallbacks {
  /** Normalised device coordinates under the pointer, or null when it leaves. */
  hover(ndc: Vector2 | null): void;
  tap(ndc: Vector2): void;
  orbit(dxPixels: number, dyPixels: number): void;
  zoom(factor: number): void;
}

const DRAG_THRESHOLD = 6;

/**
 * Turns raw pointer events into tap / hover / orbit / zoom. A press that
 * moves less than a few pixels is a tap; anything more drags the camera.
 * Two fingers pinch to zoom.
 */
export function attachPointerInput(canvas: HTMLCanvasElement, callbacks: PointerCallbacks): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragDistance = 0;
  let pinchDistance = 0;

  const toNdc = (event: PointerEvent | MouseEvent): Vector2 => {
    const rect = canvas.getBoundingClientRect();
    return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  };

  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragDistance = 0;
    pinchDistance = spread();
  };

  const onMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse') callbacks.hover(toNdc(event));
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const distance = spread();
      if (pinchDistance > 0 && distance > 0) callbacks.zoom(pinchDistance / distance);
      pinchDistance = distance;
      dragDistance = Infinity;
      return;
    }

    dragDistance += Math.hypot(dx, dy);
    if (dragDistance > DRAG_THRESHOLD) {
      callbacks.orbit(dx, dy);
      callbacks.hover(null);
    } else if (event.pointerType === 'mouse') {
      callbacks.hover(toNdc(event));
    }
  };

  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (pointers.size === 0 && dragDistance <= DRAG_THRESHOLD && event.button === 0) {
      callbacks.tap(toNdc(event));
    }
    if (event.pointerType === 'mouse') callbacks.hover(toNdc(event));
  };

  const onCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    dragDistance = Infinity;
  };

  const onLeave = () => {
    if (pointers.size === 0) callbacks.hover(null);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    callbacks.zoom(Math.exp(event.deltaY * 0.001));
  };

  const onContextMenu = (event: Event) => event.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);

  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
    canvas.removeEventListener('pointerleave', onLeave);
    canvas.removeEventListener('wheel', onWheel);
    canvas.removeEventListener('contextmenu', onContextMenu);
  };
}
