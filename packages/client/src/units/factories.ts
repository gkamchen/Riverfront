import { createRecruit, createSniper } from './models/infantry';
import { createAntenna, createBunker, createGenerator, createTower, createWorkshop } from './models/structures';
import { createAmphibian, createArmor, createArtillery } from './models/vehicles';
import type { TeamId, UnitRole } from './roles';
import type { UnitFactoryOptions, UnitModel } from './unitModel';

export type UnitFactory = (options: UnitFactoryOptions) => UnitModel;

/** One factory per role. Skins swap the whole record (or a few entries). */
export type UnitFactoryRegistry = Readonly<Record<UnitRole, UnitFactory>>;

export const DEFAULT_UNIT_FACTORIES: UnitFactoryRegistry = {
  recruit: createRecruit,
  sniper: createSniper,
  armor: createArmor,
  artillery: createArtillery,
  antenna: createAntenna,
  bunker: createBunker,
  amphibian: createAmphibian,
  generator: createGenerator,
  workshop: createWorkshop,
  tower: createTower,
};

let active: UnitFactoryRegistry = DEFAULT_UNIT_FACTORIES;
const teamOverrides: Partial<Record<TeamId, UnitFactoryRegistry>> = {};

/** Registry used for pieces created from now on (a team's faction wins over the theme). */
export function activeUnitFactories(team?: TeamId): UnitFactoryRegistry {
  return (team && teamOverrides[team]) || active;
}

/** Dresses one team's army (factions); null goes back to the theme's skin. */
export function setTeamUnitFactories(team: TeamId, registry: UnitFactoryRegistry | null): void {
  if (registry) teamOverrides[team] = registry;
  else delete teamOverrides[team];
}

export function setActiveUnitFactories(registry: Partial<Record<UnitRole, UnitFactory>>): void {
  active = { ...DEFAULT_UNIT_FACTORIES, ...registry };
}
