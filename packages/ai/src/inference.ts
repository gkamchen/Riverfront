import { createRng, neighbors4, type FieldConfig, type Rng } from '@riverfront/core';
import { DEAD, HIT, Knowledge, SPOTTED, UNKNOWN, footprints, type Footprint, type PieceKind } from './knowledge.ts';

export interface DensityOptions {
  /** Multiplier per known unit cell a footprint covers (target mode). */
  readonly hitWeight?: number;
  /** Per-cell multiplier, e.g. learned from the opponent's habits (mean ≈ 1). */
  readonly prior?: Float64Array | null;
  /** Boost for footprints crossing a line the spy pointed at. */
  readonly spyBoost?: number;
  readonly useRadar?: boolean;
}

function footprintPrior(fp: Footprint, prior: Float64Array | null | undefined): number {
  if (!prior) return 1;
  let product = 1;
  for (const c of fp.cells) product *= prior[c] ?? 1;
  return Math.pow(product, 1 / fp.cells.length);
}

/**
 * Classic placement-counting heat map: every legal position of every piece
 * still standing adds weight to the cells it covers.
 */
export function densityMap(k: Knowledge, options: DensityOptions = {}): Float64Array {
  const hitWeight = options.hitWeight ?? 40;
  const score = new Float64Array(k.n);
  for (const kind of k.remaining) {
    const required = k.spyRequired.filter((s) => s.role === kind.role);
    for (const fp of footprints(k.size, kind.role, kind.shape)) {
      if (!k.allows(kind.role, fp)) continue;
      let covered = 0;
      for (const c of fp.cells) if (k.status[c] === HIT || k.status[c] === SPOTTED) covered++;
      let w = kind.count * footprintPrior(fp, options.prior);
      if (covered > 0) w *= Math.pow(hitWeight, covered);
      if (required.length > 0 && required.some((r) => fp.cells.some((c) => r.cells.has(c)))) w *= options.spyBoost ?? 3;
      for (const c of fp.cells) score[c] = (score[c] ?? 0) + w;
    }
  }
  if (options.useRadar !== false) applyRadar(k, score);
  return score;
}

/** Radar counts above what we already know make the unknown cells around more likely. */
function applyRadar(k: Knowledge, score: Float64Array): void {
  const base = k.hiddenUnitCells() / Math.max(1, k.unknownCount());
  for (const r of k.radar) {
    let known = 0;
    const unknown: number[] = [];
    for (const c of r.cells) {
      const s = k.status[c];
      if (s === HIT || s === SPOTTED || (s === DEAD && (r.amphibians || k.deadRole[c] !== 'amphibian'))) known++;
      else if (s === UNKNOWN) unknown.push(c);
    }
    if (unknown.length === 0) continue;
    const need = r.count - known;
    const factor = need <= 0 ? 0.25 : Math.min(5, Math.max(0.5, need / unknown.length / Math.max(0.02, base)));
    for (const c of unknown) score[c] = (score[c] ?? 0) * factor;
  }
}

/**
 * Turns any non-negative score into hit chances: spotted cells are certain,
 * the unknown ones share the hidden unit cells in proportion to the score.
 */
export function toProbabilities(k: Knowledge, score: Float64Array): Float64Array {
  const prob = new Float64Array(k.n);
  let total = 0;
  for (let i = 0; i < k.n; i++) if (k.status[i] === UNKNOWN) total += score[i] ?? 0;
  const hidden = k.hiddenUnitCells();
  for (let i = 0; i < k.n; i++) {
    if (k.status[i] === SPOTTED) prob[i] = 1;
    else if (k.status[i] === UNKNOWN && total > 0) prob[i] = Math.min(1, ((score[i] ?? 0) / total) * hidden);
  }
  return prob;
}

export interface SampleOptions {
  readonly samples: number;
  /** Optional wall-clock cap; makes the result depend on machine speed. */
  readonly maxMs?: number;
  readonly prior?: Float64Array | null;
  readonly triesPerPiece?: number;
}

export interface SampleResult {
  /** Probability that each cell holds a unit, among sampled layouts. */
  readonly prob: Float64Array;
  readonly accepted: number;
  readonly attempts: number;
}

interface KindPlan {
  readonly kind: PieceKind;
  readonly allowed: readonly Footprint[];
  readonly weights: Float64Array;
  readonly maxWeight: number;
}

const SUPPORT = new Set(['bunker', 'antenna']);

/**
 * Monte Carlo over whole layouts consistent with the view: known unit cells
 * are covered first, then the other pieces are dropped at random. Radar and
 * spy facts weight each sample. Returns occupancy chances per cell.
 */
export function sampleLayouts(k: Knowledge, rng: Rng, options: SampleOptions): SampleResult {
  const n = k.n;
  const plans: KindPlan[] = k.remaining.map((kind) => {
    const allowed = footprints(k.size, kind.role, kind.shape).filter((fp) => k.allows(kind.role, fp));
    const weights = new Float64Array(allowed.map((fp) => footprintPrior(fp, options.prior)));
    return { kind, allowed, weights, maxWeight: Math.max(1e-9, ...weights) };
  });

  // For each known unit cell, every (kind, footprint) that covers it.
  const must = k.mustCells();
  const cover = new Map<number, [number, number][]>();
  for (const cell of must) cover.set(cell, []);
  plans.forEach((plan, ki) => {
    plan.allowed.forEach((fp, fi) => {
      for (const c of fp.cells) cover.get(c)?.push([ki, fi]);
    });
  });

  const prob = new Float64Array(n);
  const used = new Int8Array(n); // -1 free, otherwise kind index
  const avail = new Int32Array(plans.length);
  const tries = options.triesPerPiece ?? 40;
  const started = Date.now();
  let totalWeight = 0;
  let accepted = 0;
  let attempts = 0;
  // Big pieces first; generators last so their bunker or antenna is already down.
  const rank = (i: number) => (plans[i]!.kind.role === 'generator' ? -1 : plans[i]!.kind.shape.length);
  const order = plans.map((_, i) => i).sort((a, b) => rank(b) - rank(a));
  const mustOrder = [...must];
  const placed: { ki: number; fp: Footprint }[] = [];

  const fits = (ki: number, fp: Footprint): boolean => {
    for (const c of fp.cells) if (used[c] !== -1) return false;
    const sniper = plans[ki]!.kind.role === 'sniper';
    for (const r of fp.ring) {
      const owner = used[r]!;
      if (owner === -1) continue;
      if (sniper || plans[owner]!.kind.role === 'sniper') return false;
    }
    return true;
  };
  const put = (ki: number, fp: Footprint) => {
    for (const c of fp.cells) used[c] = ki;
    placed.push({ ki, fp });
    avail[ki] = (avail[ki] ?? 0) - 1;
  };
  const supported = (fp: Footprint): boolean =>
    fp.ring.some((r) => {
      const owner = used[r]!;
      if (owner !== -1) return SUPPORT.has(plans[owner]!.kind.role);
      const dead = k.deadRole[r];
      return dead !== null && dead !== undefined && SUPPORT.has(dead);
    });
  const tryPlace = (ki: number, fi: number): boolean => {
    const plan = plans[ki]!;
    const fp = plan.allowed[fi]!;
    if ((avail[ki] ?? 0) <= 0 || !fits(ki, fp)) return false;
    if (options.prior && rng.next() * plan.maxWeight > (plan.weights[fi] ?? 0)) return false;
    put(ki, fp);
    return true;
  };

  for (let s = 0; s < options.samples * 6 && accepted < options.samples; s++) {
    if (options.maxMs !== undefined && (s & 15) === 0 && Date.now() - started > options.maxMs && accepted > 0) break;
    // Hopeless constraints (almost every draw rejected): stop early, the caller falls back to density.
    if (s >= options.samples * 2 && accepted * 10 < s) break;
    attempts++;
    used.fill(-1);
    placed.length = 0;
    plans.forEach((plan, i) => (avail[i] = plan.kind.count));
    rng.shuffle(mustOrder);
    let ok = true;

    for (const cell of mustOrder) {
      if (used[cell] !== -1) continue;
      const choices = cover.get(cell) ?? [];
      let done = false;
      for (let t = 0; t < tries && choices.length > 0; t++) {
        const [ki, fi] = choices[rng.int(choices.length)]!;
        if (tryPlace(ki, fi)) {
          done = true;
          break;
        }
      }
      if (!done) {
        ok = false;
        break;
      }
    }

    for (let oi = 0; ok && oi < order.length; oi++) {
      const ki = order[oi]!;
      const plan = plans[ki]!;
      while (ok && (avail[ki] ?? 0) > 0) {
        let done = false;
        if (plan.kind.role === 'generator') {
          // Only spots next to a bunker or antenna are legal; list them instead of guessing.
          const spots: number[] = [];
          plan.allowed.forEach((fp, fi) => {
            if (supported(fp) && fits(ki, fp)) spots.push(fi);
          });
          for (let t = 0; t < tries && spots.length > 0; t++) {
            if (tryPlace(ki, spots[rng.int(spots.length)]!)) {
              done = true;
              break;
            }
          }
        } else {
          for (let t = 0; t < tries && plan.allowed.length > 0; t++) {
            if (tryPlace(ki, rng.int(plan.allowed.length))) {
              done = true;
              break;
            }
          }
        }
        if (!done) ok = false;
      }
    }
    if (!ok) continue;

    // Generators must lean on a bunker or an antenna (standing or fallen).
    let weight = 1;
    for (const { ki, fp } of placed) {
      if (plans[ki]!.kind.role === 'generator' && !supported(fp)) weight = 0;
    }
    if (weight === 0) continue;

    for (const r of k.radar) {
      let count = 0;
      for (const c of r.cells) {
        const owner = used[c]!;
        const role = owner !== -1 ? plans[owner]!.kind.role : k.deadRole[c];
        if (role !== null && role !== undefined && (r.amphibians || role !== 'amphibian')) count++;
      }
      weight *= Math.exp(-1.6 * Math.abs(count - r.count));
    }
    for (const req of k.spyRequired) {
      const hit = placed.some(({ ki, fp }) => plans[ki]!.kind.role === req.role && fp.cells.some((c) => req.cells.has(c)));
      if (!hit) weight *= 0.15;
    }

    accepted++;
    totalWeight += weight;
    for (let c = 0; c < n; c++) if (used[c] !== -1) prob[c] = (prob[c] ?? 0) + weight;
  }

  if (totalWeight > 0) for (let c = 0; c < n; c++) prob[c] = (prob[c] ?? 0) / totalWeight;
  return { prob, accepted, attempts };
}

const blankCache = new Map<string, Float64Array>();

/**
 * Where units tend to be on a field nobody has touched, assuming every legal
 * position is equally likely. Normalised to mean 1.
 */
export function blankPrior(config: FieldConfig): Float64Array {
  const key = JSON.stringify([config.cols, config.rows, config.units]);
  const cached = blankCache.get(key);
  if (cached) return cached;
  const view = blankView(config);
  const k = Knowledge.fromView(view);
  const density = densityMap(k, { useRadar: false });
  const mean = density.reduce((a, b) => a + b, 0) / density.length;
  const out = density.map((v) => v / mean);
  blankCache.set(key, out);
  return out;
}

/** Smallest view-like object Knowledge needs for an untouched enemy field. */
function blankView(config: FieldConfig) {
  const cells = Array.from({ length: config.cols * config.rows }, (_, i) => ({
    col: i % config.cols,
    row: Math.floor(i / config.cols),
    state: 'hidden' as const,
    role: null,
    shield: false,
  }));
  const counts = new Map<string, number>();
  for (const u of config.units) counts.set(u.role, (counts.get(u.role) ?? 0) + u.count);
  return {
    config,
    history: [],
    intel: { radar: [], spy: [] },
    enemy: {
      cells,
      shieldActive: false,
      unitCellsLeft: 0,
      remaining: [...counts].map(([role, count]) => ({ role, count })),
    },
  } as unknown as Parameters<typeof Knowledge.fromView>[0];
}

/** Tilts the cells around wrecks by how bunched the enemy turned out to be so far. */
export function withClusterBias(k: Knowledge, prob: Float64Array): Float64Array {
  const factor = k.clusterFactor();
  if (Math.abs(factor - 1) < 0.05) return prob;
  const out = prob.slice();
  for (const c of k.wreckRing()) out[c] = Math.min(1, (out[c] ?? 0) * factor);
  return out;
}

/** Mean of the chance over a cell's neighbourhood, used to break ties smoothly. */
export function neighbourMean(k: Knowledge, prob: Float64Array, cell: number): number {
  const ns = neighbors4(k.size, cell);
  return ns.reduce((sum, c) => sum + (prob[c] ?? 0), 0) / Math.max(1, ns.length);
}

/** Deterministic default rng for helpers called without one. */
export function rngFor(...parts: number[]): Rng {
  return createRng(parts.reduce((h, p) => Math.imul(h ^ p, 0x9e3779b1) >>> 0, 0x1234567));
}
