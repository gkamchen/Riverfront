import './hud/hud.css';
import { App } from './app/app';
import { loadSettings } from './app/settings';
import { setLocale, t } from './hud/i18n';

function hasWebGL2(): boolean {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

function boot(): void {
  const host = document.getElementById('app');
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const loader = document.getElementById('loader');
  if (!host || !canvas) return;

  setLocale(loadSettings().locale);
  canvas.setAttribute('aria-label', t('a11y.board'));
  const loaderText = loader?.querySelector('[data-loader-text]');
  if (loaderText) loaderText.textContent = t('loader.text');

  if (!hasWebGL2()) {
    if (loaderText) loaderText.textContent = t('webgl.missing');
    return;
  }

  // Let the loader paint before the procedural textures are built. Background
  // tabs may not paint at all, so a timer starts the game anyway.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    const app = new App(host, canvas);
    app.start();
    if (import.meta.env.DEV) Object.assign(window, { riverfront: app.debug });
    loader?.classList.add('done');
    setTimeout(() => loader?.remove(), 800);
  };
  requestAnimationFrame(() => setTimeout(start, 30));
  setTimeout(start, 600);
}

boot();
