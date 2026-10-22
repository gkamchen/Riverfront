import type { SoundBoard } from '../audio/sfx';
import type { Board } from '../board/board';
import { THEMES, type ThemeDef, type ThemeId } from '../materials/themes';
import { setTeamPaletteMode, type TeamPaletteMode } from '../materials/palettes';
import { setActiveUnitFactories, setTeamUnitFactories } from '../units/factories';
import type { Stage } from './stage';

export interface ThemeTargets {
  stage: Stage;
  board: Board;
  sound?: SoundBoard;
}

/**
 * Switches the whole look at runtime: lights and sky, terrain textures, the
 * river (water, lava or ice), the wildlife cast, unit skin and sound preset.
 * Nothing reloads; replaced GPU resources are disposed by their owners.
 */
export class ThemeDirector {
  readonly #targets: ThemeTargets;
  #theme: ThemeDef = THEMES.vale;
  #dusk = 0;

  constructor(targets: ThemeTargets) {
    this.#targets = targets;
  }

  get theme(): ThemeDef {
    return this.#theme;
  }

  /** Built-in theme; also drops any faction skins set per team. */
  setTheme(id: ThemeId): void {
    setTeamUnitFactories('blue', null);
    setTeamUnitFactories('red', null);
    this.applyTheme(THEMES[id]);
  }

  /** Any theme definition, e.g. one derived from a faction (see factions/registry). */
  applyTheme(theme: ThemeDef): void {
    this.#theme = theme;
    const { stage, board, sound } = this.#targets;
    setActiveUnitFactories(theme.unitFactories);
    stage.applyTheme(theme.palette);
    stage.sky.setAurora(theme.sky.aurora);
    board.applyTheme(theme);
    sound?.setPreset(theme.sfxPreset);
    this.setDusk(theme.dusk);
  }

  get dusk(): number {
    return this.#dusk;
  }

  /** 0 = day, 1 = evening (fireflies, warmer light). Themes reset it to their default. */
  setDusk(amount: number): void {
    this.#dusk = amount;
    this.#targets.stage.setDusk(amount);
    this.#targets.board.wildlife.setDusk(amount);
  }

  /** Blue/orange team colours that stay distinct for colour-blind players. */
  setTeamPalette(mode: TeamPaletteMode): void {
    setTeamPaletteMode(mode);
  }
}
