/**
 * Bot league. Plays every matchup many times (alternating seats and who
 * starts) and prints win rates, shots needed to win and thinking time.
 *
 *   npm run sim                                   # 200 games per matchup, adjacent levels, the four presets
 *   npm run sim -- --games 50 --all               # every pair of levels
 *   npm run sim -- --presets classic --out sim/levels.json
 *   npm run sim -- --factions                     # wave-1 faction matrix at level 3, preset full
 *   npm run sim -- --factions all --level 5 --games 100 --mutators mare
 *
 * `--out` is always resolved inside this package (absolute paths and `..` are refused).
 */
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import {
  FACTIONS,
  FACTION_IDS,
  factionsOfWave,
  hashSeed,
  isMutatorId,
  type FactionId,
  type MutatorId,
  type PlayerId,
  type PresetId,
} from '@riverfront/core';
import { BOT_IDS, MemoryStorage, PROFILES, createBot, runBotMatch, type BotLevel } from '../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));

interface LevelJob {
  readonly kind: 'levels';
  readonly preset: PresetId;
  readonly low: BotLevel;
  readonly high: BotLevel;
  readonly games: number;
  readonly seed: number;
  readonly mutators: readonly MutatorId[];
}

interface FactionJob {
  readonly kind: 'factions';
  readonly a: FactionId;
  readonly b: FactionId;
  readonly preset: PresetId;
  readonly level: BotLevel;
  readonly games: number;
  readonly seed: number;
  readonly mutators: readonly MutatorId[];
}

type Job = LevelJob | FactionJob;

interface SideStats {
  wins: number;
  shotsToWin: number;
  decisions: number;
  thinkMs: number;
  maxMoveMs: number;
  slowestMs: number;
}

interface LevelResult extends LevelJob {
  readonly stats: Record<'low' | 'high', SideStats>;
  readonly rejected: number;
  readonly draws: number;
  readonly seconds: number;
}

interface FactionResult extends FactionJob {
  readonly winsA: number;
  readonly winsB: number;
  readonly turns: number;
  readonly rejected: number;
  readonly seconds: number;
}

type JobResult = LevelResult | FactionResult;

const empty = (): SideStats => ({ wins: 0, shotsToWin: 0, decisions: 0, thinkMs: 0, maxMoveMs: 0, slowestMs: 0 });

function runLevelJob(job: LevelJob): LevelResult {
  const started = performance.now();
  // One storage per bot for the whole matchup: learning bots get to study their opponent.
  const lowBot = createBot(job.low, { seed: hashSeed(job.seed, 'low'), storage: new MemoryStorage() });
  const highBot = createBot(job.high, { seed: hashSeed(job.seed, 'high'), storage: new MemoryStorage() });
  const stats = { low: empty(), high: empty() };
  let rejected = 0;
  let draws = 0;

  for (let game = 0; game < job.games; game++) {
    const highIs: PlayerId = game % 2 === 0 ? 'blue' : 'red';
    const lowIs: PlayerId = highIs === 'blue' ? 'red' : 'blue';
    const result = runBotMatch({
      seed: hashSeed(job.seed, job.preset, job.low, job.high, game),
      config: job.preset,
      bots: { [highIs]: highBot, [lowIs]: lowBot } as Record<PlayerId, typeof highBot>,
      firstTurn: game % 4 < 2 ? 'blue' : 'red',
      mutators: job.mutators,
    });
    rejected += result.rejected;
    for (const [side, player] of [['low', lowIs], ['high', highIs]] as const) {
      const s = stats[side];
      s.decisions += result.decisions[player];
      s.thinkMs += result.thinkMs[player];
      s.slowestMs = Math.max(s.slowestMs, result.slowestMs[player]);
      if (result.decisions[player] > 0) s.maxMoveMs = Math.max(s.maxMoveMs, result.thinkMs[player] / result.decisions[player]);
      if (result.winner === player) {
        s.wins++;
        s.shotsToWin += result.shots[player];
      }
    }
    if (!result.winner) draws++;
  }
  return { ...job, stats, rejected, draws, seconds: (performance.now() - started) / 1000 };
}

function runFactionJob(job: FactionJob): FactionResult {
  const started = performance.now();
  // Same level on both sides; each faction keeps its own bot (and storage) through the matchup.
  const botA = createBot(job.level, { seed: hashSeed(job.seed, 'a', job.a), storage: new MemoryStorage(), faction: job.a });
  const botB = createBot(job.level, { seed: hashSeed(job.seed, 'b', job.b), storage: new MemoryStorage(), faction: job.b });
  let winsA = 0;
  let winsB = 0;
  let turns = 0;
  let rejected = 0;
  for (let game = 0; game < job.games; game++) {
    const aIs: PlayerId = game % 2 === 0 ? 'blue' : 'red';
    const bIs: PlayerId = aIs === 'blue' ? 'red' : 'blue';
    const result = runBotMatch({
      seed: hashSeed(job.seed, 'factions', job.a, job.b, game),
      config: job.preset,
      bots: { [aIs]: botA, [bIs]: botB } as Record<PlayerId, typeof botA>,
      firstTurn: game % 4 < 2 ? 'blue' : 'red',
      factions: { [aIs]: job.a, [bIs]: job.b } as Record<PlayerId, FactionId>,
      mutators: job.mutators,
    });
    rejected += result.rejected;
    turns += result.turns;
    if (result.winner === aIs) winsA++;
    else if (result.winner === bIs) winsB++;
  }
  return { ...job, winsA, winsB, turns, rejected, seconds: (performance.now() - started) / 1000 };
}

function parseArgs(argv: readonly string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const value = i >= 0 ? argv[i + 1] : undefined;
    return value !== undefined && !value.startsWith('--') ? value : undefined;
  };
  const mutators = (get('mutators') ?? '').split(',').filter((m) => m.length > 0);
  for (const m of mutators) if (!isMutatorId(m)) throw new Error(`Mutador desconhecido: ${m}`);
  const factionArg = argv.includes('--factions') ? (get('factions') ?? 'wave1') : null;
  let factions: FactionId[] | null = null;
  if (factionArg === 'wave1') factions = factionsOfWave(1).map((f) => f.id as FactionId);
  else if (factionArg === 'all') factions = FACTION_IDS.filter((id) => id !== 'neutra');
  else if (factionArg) factions = factionArg.split(',') as FactionId[];
  for (const f of factions ?? []) if (!(f in FACTIONS)) throw new Error(`Facção desconhecida: ${f}`);
  return {
    games: Number(get('games') ?? 200),
    presets: (get('presets') ?? 'classic,full,rapido,rapido-poderes').split(',') as PresetId[],
    all: argv.includes('--all'),
    workers: Number(get('workers') ?? Math.max(1, availableParallelism() - 1)),
    seed: Number(get('seed') ?? 2026),
    out: get('out'),
    pairs: get('pairs')?.split(',').map((p) => p.split('-').map(Number) as [number, number]),
    factions,
    level: Number(get('level') ?? 3) as BotLevel,
    factionPreset: (get('presets')?.split(',')[0] ?? 'full') as PresetId,
    mutators: mutators as MutatorId[],
  };
}

/** Output files always land inside this package. */
function safeOutPath(out: string): string {
  if (isAbsolute(out)) throw new Error(`--out precisa ser um caminho relativo ao pacote: ${out}`);
  const full = resolve(PACKAGE_DIR, out);
  const root = resolve(PACKAGE_DIR);
  if (!full.startsWith(root + sep)) throw new Error(`--out sairia do pacote: ${out}`);
  return full;
}

const fmt = (n: number, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '-');
const name = (level: BotLevel) => `L${level} ${PROFILES[BOT_IDS[level - 1]!].name}`;

function reportLevels(results: LevelResult[], games: number): boolean {
  let ordered = true;
  const lines: string[] = [];
  const presets = [...new Set(results.map((r) => r.preset))];
  for (const preset of presets) {
    lines.push('', `## Preset ${preset} (${games} partidas por confronto)`, '');
    lines.push('| Confronto | Vitórias (baixo × alto) | Win-rate do mais forte | Tiros p/ vencer (baixo / alto) | ms/decisão (baixo / alto) | pior partida, média ms (alto) | decisão mais lenta ms (alto) |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of results.filter((x) => x.preset === preset).sort((a, b) => a.low - b.low || a.high - b.high)) {
      const { low, high } = r.stats;
      const rate = high.wins / Math.max(1, low.wins + high.wins);
      if (r.high === r.low + 1 && rate <= 0.5) ordered = false;
      lines.push(
        `| ${name(r.low)} × ${name(r.high)} | ${low.wins} × ${high.wins} | ${fmt(rate * 100)}% | ${fmt(low.shotsToWin / Math.max(1, low.wins))} / ${fmt(high.shotsToWin / Math.max(1, high.wins))} | ${fmt(low.thinkMs / Math.max(1, low.decisions), 2)} / ${fmt(high.thinkMs / Math.max(1, high.decisions), 2)} | ${fmt(high.maxMoveMs, 2)} | ${fmt(high.slowestMs, 1)} |`,
      );
    }
    const totals = new Map<BotLevel, { wins: number; games: number }>();
    for (const r of results.filter((x) => x.preset === preset)) {
      for (const [level, s] of [[r.low, r.stats.low], [r.high, r.stats.high]] as const) {
        const t = totals.get(level) ?? { wins: 0, games: 0 };
        t.wins += s.wins;
        t.games += r.games;
        totals.set(level, t);
      }
    }
    if (results.some((r) => r.preset === preset && r.high - r.low > 1)) {
      lines.push('', '| Bot | Win-rate geral |', '| --- | --- |');
      const rates = [...totals].sort((a, b) => a[0] - b[0]);
      for (const [level, t] of rates) lines.push(`| ${name(level)} | ${fmt((t.wins / t.games) * 100)}% |`);
      for (let i = 1; i < rates.length; i++) if (rates[i]![1].wins / rates[i]![1].games <= rates[i - 1]![1].wins / rates[i - 1]![1].games) ordered = false;
    }
  }
  const rejected = results.reduce((s, r) => s + r.rejected, 0);
  lines.push('', `Ações recusadas pela partida: ${rejected}`, `Ordem L1 < L2 < L3 < L4 < L5: ${ordered ? 'OK' : 'FALHOU'}`, '');
  process.stdout.write(lines.join('\n'));
  return ordered && rejected === 0;
}

/** Matrix of win rates (row faction against column faction) and the overall rate of each faction. */
function reportFactions(
  results: FactionResult[],
  factions: readonly FactionId[],
  level: BotLevel,
  games: number,
  mutators: readonly MutatorId[],
  preset: PresetId,
): boolean {
  const rate = new Map<string, number>();
  const overall = new Map<FactionId, { wins: number; games: number }>();
  for (const r of results) {
    const total = Math.max(1, r.winsA + r.winsB);
    rate.set(`${r.a}|${r.b}`, r.winsA / total);
    rate.set(`${r.b}|${r.a}`, r.winsB / total);
    for (const [f, w] of [[r.a, r.winsA], [r.b, r.winsB]] as const) {
      const t = overall.get(f) ?? { wins: 0, games: 0 };
      t.wins += w;
      t.games += r.winsA + r.winsB;
      overall.set(f, t);
    }
  }
  const lines: string[] = [];
  lines.push('', `## Facções, nível ${level} contra nível ${level}, preset ${preset}${mutators.length ? `, mutadores: ${mutators.join(', ')}` : ''} (${games} partidas por confronto, lados trocados)`, '');
  lines.push(`| Linha vence coluna | ${factions.map((f) => FACTIONS[f].name).join(' | ')} | Geral |`);
  lines.push(`| --- | ${factions.map(() => '---').join(' | ')} | --- |`);
  let balanced = true;
  for (const a of factions) {
    const cells = factions.map((b) => (a === b ? '—' : `${fmt((rate.get(`${a}|${b}`) ?? NaN) * 100)}%`));
    const t = overall.get(a);
    const r = t ? t.wins / Math.max(1, t.games) : NaN;
    if (!(r >= 0.45 && r <= 0.55)) balanced = false;
    lines.push(`| ${FACTIONS[a].name} | ${cells.join(' | ')} | **${fmt(r * 100)}%** |`);
  }
  const rejected = results.reduce((s, r) => s + r.rejected, 0);
  const turns = results.reduce((s, r) => s + r.turns, 0) / Math.max(1, results.reduce((s, r) => s + r.games, 0));
  lines.push('', `Turnos por partida (média): ${fmt(turns)}`, `Ações recusadas pela partida: ${rejected}`, `Todas as facções entre 45% e 55%: ${balanced ? 'OK' : 'FALHOU'}`, '');
  process.stdout.write(lines.join('\n'));
  return balanced && rejected === 0;
}

async function runPool(jobs: Job[], workers: number): Promise<JobResult[]> {
  const results: JobResult[] = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const current = job;
        const result = await new Promise<JobResult>((done, fail) => {
          const worker = new Worker(new URL(import.meta.url), { workerData: current });
          worker.on('message', (value) => done(value as JobResult));
          worker.on('error', fail);
        });
        if (result.kind === 'levels') {
          process.stdout.write(`  ${result.preset} L${result.low}×L${result.high}: ${result.stats.low.wins}×${result.stats.high.wins} (${fmt(result.seconds)} s)\n`);
        } else {
          process.stdout.write(`  ${result.a}×${result.b}: ${result.winsA}×${result.winsB} (${fmt(result.seconds)} s)\n`);
        }
        results.push(result);
      }
    }),
  );
  return results;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out ? safeOutPath(args.out) : null;
  const jobs: Job[] = [];
  if (args.factions) {
    const list = args.factions;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        jobs.push({ kind: 'factions', a: list[i]!, b: list[j]!, preset: args.factionPreset, level: args.level, games: args.games, seed: args.seed, mutators: args.mutators });
      }
    }
  } else {
    for (const preset of args.presets) {
      for (let low = 1; low <= 5; low++) {
        for (let high = low + 1; high <= 5; high++) {
          if (args.pairs && !args.pairs.some(([a, b]) => a === low && b === high)) continue;
          if (!args.pairs && !args.all && high !== low + 1) continue;
          jobs.push({ kind: 'levels', preset, low: low as BotLevel, high: high as BotLevel, games: args.games, seed: args.seed, mutators: args.mutators });
        }
      }
    }
    // Slow matchups first so the pool finishes evenly.
    jobs.sort((a, b) => (a.kind === 'levels' && b.kind === 'levels' ? b.high + b.low - (a.high + a.low) : 0));
  }
  process.stdout.write(`Rodando ${jobs.length} confrontos × ${args.games} partidas em ${args.workers} worker(s)...\n`);
  const started = performance.now();
  const results = await runPool(jobs, args.workers);
  process.stdout.write(`Tempo total: ${fmt((performance.now() - started) / 1000)} s\n`);

  const ok = args.factions
    ? reportFactions(results.filter((r): r is FactionResult => r.kind === 'factions'), args.factions, args.level, args.games, args.mutators, args.factionPreset)
    : reportLevels(results.filter((r): r is LevelResult => r.kind === 'levels'), args.games);
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(results, null, 2));
    process.stdout.write(`Resultado salvo em ${out}\n`);
  }
  if (!ok) process.exitCode = 1;
}

if (isMainThread) {
  void main().catch((error: unknown) => {
    process.stdout.write(`${String(error)}\n`);
    process.exitCode = 2;
  });
} else {
  const job = workerData as Job;
  parentPort?.postMessage(job.kind === 'levels' ? runLevelJob(job) : runFactionJob(job));
}
