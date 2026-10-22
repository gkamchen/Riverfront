import type { FactionId } from '@riverfront/core';
import type { Locale } from '../hud/i18n';
import type { MatchSetup } from './modes';

export type QualitySetting = 'auto' | 'high' | 'low';
export type MotionSetting = 'system' | 'reduced' | 'full';
export type CoordinateSetting = 'engraved' | 'overlay' | 'off';

export interface Settings {
  locale: Locale;
  theme: string;
  quality: QualitySetting;
  /** Tier the automatic probe settled on (kept so the next visit starts there). */
  autoTier: 'high' | 'low' | null;
  muted: boolean;
  volume: number;
  colorblind: boolean;
  coordinates: CoordinateSetting;
  /** 1/2/3, H, M... without modifiers. Off for players who use speech input or switch devices. */
  singleKeyShortcuts: boolean;
  motion: MotionSetting;
  /** Coarse pointers: tap a cell, then confirm with the big "Disparar" button. */
  confirmShots: 'auto' | 'always' | 'never';
  /** Offline profile (online uses the server profile and its tag). */
  nickname: string;
  colour: string;
  faction: FactionId;
  helpSeen: boolean;
  tipsSeen: string[];
  lastSetup: Partial<MatchSetup> | null;
  heatMap: boolean;
}

export const SETTINGS_KEY = 'riverfront.settings';

export const DEFAULT_SETTINGS: Settings = {
  locale: 'pt',
  theme: 'vale',
  quality: 'auto',
  autoTier: null,
  muted: false,
  volume: 0.8,
  colorblind: false,
  coordinates: 'engraved',
  singleKeyShortcuts: true,
  motion: 'system',
  confirmShots: 'auto',
  nickname: '',
  colour: 'azul',
  faction: 'neutra',
  helpSeen: false,
  tipsSeen: [],
  lastSetup: null,
  heatMap: true,
};

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Reads the saved settings, keeping only known keys with the right type. */
export function loadSettings(store: StorageLike | null = storage()): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, tipsSeen: [] };
  let raw: unknown = null;
  try {
    const text = store?.getItem(SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  if (!raw || typeof raw !== 'object') {
    out.locale = guessLocale();
    return out;
  }
  const saved = raw as Record<string, unknown>;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value = saved[key];
    const fallback = DEFAULT_SETTINGS[key];
    if (value === undefined) continue;
    if (fallback === null || typeof value === typeof fallback || (Array.isArray(fallback) && Array.isArray(value))) target[key] = value;
  }
  if (out.locale !== 'pt' && out.locale !== 'en') out.locale = 'pt';
  return out;
}

export function saveSettings(settings: Settings, store: StorageLike | null = storage()): void {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or full storage: settings just won't persist.
  }
}

function guessLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'pt-BR';
  return /^pt/i.test(lang) ? 'pt' : /^en/i.test(lang) ? 'en' : 'pt';
}
