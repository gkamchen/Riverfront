import type { UnitFactoryRegistry } from '../../units/factories';
import { kitAntenna, kitBunker, kitGenerator, kitTower, kitWorkshop } from './buildings';
import { kitRecruit, kitSniper } from './infantry';
import type { KitStyle } from './style';
import { kitAmphibian, kitArmor, kitArtillery } from './vehicles';

export { resolveKit, type KitStyle } from './style';

/** The ten role factories of the generic kit, dressed by one style. */
export function createKitFactories(k: KitStyle): UnitFactoryRegistry {
  return {
    recruit: kitRecruit(k),
    sniper: kitSniper(k),
    armor: kitArmor(k),
    artillery: kitArtillery(k),
    antenna: kitAntenna(k),
    bunker: kitBunker(k),
    amphibian: kitAmphibian(k),
    generator: kitGenerator(k),
    workshop: kitWorkshop(k),
    tower: kitTower(k),
  };
}
