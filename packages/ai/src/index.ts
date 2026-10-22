import { GeneralAbismo } from './bots/abismo.ts';
import { CapitaNeblina } from './bots/neblina.ts';
import { CaboPipoca } from './bots/pipoca.ts';
import { SargentoRotina } from './bots/rotina.ts';
import { MajorXadrez } from './bots/xadrez.ts';
import { BOT_IDS } from './profiles.ts';
import type { Bot, BotId, BotLevel, BotOptions } from './types.ts';

export type * from './types.ts';
export { PROFILES, BOT_IDS } from './profiles.ts';
export { BaseBot } from './bots/base.ts';
export { CaboPipoca, SargentoRotina, CapitaNeblina, MajorXadrez, GeneralAbismo };
export { coach, type CoachAdvice, type CoachOptions } from './coach.ts';
export { playBotTurn, runBotMatch, type BotMatchResult, type BotTurnReport } from './driver.ts';
export { placeSeat, playSeatTurn, runTeamBotMatch, type SeatTurnReport, type TeamBotMatchResult } from './doubles.ts';
export { HeatMap, MemoryStorage, type BotStorage } from './learning.ts';
export { Knowledge, ViewMemory, footprints } from './knowledge.ts';
export { blankPrior, densityMap, sampleLayouts, toProbabilities } from './inference.ts';
export { planLayout, type LayoutStyle } from './layouts.ts';
export { LEADERS, factionMeta, leaderFor, tauntTier, type FactionMeta, type LeaderPersona } from './leaders.ts';
export { lineValue, planSpecial } from './tactics.ts';
export {
  DEFAULT_PARAMS,
  PARAM_BOUNDS,
  TRAINED_PARAMS,
  TRAINED_PARAMS_VERSION,
  resolveParams,
  trainedUse,
  type AbismoParams,
  type BotParams,
  type TrainedParamsFile,
  type TrainedUse,
  type XadrezParams,
} from './params.ts';
export {
  PriorBuilder,
  TRAINED_PRIORS_VERSION,
  priorKey,
  trainedSearchPrior,
  trainedShotPrior,
  type PriorEntry,
  type PriorTallies,
  type PriorsFile,
} from './priors.ts';

const FACTORIES: Readonly<Record<BotId, (options: BotOptions) => Bot>> = {
  pipoca: (o) => new CaboPipoca(o),
  rotina: (o) => new SargentoRotina(o),
  neblina: (o) => new CapitaNeblina(o),
  xadrez: (o) => new MajorXadrez(o),
  abismo: (o) => new GeneralAbismo(o),
};

/** Creates a bot by level (1–5) or id. */
export function createBot(which: BotLevel | BotId, options: BotOptions): Bot {
  const id = typeof which === 'number' ? BOT_IDS[which - 1] : which;
  if (!id || !(id in FACTORIES)) throw new Error(`Unknown bot: ${String(which)}`);
  return FACTORIES[id](options);
}
