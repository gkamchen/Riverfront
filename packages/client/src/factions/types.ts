import type { SfxPreset } from '../audio/presets';
import type { BankPropKind } from '../board/bankProps';
import type { WaterParams } from '../board/water';
import type { AmbientSpecies } from '../board/wildlife/shared';
import type { ThemeId, ThemePalette } from '../materials/themes';
import type { UnitFactory } from '../units/factories';
import type { UnitRole } from '../units/roles';
import type { KitStyle } from './kit/style';
import type { PortraitParams } from './portrait';

export type FactionId = string;

/** 'pronta': art finished (signature pieces, river, leader, sound); 'planejada': data only, generic kit. */
export type FactionStatus = 'pronta' | 'planejada';

export type Archetype = 'informacao' | 'defesa' | 'ataque' | 'tempo' | 'energia';

/** Which team colour slot a kit surface takes ('none' keeps the faction colour). */
export type TeamSlot = 'main' | 'dark' | 'glow' | 'none';

/**
 * How the two team colours (blue/red, or the colour-blind pair) enter the
 * faction's pieces. Team colour must always be readable at a glance, so at
 * least `cloth` or `shield` should take a team slot.
 */
export interface TeamTintRules {
  /** Tunics, sails, banners. */
  cloth: TeamSlot;
  /** Shields, chariot boxes, painted hulls. */
  shield: TeamSlot;
  /** Roof tiles and capstones. */
  roof: TeamSlot;
  /** Thin trims, plumes and crests. */
  trim: TeamSlot;
}

export interface FactionPalette {
  primary: string;
  secondary: string;
  accent: string;
  /** Building stone, wood, metal, undyed cloth and skin of the figures. */
  stone: string;
  wood: string;
  metal: string;
  cloth: string;
  skin: string;
  team: TeamTintRules;
}

export type RoofStyle = 'flat' | 'gable' | 'pyramid' | 'dome' | 'stepped' | 'pagoda' | 'tent' | 'conical';
export type ColumnStyle = 'papyrus' | 'doric' | 'ionic' | 'corinthian' | 'square' | 'wooden' | 'none';
export type OrnamentStyle = 'lotus' | 'meander' | 'laurel' | 'knot' | 'cloud' | 'zigzag' | 'scroll' | 'sun' | 'none';
export type BannerShape = 'vexillum' | 'pennant' | 'standard' | 'swallowtail' | 'disc' | 'tall' | 'tug';

export interface ArchitectureMotifs {
  roof: RoofStyle;
  column: ColumnStyle;
  ornament: OrnamentStyle;
  banner: BannerShape;
}

export type HelmetStyle = 'crested' | 'corinthian' | 'khat' | 'conical' | 'kabuto' | 'turban' | 'nasal' | 'feather' | 'cap' | 'wrapped' | 'bork' | 'eagleHelm' | 'jaguarHelm' | 'furHat' | 'phrygian' | 'keffiyeh' | 'kidaris' | 'none';
export type WeaponStyle = 'spear' | 'sword' | 'axe' | 'khopesh' | 'club' | 'naginata' | 'mace' | 'scimitar' | 'sarissa';
export type ShieldStyle = 'round' | 'scutum' | 'oval' | 'kite' | 'hoplon' | 'lambda' | 'rectangular' | 'none';
export type RangedStyle = 'bow' | 'composite' | 'crossbow' | 'sling' | 'yumi';
export type ArmorStyle = 'chariot' | 'elephant' | 'wagon' | 'camel' | 'litter';
export type SiegeStyle = 'ballista' | 'gastraphetes' | 'catapult' | 'cannon' | 'rockets';
export type TowerStyle = 'watchtower' | 'obelisk' | 'lighthouse' | 'pagoda' | 'spire' | 'stele';
export type FortStyle = 'walls' | 'pyramid' | 'dome' | 'testudo' | 'acropolis' | 'stepped' | 'palisade' | 'ziggurat';
export type BoatStyle = 'longship' | 'trireme' | 'reed' | 'junk' | 'dhow' | 'canoe';
export type SailStyle = 'square' | 'lateen' | 'battened' | 'none';
export type ShrineStyle = 'flame' | 'orb' | 'scarab' | 'sun' | 'crystal' | 'tripod';
export type WorkshopStyle = 'forge' | 'kiln' | 'loom';

/** Parameters of the generic silhouettes; one set re-dresses all nine roles. */
export interface KitParams {
  helmet: HelmetStyle;
  weapon: WeaponStyle;
  shield: ShieldStyle;
  ranged: RangedStyle;
  armor: ArmorStyle;
  siege: SiegeStyle;
  tower: TowerStyle;
  fort: FortStyle;
  boat: BoatStyle;
  sail: SailStyle;
  shrine: ShrineStyle;
  workshop: WorkshopStyle;
}

/** Soil of the open tiles. */
export type SoilKind = 'earth' | 'sand' | 'terracotta' | 'steppe' | 'loam' | 'cobble' | 'frost' | 'basalt';

export interface RiverDef {
  id: string;
  name: string;
  water: WaterParams;
  bankProps: readonly BankPropKind[];
  soil: SoilKind;
}

export interface WildlifeDef {
  /** Species ids understood by the WildlifeController (built-in or registered). */
  species: readonly AmbientSpecies[];
  /** Names shown in the gallery, pt-BR. */
  labels?: Readonly<Partial<Record<AmbientSpecies, string>>>;
  /** Scripted moments for the gallery: [label, trigger event]. */
  triggers?: ReadonlyArray<readonly [string, string]>;
}

export interface UnitSkin {
  /** Name of the piece in this faction, pt-BR. */
  name: string;
  /** Hand-made model (gets the faction's resolved kit); without it the generic kit builds the role. */
  factory?: (style: KitStyle) => UnitFactory;
  /** Per-role tweaks of the kit parameters. */
  kit?: Partial<KitParams>;
}

export type Expression = 'neutral' | 'taunt' | 'hit' | 'win' | 'lose';

export interface LeaderDef {
  /** Fictional name and title. */
  name: string;
  title: string;
  portrait: PortraitParams;
  /** Per-expression changes (a crown for the victory pose, say). */
  variants?: Readonly<Partial<Record<Expression, Partial<PortraitParams>>>>;
  /** Short lines for future bot dialogue, keyed by expression. */
  lines?: Readonly<Partial<Record<Expression, readonly string[]>>>;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  /** Adjective/people name ("Egípcios"). */
  people: string;
  region: string;
  wave: 1 | 2 | 3 | 4;
  status: FactionStatus;
  archetype: Archetype;
  /** One-line brand from the roadmap. */
  brand: string;
  palette: FactionPalette;
  motifs: ArchitectureMotifs;
  kit: KitParams;
  river: RiverDef;
  wildlife: WildlifeDef;
  unitSkins: Readonly<Record<UnitRole, UnitSkin>>;
  leader: LeaderDef;
  sfx: SfxPreset;
  /** Light and room of the board; unspecified keys come from `baseTheme`. */
  board: Partial<ThemePalette>;
  baseTheme?: ThemeId;
  dusk?: number;
  /** Northern lights behind the board (fjords). */
  sky?: { aurora?: boolean };
}
