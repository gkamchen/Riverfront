/**
 * Self-play training for the two strongest bots (levels 4 and 5).
 *
 *   npm run train                          # priors + parameter search + final report
 *   npm run train -- --generations 3 --games 120 --final 400
 *   npm run train -- --skip-search         # only rebuild the priors
 *
 * 1. Priors: bots play each other on every preset and faction; the layouts
 *    revealed at the end and the shot history (public data only) become
 *    placement and shot priors per preset/faction (`trained/priors.json`).
 * 2. Parameters: a (1+λ) evolutionary search. Each generation mutates the
 *    champion; a mutant replaces it only if it beats it in a head-to-head
 *    series (`trained/params.json`).
 * 3. Report: the trained bots against the hand-made defaults (and against the
 *    previous trained version), `--final` games per comparison (`trained/report.json`).
 *
 * Every file is written inside this package.
 */
import { availableParallelism } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { PLAYERS, createRng, hashSeed, type FactionId, type PlayerId, type PresetId } from '@riverfront/core';
import {
  DEFAULT_PARAMS,
  MemoryStorage,
  PARAM_BOUNDS,
  PriorBuilder,
  TRAINED_PARAMS,
  TRAINED_PARAMS_VERSION,
  TRAINED_PRIORS_VERSION,
  createBot,
  runBotMatch,
  type BotLevel,
  type BotParams,
  type PriorTallies,
  type TrainedParamsFile,
  type TrainedUse,
  trainedUse,
} from '../src/index.ts';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
const TRAINED_DIR = resolve(PACKAGE_DIR, 'trained');

const POWERED: readonly PresetId[] = ['full', 'rapido-poderes'];

interface BotSpec {
  readonly level: BotLevel;
  readonly trained: boolean;
  readonly params?: TrainedParamsFile['params'];
  readonly priors?: boolean;
}

interface Mix {
  readonly presets: readonly PresetId[];
  readonly factions: readonly FactionId[];
}

type Job =
  | ({ readonly kind: 'collect'; readonly level: BotLevel; readonly games: number; readonly seed: number } & Mix)
  | ({ readonly kind: 'duel'; readonly a: BotSpec; readonly b: BotSpec; readonly games: number; readonly seed: number } & Mix);

interface DuelResult {
  readonly kind: 'duel';
  winsA: number;
  winsB: number;
  decisions: number;
  thinkMs: number;
}

interface CollectResult {
  readonly kind: 'collect';
  readonly tallies: PriorTallies;
}

/** Preset and factions of game `g` of a series (same for every series with the same seed). */
function setup(mix: Mix, seed: number, g: number): { preset: PresetId; factions: Record<PlayerId, FactionId> } {
  const preset = mix.presets[g % mix.presets.length]!;
  const rng = createRng(hashSeed(seed, 'setup', g));
  const pick = (): FactionId => (POWERED.includes(preset) ? rng.pick(mix.factions) : 'neutra');
  return { preset, factions: { blue: pick(), red: pick() } };
}

function runJob(job: Job): DuelResult | CollectResult {
  if (job.kind === 'collect') {
    const builder = new PriorBuilder();
    const storage = { blue: new MemoryStorage(), red: new MemoryStorage() };
    for (let g = 0; g < job.games; g++) {
      const { preset, factions } = setup(job, job.seed, g);
      const bots = {
        blue: createBot(job.level, { seed: hashSeed(job.seed, 'b', g), storage: storage.blue, faction: factions.blue }),
        red: createBot(job.level, { seed: hashSeed(job.seed, 'r', g), storage: storage.red, faction: factions.red }),
      };
      const result = runBotMatch({ seed: hashSeed(job.seed, 'game', g), config: preset, bots, factions, firstTurn: g % 2 ? 'red' : 'blue' });
      for (const p of PLAYERS) builder.add(result.match.viewFor(p));
    }
    return { kind: 'collect', tallies: builder.export() };
  }
  const out: DuelResult = { kind: 'duel', winsA: 0, winsB: 0, decisions: 0, thinkMs: 0 };
  const storeA = new MemoryStorage();
  const storeB = new MemoryStorage();
  for (let g = 0; g < job.games; g++) {
    const { preset, factions } = setup(job, job.seed, g);
    // Seats swap every game and starts every two, so both sides get every situation.
    const aIs: PlayerId = g % 2 === 0 ? 'blue' : 'red';
    const bIs: PlayerId = aIs === 'blue' ? 'red' : 'blue';
    const make = (spec: BotSpec, side: string, store: MemoryStorage, faction: FactionId) =>
      createBot(spec.level, {
        seed: hashSeed(job.seed, side, g),
        storage: store,
        faction,
        trained: spec.trained,
        ...(spec.params ? { params: spec.params } : {}),
        ...(spec.priors !== undefined ? { priors: spec.priors } : {}),
      });
    const bots = { [aIs]: make(job.a, 'a', storeA, factions[aIs]), [bIs]: make(job.b, 'b', storeB, factions[bIs]) } as Record<PlayerId, ReturnType<typeof createBot>>;
    const result = runBotMatch({
      seed: hashSeed(job.seed, 'game', g),
      config: preset,
      bots,
      factions,
      firstTurn: g % 4 < 2 ? 'blue' : 'red',
    });
    if (result.winner === aIs) out.winsA++;
    else if (result.winner === bIs) out.winsB++;
    out.decisions += result.decisions[aIs];
    out.thinkMs += result.thinkMs[aIs];
  }
  return out;
}

// ------------------------------------------------------------ main thread

function parseArgs(argv: readonly string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    const value = i >= 0 ? argv[i + 1] : undefined;
    return value !== undefined && !value.startsWith('--') ? value : undefined;
  };
  return {
    games: Number(get('games') ?? 160),
    final: Math.max(400, Number(get('final') ?? 400)),
    collect: Number(get('collect') ?? 240),
    generations: Number(get('generations') ?? 5),
    mutants: Number(get('mutants') ?? 4),
    levels: (get('levels') ?? '4,5').split(',').map(Number) as BotLevel[],
    presets: (get('presets') ?? 'classic,full,rapido,rapido-poderes').split(',') as PresetId[],
    factions: (get('factions') ?? 'neutra,egito,roma,grecia').split(',') as FactionId[],
    workers: Number(get('workers') ?? Math.max(1, availableParallelism() - 1)),
    seed: Number(get('seed') ?? 4242),
    skipPriors: argv.includes('--skip-priors'),
    skipSearch: argv.includes('--skip-search'),
  };
}

async function pool<T>(jobs: Job[], workers: number): Promise<T[]> {
  const results: T[] = [];
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(workers, jobs.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const current = job;
        results.push(
          await new Promise<T>((done, fail) => {
            const worker = new Worker(new URL(import.meta.url), { workerData: current });
            worker.on('message', (value) => done(value as T));
            worker.on('error', fail);
          }),
        );
      }
    }),
  );
  return results;
}

/** Plays `games` games of a against b, split into chunks over the workers. */
async function duel(a: BotSpec, b: BotSpec, games: number, seed: number, mix: Mix, workers: number): Promise<DuelResult> {
  const chunk = 20;
  const jobs: Job[] = [];
  for (let start = 0; start < games; start += chunk) {
    jobs.push({ kind: 'duel', a, b, games: Math.min(chunk, games - start), seed: hashSeed(seed, start), ...mix });
  }
  const parts = await pool<DuelResult>(jobs, workers);
  return parts.reduce(
    (s, p) => ({ kind: 'duel', winsA: s.winsA + p.winsA, winsB: s.winsB + p.winsB, decisions: s.decisions + p.decisions, thinkMs: s.thinkMs + p.thinkMs }),
    { kind: 'duel', winsA: 0, winsB: 0, decisions: 0, thinkMs: 0 } as DuelResult,
  );
}

const rateOf = (r: DuelResult) => r.winsA / Math.max(1, r.winsA + r.winsB);
/** Half-width of a 95% interval for a win rate over n games. */
const margin = (r: DuelResult) => 1.96 * Math.sqrt((rateOf(r) * (1 - rateOf(r))) / Math.max(1, r.winsA + r.winsB));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const say = (text: string) => process.stdout.write(`${text}\n`);

type Group = keyof BotParams;
const GROUP: Readonly<Record<number, Group>> = { 4: 'xadrez', 5: 'abismo' };

/** Multiplicative noise on every parameter of one group, kept inside its bounds. */
function mutate(group: Group, base: Record<string, number>, seed: number, scale: number): Record<string, number> {
  const rng = createRng(seed);
  const bounds = PARAM_BOUNDS[group] as Record<string, readonly [number, number]>;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(base)) {
    const [lo, hi] = bounds[key] ?? [-Infinity, Infinity];
    // Box-Muller from the seeded stream.
    const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng.next()))) * Math.cos(2 * Math.PI * rng.next());
    const moved = value === 0 ? g * scale : value * Math.exp(g * scale);
    out[key] = Math.round(Math.min(hi, Math.max(lo, moved)) * 1000) / 1000;
  }
  return out;
}

function save(name: string, data: unknown): void {
  mkdirSync(TRAINED_DIR, { recursive: true });
  writeFileSync(resolve(TRAINED_DIR, name), `${JSON.stringify(data, null, 1)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const mix: Mix = { presets: args.presets, factions: args.factions };
  const started = performance.now();
  say(`Treino: níveis ${args.levels.join(', ')}; presets ${args.presets.join(', ')}; facções ${args.factions.join(', ')}; ${args.workers} worker(s).`);

  // 1. Priors from self-play (public data only).
  let priorsVersion = TRAINED_PRIORS_VERSION;
  if (!args.skipPriors) {
    const jobs: Job[] = [];
    for (const level of args.levels) {
      for (let start = 0; start < args.collect; start += 20) {
        jobs.push({ kind: 'collect', level, games: Math.min(20, args.collect - start), seed: hashSeed(args.seed, 'collect', level, start), ...mix });
      }
    }
    const parts = await pool<CollectResult>(jobs, args.workers);
    const builder = new PriorBuilder();
    for (const p of parts) builder.merge(p.tallies);
    priorsVersion = TRAINED_PRIORS_VERSION + 1;
    const file = builder.build(priorsVersion);
    save('priors.json', file);
    say(`Priors v${priorsVersion}: ${Object.keys(file.shot).length} de tiro, ${Object.keys(file.search).length} de posicionamento (${args.collect * args.levels.length} partidas).`);
  }

  // 2. Parameter search, one group per level. Workers spawned from here on load the new priors.
  const previous: BotParams = TRAINED_PARAMS;
  const champion: { -readonly [G in Group]: Record<string, number> } = {
    xadrez: { ...previous.xadrez },
    abismo: { ...previous.abismo },
  };
  const history: { level: number; generation: number; mutant: number; rate: number; accepted: boolean }[] = [];
  if (!args.skipSearch) {
    for (const level of args.levels) {
      const group = GROUP[level];
      if (!group) continue;
      for (let gen = 0; gen < args.generations; gen++) {
        const scale = 0.25 * Math.pow(0.8, gen);
        let best: { params: Record<string, number>; result: DuelResult; index: number } | null = null;
        for (let m = 0; m < args.mutants; m++) {
          const params = mutate(group, champion[group], hashSeed(args.seed, 'mutant', level, gen, m), scale);
          const result = await duel(
            { level, trained: true, priors: true, params: { [group]: params } },
            { level, trained: true, priors: true, params: { [group]: champion[group] } },
            args.games,
            hashSeed(args.seed, 'search', level, gen),
            mix,
            args.workers,
          );
          if (!best || rateOf(result) > rateOf(best.result)) best = { params, result, index: m };
        }
        // Accept only a clear improvement; the bar is the 50% line plus noise.
        const accepted = best !== null && rateOf(best.result) - margin(best.result) / 2 > 0.5;
        if (best) history.push({ level, generation: gen, mutant: best.index, rate: rateOf(best.result), accepted });
        if (best && accepted) champion[group] = best.params;
        say(`  L${level} geração ${gen + 1}: melhor mutante ${pct(best ? rateOf(best.result) : 0)} contra o campeão ${accepted ? '→ aceito' : '(mantido)'}`);
      }
    }
  }
  const trainedParams: TrainedParamsFile['params'] = { xadrez: champion.xadrez, abismo: champion.abismo };

  // 3. Report. Per level, the trained version (parameters + priors) and the priors alone play the
  //    hand-made defaults; a level only ships what wins clearly (rate minus 95% margin above 50%).
  const report: Record<string, unknown>[] = [];
  // Levels not evaluated in this run keep what they had.
  const use: Record<string, TrainedUse> = { '4': trainedUse(4), '5': trainedUse(5) };
  const clear = (r: DuelResult) => rateOf(r) - margin(r) > 0.5;
  const summary = (r: DuelResult) => ({ wins: r.winsA, losses: r.winsB, rate: rateOf(r), margin95: margin(r) });
  for (const level of args.levels) {
    const group = GROUP[level];
    const full = await duel(
      { level, trained: true, priors: true, params: trainedParams },
      { level, trained: false },
      args.final,
      hashSeed(args.seed, 'final', level),
      mix,
      args.workers,
    );
    const priorsOnly = await duel(
      { level, trained: true, priors: true, params: { xadrez: { ...DEFAULT_PARAMS.xadrez }, abismo: { ...DEFAULT_PARAMS.abismo } } },
      { level, trained: false },
      args.final,
      hashSeed(args.seed, 'final', level),
      mix,
      args.workers,
    );
    let choice: TrainedUse = { params: false, priors: false };
    if (clear(full) && rateOf(full) >= rateOf(priorsOnly) - 0.01) choice = { params: group !== undefined, priors: true };
    else if (clear(priorsOnly)) choice = { params: false, priors: true };
    const chosen = choice.priors ? (choice.params ? full : priorsOnly) : null;
    say(`L${level} treinado (parâmetros + priors) × padrão: ${full.winsA}×${full.winsB} = ${pct(rateOf(full))} ± ${pct(margin(full))}`);
    say(`L${level} só priors × padrão: ${priorsOnly.winsA}×${priorsOnly.winsB} = ${pct(rateOf(priorsOnly))} ± ${pct(margin(priorsOnly))}`);
    say(`L${level} usa: parâmetros ${choice.params ? 'treinados' : 'padrão'}, priors ${choice.priors ? 'treinados' : 'desligados'}`);
    const entry: Record<string, unknown> = {
      level,
      gamesPerComparison: full.winsA + full.winsB,
      trainedVsDefault: summary(full),
      priorsOnlyVsDefault: summary(priorsOnly),
      use: choice,
      chosenVsDefault: chosen ? summary(chosen) : null,
      msPerDecision: full.thinkMs / Math.max(1, full.decisions),
    };
    // Contra a versão treinada anterior, quando existe e há algo novo para publicar.
    const before = trainedUse(level);
    if (TRAINED_PARAMS_VERSION > 0 && !args.skipSearch && choice.priors && (before.params || before.priors)) {
      const vsPrevious = await duel(
        { level, trained: true, priors: true, params: choice.params ? trainedParams : { ...DEFAULT_PARAMS } },
        { level, trained: true, priors: before.priors, params: before.params ? { xadrez: previous.xadrez, abismo: previous.abismo } : { ...DEFAULT_PARAMS } },
        args.final,
        hashSeed(args.seed, 'previous', level),
        mix,
        args.workers,
      );
      entry.vsPrevious = summary(vsPrevious);
      say(`L${level} novo × versão anterior (v${TRAINED_PARAMS_VERSION}): ${pct(rateOf(vsPrevious))} ± ${pct(margin(vsPrevious))}`);
      // Keep the previous version only when the new one is clearly worse.
      if (rateOf(vsPrevious) + margin(vsPrevious) < 0.5) {
        choice = before;
        entry.use = before;
        entry.keptPrevious = true;
        if (group) (trainedParams as Record<string, unknown>)[group] = { ...previous[group] };
      }
    }
    use[String(level)] = choice;
    report.push(entry);
  }

  const version = TRAINED_PARAMS_VERSION + 1;
  save('params.json', { version, params: trainedParams, use } satisfies TrainedParamsFile);
  save('report.json', {
    paramsVersion: version,
    priorsVersion,
    defaults: DEFAULT_PARAMS,
    params: trainedParams,
    use,
    presets: args.presets,
    factions: args.factions,
    searchGamesPerMutant: args.games,
    finalGames: args.final,
    search: history,
    results: report,
    seconds: Math.round((performance.now() - started) / 1000),
  });
  say(`Pronto em ${((performance.now() - started) / 1000).toFixed(0)} s. Arquivos em trained/.`);
}

if (isMainThread) {
  void main().catch((error: unknown) => {
    process.stdout.write(`${String(error)}\n`);
    process.exitCode = 2;
  });
} else {
  parentPort?.postMessage(runJob(workerData as Job));
}
