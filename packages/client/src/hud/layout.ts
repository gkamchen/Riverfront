/**
 * Layout maths shared by the HUD grid and the camera. The HUD is a CSS grid
 * with named areas; the cell left free in the middle ("stage") is where the
 * board must be framed, so the camera is offset to that rectangle.
 */

export type LayoutMode = 'wide' | 'tablet' | 'phone-portrait' | 'phone-landscape';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * wide: landscape with room for side columns (desktop, landscape tablets);
 * tablet: portrait from 600 px; phones by orientation.
 */
export function layoutMode(width: number, height: number): LayoutMode {
  if (height > width) return width < 600 ? 'phone-portrait' : 'tablet';
  if (height < 520 || width < 700) return 'phone-landscape';
  return 'wide';
}

/** Short screens show messages as a toast at the top, away from the player's own field. */
export function toastOnTop(mode: LayoutMode, height: number): boolean {
  return mode === 'phone-landscape' || mode === 'phone-portrait' || height < 640;
}

/** Phones zoom the camera towards the field being aimed at. */
export function isPhone(mode: LayoutMode): boolean {
  return mode === 'phone-portrait' || mode === 'phone-landscape';
}

export interface ViewOffset {
  /** Virtual frame the camera frustum maps to (the free rectangle). */
  readonly fullWidth: number;
  readonly fullHeight: number;
  /** Where the canvas sits inside that virtual frame. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Aspect the camera should fit the board to. */
  readonly aspect: number;
}

/** Clamps a rectangle to the canvas. */
export function clampRect(rect: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(width, rect.x));
  const y = Math.max(0, Math.min(height, rect.y));
  const right = Math.max(x, Math.min(width, rect.x + rect.width));
  const bottom = Math.max(y, Math.min(height, rect.y + rect.height));
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Camera view offset that frames the board inside `free` while still drawing
 * the whole canvas (`camera.setViewOffset(fullWidth, fullHeight, x, y, width, height)`).
 * Returns null when the free area is too small to be worth it; the caller then
 * uses the full canvas.
 */
export function viewOffsetFor(width: number, height: number, free: Rect, minShare = 0.35): ViewOffset | null {
  if (width <= 0 || height <= 0) return null;
  const rect = clampRect(free, width, height);
  if (rect.width < width * minShare || rect.height < height * minShare) return null;
  if (rect.width >= width - 1 && rect.height >= height - 1) return null;
  return {
    fullWidth: rect.width,
    fullHeight: rect.height,
    x: -rect.x,
    y: -rect.y,
    width,
    height,
    aspect: rect.width / rect.height,
  };
}

/** Projects a point in normalised device coordinates to canvas pixels. */
export function ndcToPixels(x: number, y: number, width: number, height: number): { x: number; y: number } {
  return { x: ((x + 1) / 2) * width, y: ((1 - y) / 2) * height };
}

/** Minimum touch target in CSS pixels on coarse pointers (WCAG 2.5.5 / platform guidelines). */
export const TOUCH_TARGET = 44;
