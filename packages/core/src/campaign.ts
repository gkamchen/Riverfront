import type { PresetId } from './config.ts';
import { FACTIONS, FACTION_IDS, type FactionId } from './factions.ts';
import type { MatchOptions } from './match.ts';
import type { MutatorId } from './mutators.ts';
import { hashSeed } from './rng.ts';

/**
 * Campaign: one arc per faction commander, three matches each, every match
 * with the arc's signature mutator. Pure data plus pure functions over a
 * serializable progress object, so any UI (or the server) can drive it.
 */
export interface CampaignMission {
  readonly id: string;
  readonly arc: FactionId;
  /** 0, 1 or 2 inside the arc. */
  readonly index: number;
  readonly title: string;
  readonly briefing: string;
  readonly preset: PresetId;
  readonly mutators: readonly MutatorId[];
  readonly playerFaction: FactionId;
  readonly opponentFaction: FactionId;
  readonly botLevel: 1 | 2 | 3 | 4 | 5;
  readonly seed: number;
  /** Shots for full marks: a win with at most `par` shots earns 3 stars, up to 1.25 × par earns 2. */
  readonly par: number;
}

export interface CampaignArc {
  readonly faction: FactionId;
  readonly wave: 1 | 2 | 3 | 4;
  readonly title: string;
  readonly leader: { readonly name: string; readonly title: string };
  readonly signature: MutatorId;
  readonly missions: readonly CampaignMission[];
}

const SIGNATURE: Readonly<Record<string, MutatorId>> = {
  informacao: 'neblina',
  defesa: 'tiro-duplo',
  ataque: 'mare',
  tempo: 'tiro-duplo',
  energia: 'mare',
};

/** Hand-written titles and briefings for the wave-1 arcs. */
const WAVE1_TEXT: Readonly<Partial<Record<FactionId, { title: string; signature: MutatorId; missions: readonly [string, string][] }>>> = {
  egito: {
    title: 'As cheias do Nilo',
    signature: 'mare',
    missions: [
      ['A primeira cheia', 'O rio sobe a cada seis turnos. Use a sonda antes de atirar e não desperdice tiros na margem coberta.'],
      ['Olhos no deserto', 'Um campo pequeno e um rival romano. Radar e sonda baratos: descubra antes de gastar.'],
      ['O julgamento do Faraó', 'Os gregos e sua torre esperam do outro lado do rio. Encontre a torre antes que ela encontre você.'],
    ],
  },
  roma: {
    title: 'A disciplina do Tibre',
    signature: 'tiro-duplo',
    missions: [
      ['Escudos unidos', 'Dois tiros por turno, sem tiro extra. Mantenha a formação perto do bunker: o testudo segura o primeiro golpe.'],
      ['A estrada da legião', 'Campo rápido contra os gregos. Ligue o radar e prepare o tiro certeiro.'],
      ['O triunfo', 'Os egípcios enxergam tudo. Responda com disciplina e reparos na hora certa.'],
    ],
  },
  grecia: {
    title: 'A névoa do Egeu',
    signature: 'neblina',
    missions: [
      ['Brisa da manhã', 'A névoa apaga os erros antigos do mapa. Lembre-se de onde já atirou e deixe a torre trabalhar.'],
      ['A falange avança', 'Campo rápido contra os egípcios. Rajadas abrem caminho entre as rochas.'],
      ['A epopeia', 'Os romanos fecham a formação. Fure as rochas com o bombardeio e cace o bunker.'],
    ],
  },
};

const RIVALS: Readonly<Record<string, readonly [FactionId, FactionId]>> = {
  egito: ['roma', 'grecia'],
  roma: ['grecia', 'egito'],
  grecia: ['egito', 'roma'],
};

function buildArc(faction: FactionId): CampaignArc {
  const def = FACTIONS[faction];
  const wave = def.wave as 1 | 2 | 3 | 4;
  const text = WAVE1_TEXT[faction];
  const signature = text?.signature ?? SIGNATURE[def.archetype ?? 'ataque'] ?? 'mare';
  // Later waves face the wave-1 factions.
  const rivals = RIVALS[faction] ?? (['roma', 'grecia'] as const);
  const plan = [
    { preset: 'full' as PresetId, opponent: 'neutra' as FactionId, level: 2 as const, extra: [] as MutatorId[], par: 60 },
    { preset: 'rapido-poderes' as PresetId, opponent: rivals[0], level: 3 as const, extra: [] as MutatorId[], par: 28 },
    { preset: 'full' as PresetId, opponent: rivals[1], level: 4 as const, extra: [signature === 'mare' ? 'neblina' : 'mare'] as MutatorId[], par: 70 },
  ];
  const missions = plan.map((p, index): CampaignMission => {
    const id = `${faction}-${index + 1}`;
    const [title, briefing] = text?.missions[index] ?? [
      `${def.name}: batalha ${index + 1}`,
      `${def.leader.title} ${def.leader.name} enfrenta ${FACTIONS[p.opponent].name}. Mutador da campanha: ${signature}.`,
    ];
    return {
      id,
      arc: faction,
      index,
      title,
      briefing,
      preset: p.preset,
      mutators: [signature, ...p.extra],
      playerFaction: faction,
      opponentFaction: p.opponent,
      botLevel: p.level,
      seed: hashSeed('campaign', id),
      par: p.par,
    };
  });
  return {
    faction,
    wave,
    title: text?.title ?? `${def.name}: ${def.leader.title}`,
    leader: { name: def.leader.name, title: def.leader.title },
    signature,
    missions,
  };
}

export const CAMPAIGN: readonly CampaignArc[] = FACTION_IDS.filter((id) => id !== 'neutra').map(buildArc);

const MISSIONS = new Map(CAMPAIGN.flatMap((arc) => arc.missions.map((m) => [m.id, m] as const)));

export function campaignMission(id: string): CampaignMission | null {
  return MISSIONS.get(id) ?? null;
}

/** Arcs of wave N open once this many arcs of wave N-1 are finished. */
export const ARCS_TO_UNLOCK_NEXT_WAVE = 2;

export interface MissionRecord {
  readonly won: boolean;
  readonly stars: 0 | 1 | 2 | 3;
  readonly bestShots: number | null;
  readonly attempts: number;
}

export interface CampaignProgress {
  readonly version: 1;
  readonly missions: Readonly<Record<string, MissionRecord>>;
}

export function newCampaignProgress(): CampaignProgress {
  return { version: 1, missions: {} };
}

function arcDone(progress: CampaignProgress, arc: CampaignArc): boolean {
  return arc.missions.every((m) => progress.missions[m.id]?.won === true);
}

export function arcUnlocked(progress: CampaignProgress, faction: FactionId): boolean {
  const arc = CAMPAIGN.find((a) => a.faction === faction);
  if (!arc) return false;
  if (arc.wave === 1) return true;
  const previous = CAMPAIGN.filter((a) => a.wave === arc.wave - 1);
  return previous.filter((a) => arcDone(progress, a)).length >= Math.min(ARCS_TO_UNLOCK_NEXT_WAVE, previous.length);
}

export type MissionStatus = 'locked' | 'available' | 'won';

export function missionStatus(progress: CampaignProgress, id: string): MissionStatus {
  const mission = campaignMission(id);
  if (!mission || !arcUnlocked(progress, mission.arc)) return 'locked';
  if (progress.missions[id]?.won) return 'won';
  const arc = CAMPAIGN.find((a) => a.faction === mission.arc)!;
  const before = arc.missions[mission.index - 1];
  return !before || progress.missions[before.id]?.won ? 'available' : 'locked';
}

export function availableMissions(progress: CampaignProgress): CampaignMission[] {
  return [...MISSIONS.values()].filter((m) => missionStatus(progress, m.id) === 'available');
}

export function missionStars(mission: CampaignMission, won: boolean, shots: number): 0 | 1 | 2 | 3 {
  if (!won) return 0;
  if (shots <= mission.par) return 3;
  if (shots <= mission.par * 1.25) return 2;
  return 1;
}

/** Records a played mission; returns a new progress (or an error for locked/unknown missions). */
export function recordMission(
  progress: CampaignProgress,
  id: string,
  result: { readonly won: boolean; readonly shots: number },
): { ok: true; progress: CampaignProgress; stars: 0 | 1 | 2 | 3 } | { ok: false; error: 'unknown-mission' | 'locked' } {
  const mission = campaignMission(id);
  if (!mission) return { ok: false, error: 'unknown-mission' };
  if (missionStatus(progress, id) === 'locked') return { ok: false, error: 'locked' };
  const old = progress.missions[id];
  const stars = missionStars(mission, result.won, result.shots);
  const record: MissionRecord = {
    won: (old?.won ?? false) || result.won,
    stars: Math.max(old?.stars ?? 0, stars) as 0 | 1 | 2 | 3,
    bestShots: result.won ? Math.min(old?.bestShots ?? Infinity, result.shots) : (old?.bestShots ?? null),
    attempts: (old?.attempts ?? 0) + 1,
  };
  return { ok: true, progress: { version: 1, missions: { ...progress.missions, [id]: record } }, stars };
}

/** Options for `new Match` (the player is blue and starts). */
export function missionMatchOptions(id: string, startTime = 0): MatchOptions | null {
  const m = campaignMission(id);
  if (!m) return null;
  return {
    seed: m.seed,
    config: m.preset,
    firstTurn: 'blue',
    startTime,
    factions: { blue: m.playerFaction, red: m.opponentFaction },
    mutators: m.mutators,
  };
}

export function campaignStars(progress: CampaignProgress): number {
  return Object.values(progress.missions).reduce((s, r) => s + r.stars, 0);
}

/** Validates progress read from storage; unknown missions are dropped. */
export function parseCampaignProgress(data: unknown): CampaignProgress {
  const out: Record<string, MissionRecord> = {};
  const missions = (data as Partial<CampaignProgress> | null)?.missions;
  if (missions && typeof missions === 'object') {
    for (const [id, r] of Object.entries(missions)) {
      if (!MISSIONS.has(id) || !r || typeof r !== 'object') continue;
      const x = r as Partial<MissionRecord>;
      const stars = [0, 1, 2, 3].includes(x.stars as number) ? (x.stars as 0 | 1 | 2 | 3) : 0;
      out[id] = {
        won: x.won === true,
        stars: x.won === true ? stars : 0,
        bestShots: typeof x.bestShots === 'number' && x.bestShots >= 0 ? x.bestShots : null,
        attempts: typeof x.attempts === 'number' && x.attempts >= 0 ? Math.floor(x.attempts) : 0,
      };
    }
  }
  return { version: 1, missions: out };
}
