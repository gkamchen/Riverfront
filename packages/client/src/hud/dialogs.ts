import { h, trapFocus } from './dom';
import { icon } from './icons';
import { t, type TextKey } from './i18n';

export interface ModalHandle {
  readonly root: HTMLDialogElement;
  readonly body: HTMLElement;
  close(): void;
}

let openCount = 0;

/** True while any modal dialog is open (global shortcuts stay quiet). */
export function modalOpen(): boolean {
  return openCount > 0;
}

export interface ModalOptions {
  readonly title: string;
  readonly className?: string;
  /** Escape and the close button call this (default: close). */
  readonly onDismiss?: () => void;
  readonly onClose?: () => void;
  /** Hide the close button (the dialog has its own way out). */
  readonly noClose?: boolean;
}

/**
 * Accessible modal: native <dialog> (inert background), aria-modal, a focus
 * trap as a safety net and Escape handling.
 */
export function openModal(host: HTMLElement, content: Node, options: ModalOptions): ModalHandle {
  const titleId = `dlg-${Math.random().toString(36).slice(2, 8)}`;
  const body = h('div', { class: 'dialog-body' }, content);
  const closeButton = options.noClose
    ? null
    : h('button', { type: 'button', class: 'icon-btn dialog-close', i18nTitle: 'dialog.close', onclick: () => dismiss() });
  if (closeButton) {
    closeButton.innerHTML = icon('close');
    closeButton.append(h('span', { class: 'sr-only', i18n: 'dialog.close' }));
  }
  const root = h(
    'dialog',
    { class: `panel-dialog ${options.className ?? ''}`, 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('header', {}, h('h2', { id: titleId }, options.title), closeButton),
    body,
  );
  host.append(root);
  openCount++;
  let closed = false;
  const release = trapFocus(root);
  const close = () => {
    if (closed) return;
    closed = true;
    openCount = Math.max(0, openCount - 1);
    release();
    if (root.open) root.close();
    root.remove();
    options.onClose?.();
  };
  const dismiss = () => (options.onDismiss ? options.onDismiss() : close());
  root.addEventListener('cancel', (event) => {
    event.preventDefault();
    dismiss();
  });
  root.addEventListener('click', (event) => {
    if (event.target === root && !options.noClose) dismiss();
  });
  root.showModal();
  const first = root.querySelector<HTMLElement>('[autofocus]') ?? body.querySelector<HTMLElement>('button, [href], input, select');
  first?.focus();
  return { root, body, close };
}

/** Yes/no question. With `hold`, the confirm button must be held for a second (no misclicks). */
export function confirmDialog(
  host: HTMLElement,
  title: string,
  text: string,
  confirmLabel: TextKey,
  options: { danger?: boolean; hold?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const answer = (value: boolean) => {
      if (answered) return;
      answered = true;
      handle.close();
      resolve(value);
    };
    const confirm = options.hold
      ? holdButton(confirmLabel, () => answer(true), options.danger)
      : h('button', { type: 'button', class: options.danger ? 'primary danger' : 'primary', i18n: confirmLabel, onclick: () => answer(true) });
    const cancel = h('button', { type: 'button', class: 'secondary', i18n: 'dialog.cancel', autofocus: true, onclick: () => answer(false) });
    const content = h('div', { class: 'confirm' }, h('p', {}, text), h('div', { class: 'dialog-actions' }, cancel, confirm));
    const handle = openModal(host, content, { title, onClose: () => answer(false) });
  });
}

/**
 * Button that fires only after being held for `ms` (pointer or Space/Enter).
 * The fill shows progress; releasing early cancels.
 */
export function holdButton(label: TextKey, action: () => void, danger = false, ms = 1000): HTMLButtonElement {
  const button = h('button', { type: 'button', class: `primary hold${danger ? ' danger' : ''}` });
  button.append(h('span', { class: 'hold-fill', 'aria-hidden': 'true' }), h('span', { class: 'hold-label', i18n: label }), h('span', { class: 'sr-only', i18n: 'dialog.holdHint' }));
  let timer = 0;
  let start = 0;
  let frame = 0;
  const fill = button.querySelector<HTMLElement>('.hold-fill')!;
  const stop = () => {
    window.clearTimeout(timer);
    cancelAnimationFrame(frame);
    fill.style.transform = 'scaleX(0)';
    start = 0;
  };
  const tick = () => {
    if (!start) return;
    fill.style.transform = `scaleX(${Math.min(1, (performance.now() - start) / ms)})`;
    frame = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (start) return;
    start = performance.now();
    tick();
    timer = window.setTimeout(() => {
      stop();
      action();
    }, ms);
  };
  button.addEventListener('pointerdown', begin);
  button.addEventListener('pointerup', stop);
  button.addEventListener('pointerleave', stop);
  button.addEventListener('pointercancel', stop);
  button.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      begin();
    }
  });
  button.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') stop();
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
  return button;
}

export interface PopoverHandle {
  readonly root: HTMLElement;
  close(): void;
}

let activePopover: PopoverHandle | null = null;

/**
 * Small panel anchored to a button (settings gear, emoji wheel). Closes on
 * Escape, outside clicks and when another popover opens.
 */
export function openPopover(anchor: HTMLElement, content: Node, labelKey: TextKey, className = ''): PopoverHandle {
  activePopover?.close();
  const root = h('div', { class: `popover panel ${className}`, role: 'dialog', 'aria-modal': 'false', i18nAria: labelKey }, content);
  document.body.append(root);
  const place = () => {
    const a = anchor.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const margin = 8;
    let left = Math.min(window.innerWidth - r.width - margin, Math.max(margin, a.left));
    let top = a.bottom + 6;
    if (top + r.height > window.innerHeight - margin) top = Math.max(margin, a.top - r.height - 6);
    if (left < margin) left = margin;
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };
  place();
  anchor.setAttribute('aria-expanded', 'true');
  const release = trapFocus(root);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      handle.close();
    }
  };
  const onDown = (event: PointerEvent) => {
    if (!root.contains(event.target as Node) && !anchor.contains(event.target as Node)) handle.close();
  };
  root.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', place);
  let closed = false;
  const handle: PopoverHandle = {
    root,
    close: () => {
      if (closed) return;
      closed = true;
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', place);
      anchor.setAttribute('aria-expanded', 'false');
      root.remove();
      release();
      if (activePopover === handle) activePopover = null;
    },
  };
  activePopover = handle;
  (root.querySelector<HTMLElement>('button, input, select') ?? root).focus();
  return handle;
}

export function closePopover(): boolean {
  if (!activePopover) return false;
  activePopover.close();
  return true;
}

export function popoverOpen(): boolean {
  return activePopover !== null;
}

/** Shared "title + text" label helper for dialogs built from i18n keys. */
export function titled(key: TextKey): string {
  return t(key);
}
