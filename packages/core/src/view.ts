import type { AbilityId } from './abilities.ts';
import type { ClockPresetId } from './clock.ts';
import type { FieldConfig, UnitSpec } from './config.ts';
import type { Archetype } from './factions.ts';
import type { LineAxis } from './grid.ts';
import type { MutatorId } from './mutators.ts';
import type { LayoutIssue, Placement } from './placement.ts';
import type { RoleId } from './roles.ts';
import type { ShotKind } from './shots.ts';
import type { Coord, PlayerId, Terrain } from './types.ts';

export type MatchPhase = 'placing' | 'playing' | 'finished';

export type WinReason = 'destroyed' | 'surrender' | 'timeout' | 'abandon';

/**
 * O que um tiro numa célula deu. `earth` é erro simples. `submerged` (maré):
 * a água levou o tiro e nada foi revelado, tenha o que tiver na célula (o
 * anfíbio é a exceção e é atingido normalmente).
 */
export type ShotResult = 'earth' | 'rock' | 'hit' | 'destroyed' | 'shield' | 'submerged';

export interface DestroyedPiece {
  readonly role: RoleId;
  readonly cells: readonly Coord[];
}

/** Uma célula atingida. Pode ir para os dois jogadores. */
export interface ShotReport {
  readonly target: Coord;
  readonly result: ShotResult;
  readonly destroyed: DestroyedPiece | null;
  /** Último tiro do atirador: a célula do atacante que ele mostrou ao defensor. */
  readonly sniperReveal: Coord | null;
  /** Preenchido quando uma passiva de facção (não o escudo) absorveu o tiro. */
  readonly absorbedBy?: 'testudo';
}

/** O que a sonda viu numa célula (só para quem sondou). */
export interface ProbeIntel {
  readonly turn: number;
  readonly target: Coord;
  readonly content: 'earth' | 'rock' | 'unit';
}

/** Resultado do tiro especial de uma facção. */
export interface SpecialOutcome {
  readonly special: string;
  readonly kind: ShotKind;
  readonly target: Coord;
  /** Cada célula atingida, em ordem (vazio na sonda). */
  readonly shots: readonly ShotReport[];
  readonly probe: ProbeIntel | null;
  readonly attacker: PlayerId;
  readonly defender: PlayerId;
  readonly turnNumber: number;
  readonly extraShot: boolean;
  readonly extraShotsLeft: number;
  readonly nextTurn: PlayerId | null;
  readonly winner: PlayerId | null;
}

export interface AttackOutcome extends ShotReport {
  readonly attacker: PlayerId;
  readonly defender: PlayerId;
  readonly turnNumber: number;
  readonly extraShot: boolean;
  readonly extraShotsLeft: number;
  readonly nextTurn: PlayerId | null;
  readonly winner: PlayerId | null;
}

export type AbilityOutcome =
  | { readonly ability: 'radar'; readonly target: Coord; readonly count: number | null }
  | {
      readonly ability: 'bomb';
      readonly target: Coord;
      readonly shots: readonly ShotReport[];
      readonly winner: PlayerId | null;
    }
  | { readonly ability: 'shield'; readonly pieceId: string; readonly turns: number }
  | {
      readonly ability: 'repair';
      readonly target: Coord;
      /** Turnos inimigos de reforço que a peça reparada ganhou (0 se outro escudo já estava ligado). */
      readonly guardTurns?: number;
    }
  | {
      readonly ability: 'spy';
      readonly axis: LineAxis;
      readonly index: number;
      readonly role: RoleId | null;
      /** true quando `role` é a peça mais valiosa da linha (espião egípcio); senão é uma sorteada. */
      readonly ranked?: boolean;
    };

/**
 * Célula inimiga como o atacante a vê:
 * - hidden: nada se sabe;
 * - spotted: sabe-se que há unidade intacta (último tiro do atirador ou tiro absorvido por escudo);
 * - earth / rock: terreno revelado;
 * - hit: célula de unidade danificada (`role` só quando a peça inteira cai).
 */
export type EnemyCellState = 'hidden' | 'spotted' | 'earth' | 'rock' | 'hit';

export interface EnemyCell {
  readonly col: number;
  readonly row: number;
  readonly state: EnemyCellState;
  readonly role: RoleId | null;
  /** Um escudo absorveu um tiro aqui em algum momento. */
  readonly shield: boolean;
}

export interface OwnCell {
  readonly col: number;
  readonly row: number;
  readonly terrain: Terrain;
  readonly pieceId: string | null;
  readonly role: RoleId | null;
  /** O inimigo revelou esta célula (numa célula de unidade: ela está danificada). */
  readonly struck: boolean;
  /** O inimigo sabe que há uma unidade aqui sem ter acertado. */
  readonly exposed: boolean;
}

export interface OwnPiece {
  readonly id: string;
  readonly role: RoleId;
  readonly placement: Placement | null;
  readonly cells: readonly Coord[];
  readonly damaged: number;
  readonly destroyed: boolean;
  /** Turnos inimigos de escudo restantes (0 = sem escudo). */
  readonly shieldTurns: number;
}

export type AbilityBlocker =
  | 'disabled'
  | 'not-your-turn'
  | 'already-used'
  | 'cooldown'
  | 'energy'
  | 'missing-piece';

export interface AbilityStatus {
  readonly id: AbilityId;
  readonly cost: number;
  /** Recarga que valeria se usada agora. */
  readonly cooldown: number;
  readonly cooldownLeft: number;
  readonly ready: boolean;
  readonly blocker: AbilityBlocker | null;
}

export interface RadarIntel {
  readonly turn: number;
  readonly center: Coord;
  /** Células ocupadas no 3×3 (sem anfíbios); null quando rocha bloqueou o sinal. */
  readonly count: number | null;
  /** A contagem inclui anfíbios (radar egípcio, ou a margem debaixo d'água). */
  readonly amphibians?: boolean;
}

export interface SpyIntel {
  readonly turn: number;
  readonly axis: LineAxis;
  readonly index: number;
  readonly role: RoleId | null;
  /** Veja o resultado do espião. Ausente em registros antigos = pela mais valiosa. */
  readonly ranked?: boolean;
}

export type SpecialBlocker = 'disabled' | 'not-your-turn' | 'already-used' | 'cooldown' | 'energy' | 'no-charges' | 'no-target';

export interface SpecialStatus {
  readonly id: string;
  readonly name: string;
  readonly kind: ShotKind;
  /** Energia que custaria agora (mais caro quando as cargas acabam, se recarregar). */
  readonly energy: number;
  readonly cooldown: number;
  readonly cooldownLeft: number;
  /** Cargas restantes; null = sem limite. */
  readonly charges: number | null;
  readonly ready: boolean;
  readonly blocker: SpecialBlocker | null;
}

export interface OwnFactionView {
  readonly id: string;
  readonly name: string;
  readonly archetype: Archetype | null;
  /** false nos modos sem energia (a facção fica só visual). */
  readonly active: boolean;
  readonly special: SpecialStatus | null;
  readonly testudo: { readonly used: boolean } | null;
  /** Torres vivas e turnos próprios até o próximo tiro automático. */
  readonly tower: { readonly alive: number; readonly nextFireIn: number } | null;
}

/** O que todos sabem de uma facção (cargas e recargas são públicas, como a energia). */
export interface EnemyFactionView {
  readonly id: string;
  readonly name: string;
  readonly archetype: Archetype | null;
  readonly active: boolean;
  readonly special: {
    readonly id: string;
    readonly name: string;
    readonly kind: ShotKind;
    readonly charges: number | null;
    readonly cooldownLeft: number;
  } | null;
  readonly testudo: { readonly used: boolean } | null;
  readonly tower: { readonly alive: number; readonly nextFireIn: number } | null;
}

export interface TideView {
  readonly submerged: boolean;
  /** Turnos da partida até a água subir (0 enquanto cobre): "a maré sobe em 2 turnos". */
  readonly turnsUntilRise: number;
  /** Turnos da partida até baixar (0 enquanto seca). */
  readonly turnsUntilRecede: number;
  readonly rows: readonly number[];
  readonly period: number;
  readonly duration: number;
}

export interface MutatorView {
  readonly active: readonly MutatorId[];
  readonly tide: TideView | null;
  readonly doubleShot: { readonly shotsPerTurn: number } | null;
  readonly fog: { readonly fadeAfterTurns: number } | null;
}

export interface RoleCount {
  readonly role: RoleId;
  readonly count: number;
}

export interface ClockView {
  readonly preset: ClockPresetId | 'custom';
  readonly turnMs: number | null;
  readonly now: number;
  readonly turnStartedAt: number;
  /** Quando o turno atual estoura; null sem limite ou com o relógio congelado. */
  readonly deadline: number | null;
  readonly frozen: boolean;
}

export interface PlayerClockView {
  readonly bankMs: number;
  readonly strikes: number;
  readonly consecutiveStrikes: number;
  readonly connected: boolean;
  readonly graceLeftMs: number | null;
}

export type HistoryEntry =
  | {
      readonly kind: 'shot';
      readonly turn: number;
      readonly by: PlayerId;
      readonly report: ShotReport;
      readonly extraShot: boolean;
    }
  | {
      readonly kind: 'ability';
      readonly turn: number;
      readonly by: PlayerId;
      readonly ability: AbilityId;
      /** Resultado completo para quem usou (e para todos quando é público, como o bombardeio); null para os outros. */
      readonly outcome: AbilityOutcome | null;
    }
  | {
      readonly kind: 'special';
      readonly turn: number;
      readonly by: PlayerId;
      readonly special: string;
      readonly shot: ShotKind;
      /** Resultado completo, menos para o outro jogador quando é sonda (privada). */
      readonly outcome: SpecialOutcome | null;
    }
  /** Uma torre automática atirou no início do turno do dono. */
  | { readonly kind: 'tower'; readonly turn: number; readonly by: PlayerId; readonly report: ShotReport }
  /** A maré subiu (`submerged: true`) ou baixou. */
  | { readonly kind: 'tide'; readonly turn: number; readonly submerged: boolean }
  | { readonly kind: 'timeout'; readonly turn: number; readonly by: PlayerId }
  | { readonly kind: 'end'; readonly turn: number; readonly winner: PlayerId; readonly reason: WinReason };

/** Layout inimigo completo; só existe depois que a partida termina. */
export interface RevealedLayout {
  readonly rocks: readonly Coord[];
  readonly pieces: readonly { readonly id: string; readonly role: RoleId; readonly cells: readonly Coord[] }[];
}

/**
 * Tudo o que um jogador pode saber. É JSON puro: pode ir pela rede como está.
 * Células inimigas nunca reveladas não carregam conteúdo nenhum.
 */
export interface PlayerView {
  readonly player: PlayerId;
  readonly opponent: PlayerId;
  readonly phase: MatchPhase;
  readonly turn: PlayerId;
  readonly turnNumber: number;
  readonly winner: PlayerId | null;
  readonly winReason: WinReason | null;
  readonly config: FieldConfig;
  readonly turnState: {
    readonly extraShotsUsed: number;
    readonly extraShotsLeft: number;
    readonly abilityUsed: boolean;
    /** O tiro especial já foi usado neste turno. */
    readonly specialUsed?: boolean;
    /** Tiros que sobram neste turno com 'tiro-duplo'; null nos outros casos. */
    readonly shotsLeft?: number | null;
  };
  /** Mutadores ligados e o calendário da maré. */
  readonly mutators?: MutatorView;
  readonly own: {
    /** Exército deste jogador (o do modo mais as peças da facção). */
    readonly units?: readonly UnitSpec[];
    readonly faction?: OwnFactionView;
    readonly cells: readonly OwnCell[];
    readonly pieces: readonly OwnPiece[];
    readonly confirmed: boolean;
    readonly issues: readonly LayoutIssue[];
    readonly energy: number;
    /** Teto de energia deste modo e facção (0 sem energia). */
    readonly energyMax?: number;
    readonly abilities: readonly AbilityStatus[];
    readonly unitCellsTotal: number;
    readonly unitCellsLeft: number;
    readonly clock: PlayerClockView;
  };
  readonly enemy: {
    /** Exército inimigo (público, como a lista de frota). */
    readonly units?: readonly UnitSpec[];
    readonly faction?: EnemyFactionView;
    readonly cells: readonly EnemyCell[];
    readonly confirmed: boolean;
    readonly energy: number;
    readonly unitCellsTotal: number;
    readonly unitCellsLeft: number;
    /** Peças ainda de pé, por papel (público, como a lista de frota do Batalha Naval). */
    readonly remaining: readonly RoleCount[];
    readonly destroyed: readonly DestroyedPiece[];
    /** O adversário tem um escudo ligado agora. */
    readonly shieldActive: boolean;
    readonly clock: PlayerClockView;
    readonly layout: RevealedLayout | null;
  };
  readonly intel: {
    readonly radar: readonly RadarIntel[];
    readonly spy: readonly SpyIntel[];
    readonly probes?: readonly ProbeIntel[];
  };
  readonly clock: ClockView;
  readonly history: readonly HistoryEntry[];
}
