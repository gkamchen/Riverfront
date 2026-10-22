import { h } from './dom';
import { t, type TextKey } from './i18n';

export type TipId = 'place' | 'aim' | 'powers';

const TEXT: Readonly<Record<TipId, TextKey>> = { place: 'tip.place', aim: 'tip.aim', powers: 'tip.powers' };

/**
 * First-run hints: three short callouts, each shown once, at the moment they
 * matter (placing, first shot, first time energy is enough for a power).
 */
export class Tips {
  readonly #host: HTMLElement;
  readonly #seen: Set<string>;
  readonly #save: (seen: string[]) => void;
  #current: HTMLElement | null = null;

  constructor(host: HTMLElement, seen: readonly string[], save: (seen: string[]) => void) {
    this.#host = host;
    this.#seen = new Set(seen);
    this.#save = save;
  }

  /** Shows a tip if it was never dismissed. `area` positions it next to that HUD area. */
  show(id: TipId, area: 'bottom' | 'actions' | 'stage'): void {
    if (this.#seen.has(id) || this.#current) return;
    const close = h('button', { type: 'button', class: 'secondary small', i18n: 'tip.ok', onclick: () => this.dismiss(id) });
    const node = h(
      'div',
      { class: `tip tip-${area}`, role: 'note' },
      h('strong', { i18n: 'tip.title' }),
      h('p', {}, t(TEXT[id])),
      close,
    );
    this.#current = node;
    this.#host.append(node);
  }

  dismiss(id?: TipId): void {
    if (!this.#current) return;
    this.#current.remove();
    this.#current = null;
    if (id) {
      this.#seen.add(id);
      this.#save([...this.#seen]);
    }
  }

  reset(): void {
    this.#seen.clear();
    this.#save([]);
  }
}
