import { ABILITY_IDS, type AbilityId } from './abilities.ts';
import { ROLES, isRoleId, type RoleId } from './roles.ts';
import type { Coord } from './types.ts';

export interface UnitSpec {
  readonly role: RoleId;
  readonly count: number;
  /** Overrides the role's default shape. */
  readonly shape?: readonly Coord[];
}

export interface FieldConfig {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  /** Rock cells per field; every other free cell is earth. */
  readonly rocks: number;
  readonly units: readonly UnitSpec[];
  /** Abilities available in this mode (empty = no energy at all). */
  readonly abilities: readonly AbilityId[];
  /** Energy scale of this mode; missing fields use `ENERGY`. */
  readonly energy?: Partial<EnergyRule>;
}

export interface EnergyRule {
  readonly start: number;
  readonly perTurn: number;
  readonly perKill: number;
  readonly max: number;
}

/**
 * 'classic'/'full' are the original ids; 'classico' and 'completo' are the
 * same configs under their pt-BR names. 'rapido' and 'rapido-poderes' are short
 * matches on a 15×5 field.
 */
export type PresetId = 'classic' | 'full' | 'classico' | 'completo' | 'rapido' | 'rapido-poderes';

export const CLASSIC_CONFIG: FieldConfig = {
  name: 'classic',
  cols: 25,
  rows: 7,
  rocks: 45,
  units: [
    { role: 'recruit', count: 6 },
    { role: 'armor', count: 3 },
    { role: 'artillery', count: 2 },
    { role: 'bunker', count: 1 },
  ],
  abilities: [],
};

export const FULL_CONFIG: FieldConfig = {
  name: 'full',
  cols: 25,
  rows: 7,
  rocks: 45,
  units: [
    { role: 'recruit', count: 4 },
    { role: 'sniper', count: 1 },
    { role: 'armor', count: 2 },
    { role: 'artillery', count: 1 },
    { role: 'antenna', count: 1 },
    { role: 'bunker', count: 1 },
    { role: 'amphibian', count: 1 },
    { role: 'generator', count: 1 },
    { role: 'workshop', count: 1 },
  ],
  abilities: ['radar', 'bomb', 'shield', 'repair', 'spy'],
};

/** Quick match without powers: 15×5, 6 pieces over 10 cells. */
export const RAPID_CONFIG: FieldConfig = {
  name: 'rapido',
  cols: 15,
  rows: 5,
  rocks: 16,
  units: [
    { role: 'recruit', count: 3 },
    { role: 'armor', count: 2 },
    { role: 'artillery', count: 1 },
  ],
  abilities: [],
};

/** Quick match with radar and bomb only, on a smaller energy scale. */
export const RAPID_POWERS_CONFIG: FieldConfig = {
  name: 'rapido-poderes',
  cols: 15,
  rows: 5,
  rocks: 16,
  units: [
    { role: 'recruit', count: 2 },
    { role: 'armor', count: 1 },
    { role: 'artillery', count: 1 },
    { role: 'antenna', count: 1 },
  ],
  abilities: ['radar', 'bomb'],
  energy: { start: 2, perTurn: 1, perKill: 2, max: 6 },
};

export const PRESETS: Readonly<Record<PresetId, FieldConfig>> = {
  classic: CLASSIC_CONFIG,
  full: FULL_CONFIG,
  classico: CLASSIC_CONFIG,
  completo: FULL_CONFIG,
  rapido: RAPID_CONFIG,
  'rapido-poderes': RAPID_POWERS_CONFIG,
};

/** One entry per distinct mode, for menus (pt-BR). */
export interface PresetInfo {
  readonly id: PresetId;
  readonly name: string;
  readonly powers: boolean;
  readonly description: string;
}

export const GAME_PRESETS: readonly PresetInfo[] = [
  { id: 'classic', name: 'Clássico', powers: false, description: 'Campo 25×7, 12 peças (22 células), sem energia nem poderes.' },
  { id: 'full', name: 'Completo', powers: true, description: 'Campo 25×7, 13 peças (24 células), energia, 5 habilidades e facções.' },
  { id: 'rapido', name: 'Rápido', powers: false, description: 'Campo 15×5, 6 peças (10 células), sem poderes. Partidas curtas.' },
  { id: 'rapido-poderes', name: 'Rápido com poderes', powers: true, description: 'Campo 15×5, 5 peças (10 células), radar e bombardeio, energia até 6.' },
];

export function resolveConfig(config: FieldConfig | PresetId | undefined): FieldConfig {
  if (config === undefined) return FULL_CONFIG;
  if (typeof config === 'string') {
    const preset = PRESETS[config];
    if (!preset) throw new Error(`Unknown preset: ${String(config)}`);
    return preset;
  }
  return config;
}

/**
 * A preset on another field size. Rocks scale with the area (unless given);
 * the name records the size so bots keep separate habits per field.
 * `new Match` still checks that the army fits (it throws otherwise).
 */
export function sizedConfig(base: FieldConfig | PresetId, cols: number, rows: number, options: { rocks?: number } = {}): FieldConfig {
  const config = resolveConfig(base);
  if (cols === config.cols && rows === config.rows && options.rocks === undefined) return config;
  const rocks = options.rocks ?? Math.round((config.rocks * cols * rows) / (config.cols * config.rows));
  const sized: FieldConfig = { ...config, name: `${config.name}-${cols}x${rows}`, cols, rows, rocks };
  validateConfig(sized);
  return sized;
}

export function shapeOf(spec: UnitSpec): readonly Coord[] {
  return spec.shape ?? ROLES[spec.role].shape;
}

export function unitCellCount(config: FieldConfig): number {
  return config.units.reduce((sum, spec) => sum + spec.count * shapeOf(spec).length, 0);
}

export function pieceCount(config: FieldConfig): number {
  return config.units.reduce((sum, spec) => sum + spec.count, 0);
}

/** Throws on configurations that can never produce a legal field. */
export function validateConfig(config: FieldConfig): void {
  if (!Number.isInteger(config.cols) || !Number.isInteger(config.rows) || config.cols < 3 || config.rows < 3) {
    throw new Error('Field must be at least 3×3');
  }
  const size = config.cols * config.rows;
  const units = unitCellCount(config);
  if (units === 0) throw new Error('Field config has no units');
  if (config.rocks < 0 || units + config.rocks > size) {
    throw new Error(`Field config needs ${units + config.rocks} cells but the field has ${size}`);
  }
  for (const spec of config.units) {
    if (!isRoleId(spec.role)) throw new Error(`Unknown role: ${String(spec.role)}`);
    if (!Number.isInteger(spec.count) || spec.count < 0) throw new Error(`Bad count for ${spec.role}`);
    if (shapeOf(spec).length === 0) throw new Error(`Empty shape for ${spec.role}`);
  }
  for (const ability of config.abilities) {
    if (!ABILITY_IDS.includes(ability)) throw new Error(`Unknown ability: ${String(ability)}`);
  }
  for (const [key, value] of Object.entries(config.energy ?? {})) {
    if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`Bad energy ${key}`);
  }
}
