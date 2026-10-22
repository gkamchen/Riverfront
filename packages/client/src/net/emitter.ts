/** Emissor de eventos tipado e pequeno. `on` devolve a função que remove o ouvinte. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  readonly #listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(type: K, listener: (payload: Events[K]) => void): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener as (payload: never) => void);
    return () => set.delete(listener as (payload: never) => void);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.#listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (payload: Events[K]) => void)(payload);
      } catch (error) {
        console.error(`[online] erro num ouvinte de "${String(type)}"`, error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
