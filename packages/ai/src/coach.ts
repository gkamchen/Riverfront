import { ROLES, cellLabel, createRng, hashSeed, neighbors4, type Coord, type PlayerView, type RoleId } from '@riverfront/core';
import { densityMap, sampleLayouts, toProbabilities } from './inference.ts';
import { HIT, Knowledge, SPOTTED, UNKNOWN } from './knowledge.ts';
import { bestCell, planSpecial, toCoord } from './tactics.ts';

export interface CoachAdvice {
  /** Chance (0..1) that each enemy cell holds a unit, by cell index; 0 for uncovered cells. */
  readonly heat: readonly number[];
  readonly best: Coord | null;
  /** Chance of a hit at `best`. */
  readonly chance: number;
  /** Short explanation in pt-BR. */
  readonly explanation: string;
  /** Extra tips about factions, special shot and mutators (pt-BR), also included in `explanation`. */
  readonly tips?: readonly string[];
}

export interface CoachOptions {
  readonly samples?: number;
  readonly seed?: number;
}

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function roleList(roles: readonly RoleId[]): string {
  const names = roles.map((r) => ROLES[r].name.toLowerCase());
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

const turnsText = (n: number) => (n === 1 ? '1 turno' : `${n} turnos`);

/** Faction, special shot and mutator hints for the player on turn. */
function factionTips(view: PlayerView, k: Knowledge, prob: Float64Array): string[] {
  const tips: string[] = [];
  const tide = view.mutators?.tide;
  if (tide?.submerged) {
    tips.push(`A maré cobre a margem (linha 1) por mais ${turnsText(tide.turnsUntilRecede)}: tiros lá são recusados, só o anfíbio fica exposto a bombas.`);
  } else if (tide && tide.turnsUntilRise <= 2) {
    tips.push(`A maré sobe em ${turnsText(tide.turnsUntilRise)}: se suspeita de algo na margem, atire lá agora.`);
  }
  if (view.mutators?.fog) tips.push('Neblina: erros antigos somem do mapa, mas a terra continua lá. Não atire duas vezes no mesmo lugar.');
  if (view.mutators?.doubleShot && view.turnState.shotsLeft) tips.push(`Tiro duplo: você ainda tem ${view.turnState.shotsLeft} tiro(s) neste turno.`);

  const enemy = view.enemy.faction;
  if (enemy?.active) {
    if (enemy.tower && enemy.tower.alive > 0) {
      tips.push(`A torre inimiga dispara sozinha em ${turnsText(enemy.tower.nextFireIn)} dele; ela fica nas duas últimas linhas e vale caçar.`);
    }
    if (enemy.testudo && !enemy.testudo.used) {
      tips.push('O testudo inimigo ainda está de pé: o primeiro acerto no bunker ou numa peça encostada nele será absorvido.');
    }
  }

  const own = view.own.faction;
  const special = own?.special;
  if (own?.active && special) {
    if (special.ready) {
      const plan = planSpecial(view, k, prob, createRng(hashSeed('coach-special', view.turnNumber)), 2);
      if (plan) {
        const where = cellLabel(plan.target);
        const text: Record<string, string> = {
          probe: `Use a ${special.name} em ${where} antes de atirar: ela não gasta o tiro e mostra o que há ali.`,
          precise: `O ${special.name.toLowerCase()} está pronto: mire no radar em ${where} para um acerto garantido.`,
          line3: `A ${special.name.toLowerCase()} a partir de ${where} cobre a linha mais promissora.`,
          cross: `A ${special.name.toLowerCase()} em ${where} acerta a cruz com mais chance de unidades.`,
          double: `O ${special.name.toLowerCase()} em ${where} e ${plan.second ? cellLabel(plan.second) : ''} vale mais que um tiro só.`,
          ricochet: `O ${special.name.toLowerCase()} em ${where} ganha uma segunda chance se cair em terra.`,
        };
        const line = text[special.kind];
        if (line) tips.push(line);
      }
    } else if (special.blocker === 'no-target') {
      tips.push(`O ${special.name.toLowerCase()} precisa de um radar seu que tenha achado unidades.`);
    }
  }
  if (own?.tower && own.tower.alive > 0) tips.push(`Sua torre dispara sozinha em ${turnsText(own.tower.nextFireIn)} seu(s).`);
  return tips;
}

/**
 * Training aid: the same public reasoning the strongest bot uses, laid out as
 * a heat map, plus the recommended shot in plain words. Uses only the view.
 */
export function coach(view: PlayerView, options: CoachOptions = {}): CoachAdvice {
  const k = Knowledge.fromView(view);
  const seed = options.seed ?? hashSeed('coach', view.turnNumber, view.history.length);
  const rng = createRng(seed);
  const sampled = sampleLayouts(k, rng, { samples: options.samples ?? 300 });
  const prob = sampled.accepted >= 12 ? sampled.prob : toProbabilities(k, densityMap(k));
  const heat = Array.from(prob, (p, i) => (k.shootable(i) ? Math.round(p * 1000) / 1000 : 0));

  if (view.phase !== 'playing' || !k.remaining.length) {
    return { heat, best: null, chance: 0, explanation: 'Nenhum tiro a recomendar agora.', tips: [] };
  }

  const index = bestCell(k, prob, rng);
  const best = toCoord(k, index);
  const chance = k.status[index] === SPOTTED ? 1 : (prob[index] ?? 0);
  const label = cellLabel(best);
  const parts: string[] = [];

  if (k.status[index] === SPOTTED) {
    parts.push(`Atire em ${label}: já se sabe que há uma unidade intacta ali, acerto garantido.`);
  } else {
    const nearHit = neighbors4(k.size, index).find((n) => k.status[n] === HIT);
    if (nearHit !== undefined) {
      parts.push(
        `Atire em ${label} (${pct(chance)}). O acerto em ${cellLabel(toCoord(k, nearHit))} ainda não derrubou a peça, e ela precisa continuar por perto.`,
      );
    } else {
      const big = [...k.remaining].sort((a, b) => b.shape.length - a.shape.length).slice(0, 3).map((r) => r.role);
      parts.push(
        `Atire em ${label} (${pct(chance)}). É a casa onde mais posições possíveis das peças restantes se cruzam (${roleList(big)}).`,
      );
    }
  }

  const radar = view.intel.radar.at(-1);
  if (radar && radar.count !== null && radar.count > 0) {
    parts.push(`O radar em ${cellLabel(radar.center)} contou ${radar.count} ocupada(s) em volta.`);
  }
  if (k.shieldActive && k.shieldMark.some((m, i) => m === 1 && k.status[i] !== UNKNOWN)) {
    parts.push('Evite as casas com escudo enquanto ele estiver ativo: o tiro seria absorvido.');
  }
  const tips = factionTips(view, k, prob);
  return { heat, best, chance, explanation: [...parts, ...tips].join(' '), tips };
}
