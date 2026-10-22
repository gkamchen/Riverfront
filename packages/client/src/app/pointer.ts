import { Vector2 } from 'three';

export interface PointerHandlers {
  /** Pointer position over the canvas (null when it leaves). Client coordinates for tooltips. */
  hover(ndc: Vector2 | null, clientX: number, clientY: number): void;
  tap(ndc: Vector2, clientX: number, clientY: number): void;
  /** Asked on press: would a drag starting here move a game piece instead of the camera? */
  canGrab(ndc: Vector2): boolean;
  grabStart(ndc: Vector2): void;
  grabMove(ndc: Vector2, clientX: number, clientY: number): void;
  grabEnd(ndc: Vector2 | null): void;
  orbit(dxPixels: number, dyPixels: number): void;
  zoom(factor: number): void;
}

const DRAG_THRESHOLD = 6;

/**
 * Pointer gestures on the board: tap, hover, drag a piece (placement), drag
 * the camera and pinch / wheel zoom. Which kind of drag it is gets decided
 * when the pointer first moves past a few pixels.
 */
export function attachPointer(canvas: HTMLCanvasElement, handlers: PointerHandlers): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let travelled = 0;
  let pinch = 0;
  let grabbable = false;
  let mode: 'none' | 'grab' | 'orbit' = 'none';

  const ndc = (event: { clientX: number; clientY: number }): Vector2 => {
    const rect = canvas.getBoundingClientRect();
    return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  };

  const spread = (): number => {
    const [a, b] = [...pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already released pointers cannot be captured; the gesture still works.
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    travelled = 0;
    pinch = spread();
    mode = 'none';
    grabbable = pointers.size === 1 && handlers.canGrab(ndc(event));
    if (event.pointerType !== 'mouse') handlers.hover(ndc(event), event.clientX, event.clientY);
  };

  const onMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) {
      if (event.pointerType === 'mouse') handlers.hover(ndc(event), event.clientX, event.clientY);
      return;
    }
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2) {
      const distance = spread();
      if (pinch > 0 && distance > 0) handlers.zoom(pinch / distance);
      pinch = distance;
      if (mode === 'grab') handlers.grabEnd(null);
      mode = 'orbit';
      travelled = Infinity;
      return;
    }

    travelled += Math.hypot(dx, dy);
    if (mode === 'none' && travelled > DRAG_THRESHOLD) {
      mode = grabbable ? 'grab' : 'orbit';
      if (mode === 'grab') handlers.grabStart(ndc(event));
    }
    if (mode === 'grab') handlers.grabMove(ndc(event), event.clientX, event.clientY);
    else if (mode === 'orbit') {
      handlers.orbit(dx, dy);
      handlers.hover(null, 0, 0);
    } else if (event.pointerType === 'mouse') handlers.hover(ndc(event), event.clientX, event.clientY);
  };

  const onUp = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (mode === 'grab') handlers.grabEnd(ndc(event));
    else if (pointers.size === 0 && mode === 'none' && travelled <= DRAG_THRESHOLD) handlers.tap(ndc(event), event.clientX, event.clientY);
    if (pointers.size === 0) mode = 'none';
    if (event.pointerType === 'mouse') handlers.hover(ndc(event), event.clientX, event.clientY);
  };

  const onCancel = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (mode === 'grab') handlers.grabEnd(null);
    mode = 'none';
    travelled = Infinity;
  };

  const onLeave = () => {
    if (pointers.size === 0) handlers.hover(null, 0, 0);
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    handlers.zoom(Math.exp(event.deltaY * 0.001));
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
