import type { LineAxis } from './grid.ts';
import type { RoleId } from './roles.ts';
import type { Coord } from './types.ts';

export type AbilityId = 'radar' | 'bomb' | 'shield' | 'repair' | 'spy';

export type AbilityTarget = 'enemy-cell' | 'own-piece' | 'own-cell' | 'enemy-line';

export interface AbilityDef {
  readonly id: AbilityId;
  readonly name: string;
  readonly cost: number;
  /** Own turns before it can be used again. */
  readonly cooldown: number;
  /** A live piece of this role is needed to use it. */
  readonly requires: RoleId | null;
  /** Shorter cooldown while a live piece of this role exists. */
  readonly cooldownWith: { readonly role: RoleId; readonly cooldown: number } | null;
  readonly target: AbilityTarget;
  readonly description: string;
}

export const ABILITIES: Readonly<Record<AbilityId, AbilityDef>> = {
  radar: {
    id: 'radar',
    name: 'Radar',
    cost: 3,
    cooldown: 3,
    requires: 'antenna',
    cooldownWith: null,
    target: 'enemy-cell',
    description: 'Conta as células ocupadas no 3×3 em volta do alvo. Rocha no centro bloqueia o sinal; anfíbios não aparecem.',
  },
  bomb: {
    id: 'bomb',
    name: 'Bombardeio',
    cost: 4,
    cooldown: 4,
    requires: null,
    cooldownWith: { role: 'artillery', cooldown: 3 },
    target: 'enemy-cell',
    description: 'Atinge o alvo e as 4 vizinhas em cruz. Se o centro for rocha, só o centro conta. Não dá tiro extra.',
  },
  shield: {
    id: 'shield',
    name: 'Escudo',
    cost: 3,
    cooldown: 5,
    requires: 'generator',
    cooldownWith: null,
    target: 'own-piece',
    description: 'Protege uma peça sua por 2 turnos inimigos. Não funciona em peças na margem do lago.',
  },
  repair: {
    id: 'repair',
    name: 'Reparo',
    cost: 3,
    cooldown: 5,
    requires: 'workshop',
    cooldownWith: null,
    target: 'own-cell',
    description:
      'Conserta uma célula danificada de uma peça viva, se ela encostar em terra. A célula volta a ficar oculta e a peça ganha reforço (escudo) por 1 turno inimigo.',
  },
  spy: {
    id: 'spy',
    name: 'Espião',
    cost: 2,
    cooldown: 5,
    requires: null,
    cooldownWith: null,
    target: 'enemy-line',
    description: 'Escolha uma linha ou coluna: revela o tipo de uma peça viva que cruza a linha (sorteada), sem a posição. Linha vazia volta vazia.',
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

export const ENERGY = { start: 2, perTurn: 1, perKill: 2, max: 8 } as const;

/** Extra shots after hits, per turn. The next hit passes the turn. */
export const MAX_EXTRA_SHOTS = 3;

/** Enemy turns a shield lasts. */
export const SHIELD_TURNS = 2;

/** Enemy turns of reinforcement (a shield) a repaired piece gets. */
export const REPAIR_GUARD_TURNS = 1;

export type AbilityRequest =
  | { readonly ability: 'radar'; readonly target: Coord }
  | { readonly ability: 'bomb'; readonly target: Coord }
  | { readonly ability: 'shield'; readonly pieceId: string }
  | { readonly ability: 'repair'; readonly target: Coord }
  | { readonly ability: 'spy'; readonly axis: LineAxis; readonly index: number };
