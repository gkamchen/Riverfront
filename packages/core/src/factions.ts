import type { AbilityId } from './abilities.ts';
import type { RoleId } from './roles.ts';
import type { ShotKind, SpecialShotDef } from './shots.ts';

/**
 * Factions are pure data: an archetype, a special shot, passives, ability
 * cost/cooldown deltas, an optional extra piece and a leader. The match reads
 * these fields; nothing in the engine branches on a faction id.
 *
 * Faction mechanics only switch on in modes with energy and abilities (the
 * 'full' preset). In 'classic' the faction is cosmetic.
 */
export type Archetype = 'informacao' | 'defesa' | 'ataque' | 'tempo' | 'energia';

export type FactionId =
  | 'neutra'
  | 'egito'
  | 'roma'
  | 'grecia'
  | 'vikings'
  | 'japoneses'
  | 'chineses'
  | 'persas'
  | 'mongois'
  | 'otomanos'
  | 'maias'
  | 'astecas'
  | 'incas'
  | 'celtas'
  | 'cartagineses'
  | 'assirios'
  | 'babilonios'
  | 'arabes'
  | 'bizantinos'
  | 'indianos'
  | 'hunos'
  | 'partos'
  | 'macedonios'
  | 'espartanos';

/** Deltas applied to an ability's base cost and cooldown (negative = cheaper / faster). */
export interface AbilityModifier {
  readonly cost?: number;
  readonly cooldown?: number;
}

export interface FactionPassives {
  /** Radar counts amphibians too. */
  readonly radarSeesAmphibians?: boolean;
  /** Spy names the most valuable piece of the line instead of a random one. */
  readonly spyRanked?: boolean;
  /** Once per match, the first hit on the bunker or a piece touching it is absorbed. */
  readonly testudo?: boolean;
  /** The bomb is not stopped by a rock in the centre. */
  readonly bombPierce?: boolean;
  readonly energyStart?: number;
  readonly energyPerKill?: number;
  readonly energyMax?: number;
  /** Extra enemy turns for the shield ability. */
  readonly shieldTurns?: number;
  /** Extra enemy turns of reinforcement after a repair. */
  readonly repairGuardTurns?: number;
}

export interface ExtraPiece {
  readonly role: RoleId;
  readonly count: number;
}

export type DialogueHook = 'intro' | 'victory' | 'defeat' | 'special';

export interface FactionLeader {
  readonly name: string;
  readonly title: string;
  /** Ids of dialogue lines (the text lives with the UI or the bots). */
  readonly dialogue: Readonly<Record<DialogueHook, string>>;
}

export interface FactionDef {
  readonly id: FactionId | string;
  readonly name: string;
  readonly region: string;
  readonly river: string;
  /** Null only for the neutral army. */
  readonly archetype: Archetype | null;
  /** Release wave (0 = neutral baseline). */
  readonly wave: 0 | 1 | 2 | 3 | 4;
  readonly brand: string;
  readonly specialShot: SpecialShotDef | null;
  readonly passives: FactionPassives;
  readonly abilityModifiers: Partial<Readonly<Record<AbilityId, AbilityModifier>>>;
  readonly extraPiece: ExtraPiece | null;
  readonly leader: FactionLeader;
  /** Per-mode changes, by preset name (e.g. no tower on the small field). */
  readonly modes?: Readonly<Record<string, { readonly extraPiece?: ExtraPiece | null; readonly abilityModifiers?: FactionDef['abilityModifiers'] }>>;
}

/** The extra piece a faction brings to a mode. */
export function extraPieceFor(def: FactionDef, mode: string): ExtraPiece | null {
  const tune = def.modes?.[mode];
  return tune && 'extraPiece' in tune ? (tune.extraPiece ?? null) : def.extraPiece;
}

/** Ability cost/cooldown deltas of a faction in a mode. */
export function modifiersFor(def: FactionDef, mode: string): FactionDef['abilityModifiers'] {
  return def.modes?.[mode]?.abilityModifiers ?? def.abilityModifiers;
}

/** Own turns between two shots of an auto tower. */
export const TOWER_PERIOD = 5;

// ------------------------------------------------------------ power budget

/**
 * Every faction spends the same budget, in points:
 *
 *   power = Σ ability cost deltas × COST + Σ cooldown deltas × COOLDOWN
 *         + Σ passives (PASSIVE, per unit for numeric ones)
 *         + special shot + extra pieces × PIECE
 *
 *   special = KIND + (charges ? 1.5 × charges : 3) + (recharge ? 1 : 0)
 *           − 0.5 × energy − 0.5 × cooldown
 *
 * Deltas count as points when they help (−1 energy on the bomb = +3).
 * The weights were calibrated with the bot league (`npm run sim -- --factions`).
 */
export const FACTION_BUDGET = 10;

export const POWER_WEIGHTS = {
  cost: { radar: 2, bomb: 3, shield: 2, repair: 1, spy: 2 } as Readonly<Record<AbilityId, number>>,
  cooldown: { radar: 1, bomb: 2, shield: 1, repair: 1, spy: 1 } as Readonly<Record<AbilityId, number>>,
  passive: {
    radarSeesAmphibians: 1,
    spyRanked: 2,
    testudo: 2,
    bombPierce: 1,
    energyStart: 2,
    energyPerKill: 2,
    energyMax: 1,
    shieldTurns: 2,
    repairGuardTurns: 1,
  } as Readonly<Record<keyof FactionPassives, number>>,
  kind: { single: 0, probe: 2, precise: 1.5, line3: 2, cross: 3, double: 0, ricochet: 0 } as Readonly<Record<ShotKind, number>>,
  piece: { tower: 6 } as Readonly<Partial<Record<RoleId, number>>>,
} as const;

export function specialPower(special: SpecialShotDef | null): number {
  if (!special) return 0;
  const uses = special.charges === null ? 3 : 1.5 * special.charges;
  const recharge = special.rechargeEnergy !== null ? 1 : 0;
  return POWER_WEIGHTS.kind[special.kind] + uses + recharge - 0.5 * special.energy - 0.5 * special.cooldown;
}

/** Points a faction spends; see `FACTION_BUDGET`. */
export function factionPower(def: FactionDef): number {
  let power = specialPower(def.specialShot);
  for (const [id, mod] of Object.entries(def.abilityModifiers) as [AbilityId, AbilityModifier][]) {
    power -= (mod.cost ?? 0) * POWER_WEIGHTS.cost[id];
    power -= (mod.cooldown ?? 0) * POWER_WEIGHTS.cooldown[id];
  }
  for (const [key, value] of Object.entries(def.passives) as [keyof FactionPassives, boolean | number | undefined][]) {
    if (value === undefined || value === false) continue;
    power += POWER_WEIGHTS.passive[key] * (value === true ? 1 : value);
  }
  if (def.extraPiece) power += (POWER_WEIGHTS.piece[def.extraPiece.role] ?? 0) * def.extraPiece.count;
  return power;
}

// ------------------------------------------------------------ special shots

const shot = (s: SpecialShotDef): SpecialShotDef => s;

export const SPECIAL_SHOTS = {
  sonda: shot({
    id: 'sonda',
    name: 'Sonda',
    kind: 'probe',
    energy: 1,
    cooldown: 3,
    charges: 2,
    rechargeEnergy: 1,
    description: 'Revela o que há numa célula inimiga sem atingir (só você vê) e não gasta o tiro. Custa 1 de energia e tem recarga de 3 turnos.',
    modes: { 'rapido-poderes': { cooldown: 4 } },
  }),
  tiroCerteiro: shot({
    id: 'tiro-certeiro',
    name: 'Tiro certeiro',
    kind: 'precise',
    energy: 1,
    cooldown: 2,
    charges: null,
    rechargeEnergy: null,
    description: 'Mire num radar seu que achou unidades e acerte, com certeza, uma célula intacta daquele 3×3. Recarga de 2 turnos.',
  }),
  rajada: shot({
    id: 'rajada',
    name: 'Rajada',
    kind: 'line3',
    energy: 3,
    cooldown: 3,
    charges: null,
    rechargeEnergy: null,
    modes: { 'rapido-poderes': { energy: 2, cooldown: 2 } },
    description: 'Atinge 3 células em linha. Uma rocha para a rajada. Conta como o tiro do turno e não dá tiro extra.',
  }),
} as const;

/** Reflavoured copy of a library special (same numbers, so the same power). */
const renamed = (base: SpecialShotDef, id: string, name: string): SpecialShotDef => ({ ...base, id, name });

const crossShot = (id: string, name: string): SpecialShotDef => ({
  id,
  name,
  kind: 'cross',
  energy: 4,
  cooldown: 4,
  charges: null,
  rechargeEnergy: null,
  modes: { 'rapido-poderes': { energy: 3, cooldown: 3 } },
  description: 'Atinge o alvo e as 4 vizinhas. Rocha no centro absorve tudo. Conta como o tiro do turno e não dá tiro extra.',
});

const doubleShot = (id: string, name: string): SpecialShotDef => ({
  id,
  name,
  kind: 'double',
  energy: 1,
  cooldown: 1,
  charges: null,
  rechargeEnergy: null,
  modes: { 'rapido-poderes': { energy: 2, cooldown: 4 } },
  description: 'Dois disparos em células não vizinhas. Conta como o tiro do turno e não dá tiro extra.',
});

const ricochetShot = (id: string, name: string): SpecialShotDef => ({
  id,
  name,
  kind: 'ricochet',
  energy: 1,
  cooldown: 1,
  charges: null,
  rechargeEnergy: null,
  modes: { 'rapido-poderes': { energy: 3, cooldown: 2 } },
  description: 'Um disparo que, se cair em terra, ricocheteia para uma vizinha ainda não revelada.',
});

// ------------------------------------------------------------ registry

const dialogue = (id: string): FactionLeader['dialogue'] => ({
  intro: `${id}.intro`,
  victory: `${id}.victory`,
  defeat: `${id}.defeat`,
  special: `${id}.special`,
});

interface Flavour {
  readonly id: FactionId;
  readonly name: string;
  readonly region: string;
  readonly river: string;
  readonly wave: 1 | 2 | 3 | 4;
  readonly brand: string;
  readonly leader: { readonly name: string; readonly title: string };
  readonly special?: SpecialShotDef;
  readonly passives?: FactionPassives;
  readonly abilityModifiers?: FactionDef['abilityModifiers'];
  readonly extraPiece?: ExtraPiece | null;
  readonly modes?: FactionDef['modes'];
}

/** Archetype templates: the shared core of each archetype (flavour fills the rest of the budget). */
const TEMPLATES: Readonly<
  Record<Archetype, { special: SpecialShotDef; passives: FactionPassives; abilityModifiers: FactionDef['abilityModifiers'] }>
> = {
  // 8 points: cheaper radar, ranked spy, probe.
  informacao: { special: SPECIAL_SHOTS.sonda, passives: { spyRanked: true }, abilityModifiers: { radar: { cost: -1 } } },
  // 8 points: testudo, cheaper shield and repair, precise shot.
  defesa: {
    special: SPECIAL_SHOTS.tiroCerteiro,
    passives: { testudo: true },
    abilityModifiers: { shield: { cost: -1 }, repair: { cost: -1 } },
  },
  // 5 points (special included): piercing bomb on a shorter cooldown.
  ataque: { special: SPECIAL_SHOTS.rajada, passives: { bombPierce: true }, abilityModifiers: { bomb: { cooldown: -1 } } },
  // 8 points: every cooldown one turn shorter and a double shot.
  tempo: {
    special: doubleShot('disparo-duplo', 'Disparo duplo'),
    passives: {},
    abilityModifiers: {
      radar: { cooldown: -1 },
      bomb: { cooldown: -1 },
      spy: { cooldown: -1 },
      shield: { cooldown: -1 },
      repair: { cooldown: -1 },
    },
  },
  // 7 points: more energy in, out and on hand, plus a ricochet.
  energia: {
    special: ricochetShot('ricochete', 'Ricochete'),
    passives: { energyStart: 1, energyPerKill: 1, energyMax: 1 },
    abilityModifiers: {},
  },
};

function mergeModifiers(
  a: FactionDef['abilityModifiers'],
  b: FactionDef['abilityModifiers'] | undefined,
): FactionDef['abilityModifiers'] {
  const out: Partial<Record<AbilityId, AbilityModifier>> = { ...a };
  for (const [id, mod] of Object.entries(b ?? {}) as [AbilityId, AbilityModifier][]) {
    const base = out[id] ?? {};
    out[id] = { cost: (base.cost ?? 0) + (mod.cost ?? 0), cooldown: (base.cooldown ?? 0) + (mod.cooldown ?? 0) };
  }
  return out;
}

function build(archetype: Archetype, f: Flavour): FactionDef {
  const t = TEMPLATES[archetype];
  return {
    id: f.id,
    name: f.name,
    region: f.region,
    river: f.river,
    archetype,
    wave: f.wave,
    brand: f.brand,
    specialShot: f.special ?? t.special,
    passives: { ...t.passives, ...f.passives },
    abilityModifiers: mergeModifiers(t.abilityModifiers, f.abilityModifiers),
    extraPiece: f.extraPiece ?? null,
    ...(f.modes ? { modes: f.modes } : {}),
    leader: { ...f.leader, dialogue: dialogue(f.id) },
  };
}

export const NEUTRAL_FACTION: FactionDef = {
  id: 'neutra',
  name: 'Neutra',
  region: '—',
  river: 'Lago',
  archetype: null,
  wave: 0,
  brand: 'Exército padrão, sem bônus de facção',
  specialShot: null,
  passives: {},
  abilityModifiers: {},
  extraPiece: null,
  leader: { name: 'Comando Central', title: 'Comandante', dialogue: dialogue('neutra') },
};

export const FACTIONS: Readonly<Record<FactionId, FactionDef>> = {
  neutra: NEUTRAL_FACTION,

  // ---- wave 1
  egito: build('informacao', {
    id: 'egito',
    name: 'Egito',
    region: 'Egito',
    river: 'Nilo',
    wave: 1,
    brand: 'Faraós, pirâmides e deuses',
    leader: { name: 'Amenkhet', title: 'Faraó do Nilo' },
    passives: { radarSeesAmphibians: true, repairGuardTurns: 1 },
  }),
  roma: build('defesa', {
    id: 'roma',
    name: 'Roma',
    region: 'Roma',
    river: 'Tibre',
    wave: 1,
    brand: 'Legiões, disciplina e conquistas',
    leader: { name: 'Caio Valério Serrano', title: 'Legado da Legião do Tibre' },
    passives: { energyPerKill: 1 },
  }),
  grecia: build('ataque', {
    id: 'grecia',
    name: 'Grécia',
    region: 'Grécia',
    river: 'Mar Egeu',
    wave: 1,
    brand: 'Filosofia, hoplitas e mitologia',
    leader: { name: 'Nikandros de Argos', title: 'Estratego do Egeu' },
    extraPiece: { role: 'tower', count: 1 },
    // On the small field the bomb is the main power: there Greece keeps the template's faster bomb.
    modes: { 'rapido-poderes': { abilityModifiers: { bomb: { cooldown: -1 } } } },
    passives: { energyMax: 1 },
    // The tower pays for the template's faster bomb.
    abilityModifiers: { bomb: { cooldown: 1 } },
  }),

  // ---- wave 2
  vikings: build('tempo', {
    id: 'vikings',
    name: 'Vikings',
    region: 'Escandinávia',
    river: 'Fiorde',
    wave: 2,
    brand: 'Navegação, machados e exploração',
    leader: { name: 'Hallvard Steinsson', title: 'Jarl do Fiorde' },
    special: doubleShot('machados', 'Machados arremessados'),
    passives: { energyPerKill: 1 },
  }),
  japoneses: build('informacao', {
    id: 'japoneses',
    name: 'Japão',
    region: 'Japão',
    river: 'Rio de montanha',
    wave: 2,
    brand: 'Samurais, ninjas e honra',
    leader: { name: 'Kazumori Akihisa', title: 'Daimyō do Vale Alto' },
    special: renamed(SPECIAL_SHOTS.sonda, 'batedor', 'Batedor'),
    abilityModifiers: { spy: { cost: -1 } },
  }),
  chineses: build('ataque', {
    id: 'chineses',
    name: 'China',
    region: 'China',
    river: 'Rio Amarelo',
    wave: 2,
    brand: 'Dinastias, dragões e pólvora',
    leader: { name: 'Wei Jingshan', title: 'General da Fronteira' },
    special: crossShot('polvora', 'Pólvora'),
    passives: { radarSeesAmphibians: true, repairGuardTurns: 1 },
    abilityModifiers: { shield: { cost: -1 }, repair: { cooldown: -1 } },
  }),
  persas: build('energia', {
    id: 'persas',
    name: 'Pérsia',
    region: 'Pérsia',
    river: 'Eufrates',
    wave: 2,
    brand: 'Cavalaria e grandes impérios',
    leader: { name: 'Arash Mehrdad', title: 'Sátrapa de Susa' },
    special: ricochetShot('cavalaria', 'Carga de cavalaria'),
    abilityModifiers: { radar: { cost: -1 }, spy: { cooldown: -1 } },
  }),

  // ---- wave 3
  mongois: build('tempo', {
    id: 'mongois',
    name: 'Mongólia',
    region: 'Mongólia',
    river: 'Rio da estepe',
    wave: 3,
    brand: 'Cavalaria e arqueiros montados',
    leader: { name: 'Altan Ganbold', title: 'Cã das Pastagens' },
    special: doubleShot('arqueiros', 'Arqueiros montados'),
    passives: { energyPerKill: 1 },
  }),
  otomanos: build('ataque', {
    id: 'otomanos',
    name: 'Império Otomano',
    region: 'Anatólia',
    river: 'Bósforo',
    wave: 3,
    brand: 'Artilharia e expansão imperial',
    leader: { name: 'Kemal Demirhan', title: 'Paxá do Bósforo' },
    special: renamed(SPECIAL_SHOTS.rajada, 'bombarda', 'Bombarda'),
    passives: { energyMax: 1, repairGuardTurns: 1 },
    abilityModifiers: { radar: { cooldown: -1 }, spy: { cooldown: -1 }, repair: { cooldown: -1 } },
  }),
  maias: build('informacao', {
    id: 'maias',
    name: 'Maias',
    region: 'América Central',
    river: 'Cenote',
    wave: 3,
    brand: 'Cidades, astronomia e rituais',
    leader: { name: 'Kaan Teel', title: 'Senhor da Cidade das Estrelas' },
    special: renamed(SPECIAL_SHOTS.sonda, 'observatorio', 'Observatório'),
    passives: { radarSeesAmphibians: true },
    abilityModifiers: { radar: { cooldown: -1 } },
  }),
  astecas: build('energia', {
    id: 'astecas',
    name: 'Astecas',
    region: 'México',
    river: 'Lago de Texcoco',
    wave: 3,
    brand: 'Guerreiros e grandes templos',
    leader: { name: 'Citlali Ocelotl', title: 'Tlatoani das Ilhas' },
    special: ricochetShot('macuahuitl', 'Golpe de obsidiana'),
    abilityModifiers: { radar: { cost: -1 }, repair: { cost: -1 } },
  }),
  incas: build('defesa', {
    id: 'incas',
    name: 'Incas',
    region: 'Andes',
    river: 'Urubamba',
    wave: 3,
    brand: 'Engenharia, estradas e montanhas',
    leader: { name: 'Kusi Rimaq', title: 'Senhor dos Quatro Cantos' },
    special: renamed(SPECIAL_SHOTS.tiroCerteiro, 'funda', 'Funda certeira'),
    passives: { energyMax: 1 },
    abilityModifiers: { shield: { cooldown: -1 } },
  }),
  celtas: build('informacao', {
    id: 'celtas',
    name: 'Celtas',
    region: 'Europa Ocidental',
    river: 'Rio com névoa',
    wave: 3,
    brand: 'Guerreiros tribais e druidas',
    leader: { name: 'Eilidh Morvane', title: 'Chefe dos Clãs das Colinas' },
    special: renamed(SPECIAL_SHOTS.sonda, 'druida', 'Olhar do druida'),
    passives: { energyStart: 1 },
  }),
  cartagineses: build('energia', {
    id: 'cartagineses',
    name: 'Cartago',
    region: 'Norte da África',
    river: 'Porto do Mediterrâneo',
    wave: 3,
    brand: 'Comércio marítimo e elefantes de guerra',
    leader: { name: 'Safot Ben-Hiram', title: 'Almirante de Cartago' },
    special: ricochetShot('elefantes', 'Elefantes de guerra'),
    abilityModifiers: { radar: { cost: -1 }, repair: { cooldown: -1 } },
  }),

  // ---- wave 4
  assirios: build('ataque', {
    id: 'assirios',
    name: 'Assíria',
    region: 'Mesopotâmia',
    river: 'Tigre',
    wave: 4,
    brand: 'Cerco de cidades e exército poderoso',
    leader: { name: 'Nabu-zakir Ashuri', title: 'Rei dos Quatro Cantos' },
    special: crossShot('ariete', 'Aríete'),
    passives: { energyMax: 1 },
    abilityModifiers: { radar: { cooldown: -1 }, shield: { cost: -1 }, repair: { cooldown: -1 } },
  }),
  babilonios: build('informacao', {
    id: 'babilonios',
    name: 'Babilônia',
    region: 'Mesopotâmia',
    river: 'Eufrates',
    wave: 4,
    brand: 'Cidades monumentais e conhecimento',
    leader: { name: 'Iltani Sin-iddina', title: 'Rainha da Cidade das Torres' },
    special: renamed(SPECIAL_SHOTS.sonda, 'escribas', 'Registro dos escribas'),
    passives: { repairGuardTurns: 1 },
    abilityModifiers: { spy: { cooldown: -1 } },
  }),
  arabes: build('tempo', {
    id: 'arabes',
    name: 'Arábia',
    region: 'Península Arábica',
    river: 'Oásis',
    wave: 4,
    brand: 'Comércio, cavalaria e expansão',
    leader: { name: 'Nasir al-Rimal', title: 'Emir do Oásis' },
    special: doubleShot('caravana', 'Caravana veloz'),
    passives: { energyPerKill: 1 },
  }),
  bizantinos: build('defesa', {
    id: 'bizantinos',
    name: 'Bizâncio',
    region: 'Mediterrâneo Oriental',
    river: 'Bósforo',
    wave: 4,
    brand: 'Fortificações e estratégia',
    leader: { name: 'Leontios Arkadianos', title: 'Estratego do Tema' },
    special: renamed(SPECIAL_SHOTS.tiroCerteiro, 'fogo-grego', 'Fogo grego'),
    passives: { energyMax: 1 },
    abilityModifiers: { repair: { cooldown: -1 } },
  }),
  indianos: build('ataque', {
    id: 'indianos',
    name: 'Índia',
    region: 'Índia',
    river: 'Ganges',
    wave: 4,
    brand: 'Elefantes de guerra e grandes reinos',
    leader: { name: 'Suhasini Chandravarma', title: 'Rani de Pataliputra' },
    special: renamed(SPECIAL_SHOTS.rajada, 'carga', 'Carga de elefantes'),
    passives: { energyStart: 1, energyMax: 1 },
    abilityModifiers: { shield: { cost: -1 } },
  }),
  hunos: build('tempo', {
    id: 'hunos',
    name: 'Hunos',
    region: 'Ásia Central e Europa',
    river: 'Rio da estepe',
    wave: 4,
    brand: 'Cavalaria rápida e invasões',
    leader: { name: 'Tarkan Ilbars', title: 'Senhor da Horda' },
    special: ricochetShot('flecha', 'Flecha veloz'),
    passives: { energyPerKill: 1 },
  }),
  partos: build('ataque', {
    id: 'partos',
    name: 'Pártia',
    region: 'Pérsia e vizinhança',
    river: 'Rio do planalto',
    wave: 4,
    brand: 'Arqueiros montados e cavalaria',
    leader: { name: 'Farhad Asparuk', title: 'Xá do Planalto' },
    special: doubleShot('tiro-parto', 'Tiro parto'),
    abilityModifiers: { shield: { cost: -1, cooldown: -1 }, spy: { cooldown: -1 }, repair: { cooldown: -1 } },
  }),
  macedonios: build('ataque', {
    id: 'macedonios',
    name: 'Macedônia',
    region: 'Macedônia',
    river: 'Rio da Macedônia',
    wave: 4,
    brand: 'Falanges e conquistas',
    leader: { name: 'Lysandra Eordaia', title: 'Hiparca de Pela' },
    special: renamed(SPECIAL_SHOTS.rajada, 'falange', 'Falange'),
    extraPiece: { role: 'tower', count: 1 },
    abilityModifiers: { bomb: { cooldown: 1 }, repair: { cooldown: -1 } },
  }),
  espartanos: build('defesa', {
    id: 'espartanos',
    name: 'Esparta',
    region: 'Grécia',
    river: 'Eurotas',
    wave: 4,
    brand: 'Infantaria pesada e disciplina',
    leader: { name: 'Agesandra Lakonis', title: 'Comandante de Esparta' },
    special: renamed(SPECIAL_SHOTS.tiroCerteiro, 'lanca', 'Lança certeira'),
    passives: { repairGuardTurns: 1 },
    abilityModifiers: { shield: { cooldown: -1 } },
  }),
};

export const FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

/** Factions in release order of a wave (the neutral army is wave 0). */
export function factionsOfWave(wave: 0 | 1 | 2 | 3 | 4): FactionDef[] {
  return FACTION_IDS.map((id) => FACTIONS[id]).filter((f) => f.wave === wave);
}

export function isFactionId(value: unknown): value is FactionId {
  return typeof value === 'string' && value in FACTIONS;
}

/** A registry id or a full definition (tests and mods); undefined = neutral. */
export function resolveFaction(faction: FactionId | FactionDef | undefined): FactionDef {
  if (faction === undefined) return NEUTRAL_FACTION;
  if (typeof faction === 'string') {
    const def = FACTIONS[faction];
    if (!def) throw new Error(`Unknown faction: ${String(faction)}`);
    return def;
  }
  return faction;
}
