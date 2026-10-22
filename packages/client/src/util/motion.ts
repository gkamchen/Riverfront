const query = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

export function prefersReducedMotion(): boolean {
  return query?.matches ?? false;
}

export function onReducedMotionChange(listener: (reduced: boolean) => void): void {
  query?.addEventListener('change', (event) => listener(event.matches));
}
