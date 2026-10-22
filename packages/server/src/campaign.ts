import {
  CAMPAIGN,
  campaignMission,
  missionMatchOptions,
  missionStars,
  missionStatus,
  newCampaignProgress,
  parseCampaignProgress,
  recordMission,
  type CampaignProgress,
  type LogEntry,
  type MissionRecord,
} from '@riverfront/core';
import { opponentLayoutSeed, type ErrorCode, type StoredCampaign } from '@riverfront/protocol';
import { replayLocalMatch } from './replay.ts';
import type { Account } from './store/types.ts';

export type CampaignOutcome = { readonly ok: true; readonly campaign: StoredCampaign } | { readonly ok: false; readonly code: ErrorCode; readonly detail: string };

/**
 * Confere se um progresso vindo do aparelho é possível pelas regras da
 * campanha: toda missão vencida estava desbloqueada (arco aberto e a anterior
 * vencida) e as estrelas batem com o menor número de tiros.
 */
export function campaignProblem(progress: CampaignProgress): string | null {
  for (const [id, record] of Object.entries(progress.missions)) {
    const mission = campaignMission(id);
    if (!mission) return `missão desconhecida: ${id}`;
    if (!record.won) {
      if (record.stars !== 0) return `estrelas sem vitória em ${id}`;
      continue;
    }
    // missionStatus diz 'won' para qualquer missão marcada; a anterior do arco precisa estar vencida também.
    const previous = CAMPAIGN.find((a) => a.faction === mission.arc)?.missions[mission.index - 1];
    if (missionStatus(progress, id) !== 'won' || (previous && !progress.missions[previous.id]?.won)) return `missão ${id} vencida sem estar desbloqueada`;
    if (record.bestShots === null) return `vitória sem número de tiros em ${id}`;
    if (record.stars > missionStars(mission, true, record.bestShots)) return `estrelas demais em ${id}`;
    if (record.attempts < 1) return `vitória sem tentativas em ${id}`;
  }
  return null;
}

function mergeRecord(a: MissionRecord | undefined, b: MissionRecord): MissionRecord {
  if (!a) return b;
  const best = [a.bestShots, b.bestShots].filter((x): x is number => x !== null);
  return {
    won: a.won || b.won,
    stars: Math.max(a.stars, b.stars) as 0 | 1 | 2 | 3,
    bestShots: best.length > 0 ? Math.min(...best) : null,
    attempts: Math.max(a.attempts, b.attempts),
  };
}

function stored(account: Account): StoredCampaign {
  return account.campaign ?? { progress: newCampaignProgress(), verified: [], updatedAt: 0 };
}

/** Junta o progresso do aparelho com o da conta (o melhor de cada missão). */
export function syncCampaign(account: Account, incoming: CampaignProgress, now: number): CampaignOutcome {
  const parsed = parseCampaignProgress(incoming);
  const problem = campaignProblem(parsed);
  if (problem) return { ok: false, code: 'campaign-invalid', detail: problem };
  const current = stored(account);
  const missions: Record<string, MissionRecord> = { ...current.progress.missions };
  for (const [id, record] of Object.entries(parsed.missions)) missions[id] = mergeRecord(missions[id], record);
  const progress: CampaignProgress = { version: 1, missions };
  const merged = campaignProblem(progress);
  if (merged) return { ok: false, code: 'campaign-invalid', detail: merged };
  account.campaign = { progress, verified: [...current.verified], updatedAt: now };
  return { ok: true, campaign: account.campaign };
}

/** Uma missão jogada com o log: refeita no servidor e marcada como verificada se venceu. */
export function verifyMission(account: Account, missionId: string, log: readonly LogEntry[], now: number): CampaignOutcome {
  const options = missionMatchOptions(missionId, 0);
  if (!options) return { ok: false, code: 'campaign-invalid', detail: 'missão desconhecida' };
  const replay = replayLocalMatch(options, log, 'blue', opponentLayoutSeed(options.seed));
  if (!replay.ok) return { ok: false, code: 'replay-rejected', detail: replay.reason };
  const shots = replay.match.log.filter((e) => (e.type === 'attack' || e.type === 'special') && e.player === 'blue').length;
  const won = replay.match.winner === 'blue';
  const current = stored(account);
  const recorded = recordMission(current.progress, missionId, { won, shots });
  if (!recorded.ok) return { ok: false, code: 'campaign-invalid', detail: recorded.error === 'locked' ? 'missão bloqueada' : 'missão desconhecida' };
  const verified = won && !current.verified.includes(missionId) ? [...current.verified, missionId] : [...current.verified];
  account.campaign = { progress: recorded.progress, verified, updatedAt: now };
  return { ok: true, campaign: account.campaign };
}
