import { Color } from 'three';

export type PaletteId = 'classic' | 'emerald' | 'night';

export interface Palette {
  readonly id: PaletteId;
  /** Multipliers applied to the marble cap texture in a checker pattern. */
  readonly capLight: Color;
  readonly capDark: Color;
  readonly frameTint: Color;
}

export const PALETTES: readonly Palette[] = [
  {
    id: 'classic',
    capLight: new Color('#e4dccf'),
    capDark: new Color('#4a4650'),
    frameTint: new Color('#ffffff'),
  },
  {
    id: 'emerald',
    capLight: new Color('#f4f0e2'),
    capDark: new Color('#2c6a54'),
    frameTint: new Color('#e9dccb'),
  },
  {
    id: 'night',
    capLight: new Color('#aab6d4'),
    capDark: new Color('#252c40'),
    frameTint: new Color('#9c8f9e'),
  },
];

export interface TeamColors {
  readonly main: Color;
  readonly dark: Color;
  readonly glow: Color;
}

export type TeamPaletteMode = 'standard' | 'colorblind';

const TEAM_SOURCES: Record<TeamPaletteMode, Record<'blue' | 'red', [string, string, string]>> = {
  standard: {
    blue: ['#2f6fe0', '#1b3f8f', '#6fa8ff'],
    red: ['#d23a2e', '#7f1c16', '#ff7a5c'],
  },
  // Okabe-Ito blue vs orange: distinct for protanopia, deuteranopia and tritanopia.
  colorblind: {
    blue: ['#0072b2', '#003f63', '#56b4e9'],
    red: ['#e69f00', '#8a5a00', '#ffc84a'],
  },
};

/**
 * Team colours. The Color instances are shared by unit materials and flags, so
 * switching the palette mode updates every piece in place.
 */
export const TEAM_COLORS: Readonly<Record<'blue' | 'red', TeamColors>> = {
  blue: { main: new Color('#2f6fe0'), dark: new Color('#1b3f8f'), glow: new Color('#6fa8ff') },
  red: { main: new Color('#d23a2e'), dark: new Color('#7f1c16'), glow: new Color('#ff7a5c') },
};

let teamMode: TeamPaletteMode = 'standard';

export function teamPaletteMode(): TeamPaletteMode {
  return teamMode;
}

export function setTeamPaletteMode(mode: TeamPaletteMode): void {
  teamMode = mode;
  for (const team of ['blue', 'red'] as const) {
    const [main, dark, glow] = TEAM_SOURCES[mode][team];
    TEAM_COLORS[team].main.set(main);
    TEAM_COLORS[team].dark.set(dark);
    TEAM_COLORS[team].glow.set(glow);
  }
}
