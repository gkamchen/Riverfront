import trainedFile from '../trained/params.json' with { type: 'json' };

/**
 * Tunable numbers of the two strongest bots. The defaults are the hand-made
 * values; `npm run train` searches better ones by self-play and saves them in
 * `trained/params.json`, which the bots load unless told otherwise.
 */
export interface XadrezParams {
  /** Weight per known hit a footprint covers (target mode). */
  readonly hitWeight: number;
  /** Least expected hits for a bomb. */
  readonly bombMin: number;
  /** Energy kept after a repair. */
  readonly repairSpare: number;
  /** Energy needed before spending on radar / spy. */
  readonly radarEnergy: number;
  readonly spyEnergy: number;
  /** Layout: how hard to avoid where hunters look, and to keep pieces apart. */
  readonly avoidPower: number;
  readonly touchPenalty: number;
  /** Pseudo-games of the trained prior mixed with what it learns from one opponent. */
  readonly priorStrength: number;
}

export interface AbismoParams {
  readonly shieldValue: number;
  readonly spyValue: number;
  readonly bombBonus: number;
  readonly radarFactor: number;
  readonly repairValue: number;
  readonly repairEnergy: number;
  /** Least value for spending energy at all. */
  readonly minValue: number;
  /** Value kept when an ability would starve the next bomb. */
  readonly starveFactor: number;
  readonly avoidPower: number;
  readonly priorStrength: number;
  /** Factor on rear-row cells while an enemy tower stands (1 = off). */
  readonly towerBias: number;
}

export interface BotParams {
  readonly xadrez: XadrezParams;
  readonly abismo: AbismoParams;
}

export const DEFAULT_PARAMS: BotParams = {
  xadrez: { hitWeight: 40, bombMin: 0.45, repairSpare: 3, radarEnergy: 7, spyEnergy: 6, avoidPower: 3, touchPenalty: 0.4, priorStrength: 4 },
  abismo: {
    shieldValue: 1.5,
    spyValue: 1.2,
    bombBonus: 0.2,
    radarFactor: 0.45,
    repairValue: 0.43,
    repairEnergy: 7,
    minValue: 0.42,
    starveFactor: 0.4,
    avoidPower: 2,
    priorStrength: 4,
    towerBias: 1.25,
  },
};

/** Allowed range of every parameter (the search never leaves it). */
export const PARAM_BOUNDS: { readonly [B in keyof BotParams]: { readonly [K in keyof BotParams[B]]: readonly [number, number] } } = {
  xadrez: {
    hitWeight: [5, 200],
    bombMin: [0.1, 1.5],
    repairSpare: [0, 6],
    radarEnergy: [2, 9],
    spyEnergy: [2, 9],
    avoidPower: [0, 6],
    touchPenalty: [0, 0.9],
    priorStrength: [0.5, 20],
  },
  abismo: {
    shieldValue: [0.2, 4],
    spyValue: [0.2, 4],
    bombBonus: [-0.5, 1.5],
    radarFactor: [0.05, 2],
    repairValue: [0.05, 2],
    repairEnergy: [2, 9],
    minValue: [0.1, 1.5],
    starveFactor: [0.05, 1],
    avoidPower: [0, 6],
    priorStrength: [0.5, 20],
    towerBias: [1, 2],
  },
};

/** Which trained parts a level plays with (only what proved better in the final comparison). */
export interface TrainedUse {
  readonly params: boolean;
  readonly priors: boolean;
}

export interface TrainedParamsFile {
  readonly version: number;
  readonly params?: Partial<{ readonly [B in keyof BotParams]: Partial<BotParams[B]> }>;
  readonly use?: Readonly<Partial<Record<string, TrainedUse>>>;
}

/** Trained parts a bot level uses by default; untrained files use nothing. */
export function trainedUse(level: number): TrainedUse {
  const file = trainedFile as TrainedParamsFile;
  return file.use?.[String(level)] ?? { params: false, priors: false };
}

function merge(base: BotParams, extra: TrainedParamsFile['params'] | undefined): BotParams {
  return {
    xadrez: { ...base.xadrez, ...extra?.xadrez },
    abismo: { ...base.abismo, ...extra?.abismo },
  };
}

/** Parameters the bots use by default: the trained ones when the file has any. */
export const TRAINED_PARAMS: BotParams = merge(DEFAULT_PARAMS, (trainedFile as TrainedParamsFile).params);
export const TRAINED_PARAMS_VERSION: number = (trainedFile as TrainedParamsFile).version ?? 0;

/** Resolves what a bot plays with: explicit overrides over trained (or default) values. */
export function resolveParams(trained: boolean, overrides?: TrainedParamsFile['params']): BotParams {
  return merge(trained ? TRAINED_PARAMS : DEFAULT_PARAMS, overrides);
}
