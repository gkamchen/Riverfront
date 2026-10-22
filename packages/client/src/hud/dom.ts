import { t, type TextKey } from './i18n';

type Child = Node | string | null | undefined | false;

export interface Attrs {
  readonly class?: string;
  /** Text from the i18n table; kept up to date by `relabel()`. */
  readonly i18n?: TextKey;
  readonly i18nAria?: TextKey;
  readonly i18nTitle?: TextKey;
  readonly [name: string]: string | number | boolean | undefined | ((event: Event) => void);
}

/** Small element factory: `h('button', { class: 'chip', i18n: 'menu.play', onclick }, child...)`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'i18n') {
      node.dataset.i18n = String(value);
      node.textContent = t(value as TextKey);
    } else if (key === 'i18nAria') {
      node.dataset.i18nAria = String(value);
      node.setAttribute('aria-label', t(value as TextKey));
    } else if (key === 'i18nTitle') {
      node.dataset.i18nTitle = String(value);
      node.title = t(value as TextKey);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2), value as EventListener);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** Element with static markup (icons). */
export function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, markup: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = markup;
  return node;
}

/** Re-applies every i18n attribute under `root` after a language change. */
export function relabel(root: ParentNode): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n as TextKey);
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) node.setAttribute('aria-label', t(node.dataset.i18nAria as TextKey));
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle as TextKey);
}

/** Sets text only when it changed (avoids layout work every frame). */
export function setText(node: Element, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Restarts a CSS animation class. */
export function replay(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.offsetParent !== null);
}

/**
 * Keeps Tab inside `root` while it is open. Returns a function that removes
 * the trap and gives focus back to whatever had it before.
 */
export function trapFocus(root: HTMLElement): () => void {
  const previous = document.activeElement as HTMLElement | null;
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const items = focusables(root);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => {
    root.removeEventListener('keydown', onKey);
    if (previous && document.contains(previous)) previous.focus();
  };
}
