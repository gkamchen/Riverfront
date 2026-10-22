/**
 * The bots and the coach are only needed once a local match (or the bot
 * setup screen) opens, so they live in their own chunk.
 */
export type AiModule = typeof import('@riverfront/ai');

let ai: AiModule | null = null;
let loading: Promise<AiModule> | null = null;

export function loadAi(): Promise<AiModule> {
  loading ??= import('@riverfront/ai').then((m) => (ai = m));
  return loading;
}

/** The module if it already arrived (null otherwise). */
export function aiModule(): AiModule | null {
  return ai;
}
