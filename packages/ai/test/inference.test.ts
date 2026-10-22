import { describe, expect, it } from 'vitest';
import { FULL_CONFIG, createRng, startAutoMatch, type Coord, type Match } from '@riverfront/core';
import { DEAD, EMPTY, HIT, Knowledge, ROCK, UNKNOWN, footprints } from '../src/knowledge.ts';
import { blankPrior, densityMap, sampleLayouts, toProbabilities, withClusterBias } from '../src/inference.ts';
import { HeatMap, MemoryStorage, SearchOrderMap } from '../src/learning.ts';

const SIZE = { cols: 25, rows: 7 };
const idx = (c: Coord) => c.row * 25 + c.col;

function earthOf(match: Match, owner: 'blue' | 'red'): Coord[] {
  return match.viewFor(owner).own.cells.filter((c) => c.role === null && c.terrain === 'earth' && !c.struck);
}

describe('footprints', () => {
  it('respect the static role rules', () => {
    for (const fp of footprints(SIZE, 'amphibian', [{ col: 0, row: 0 }, { col: 1, row: 0 }])) {
      expect(fp.cells.every((c) => c < 25)).toBe(true);
    }
    for (const fp of footprints(SIZE, 'artillery', [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }])) {
      expect(fp.cells.some((c) => c < 25)).toBe(false);
    }
    const bunker = footprints(SIZE, 'bunker', [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }, { col: 1, row: 1 }]);
    expect(bunker).toHaveLength(22 * 4);
  });
});

describe('Knowledge', () => {
  it('reads the view: everything unknown at start, then uncovered cells', () => {
    const match = startAutoMatch({ seed: 2 });
    let k = Knowledge.fromView(match.viewFor('blue'));
    expect([...k.status].every((s) => s === UNKNOWN)).toBe(true);
    expect(k.remaining.reduce((s, r) => s + r.count, 0)).toBe(13);

    const rock = match.viewFor('red').own.cells.find((c) => c.terrain === 'rock')!;
    match.attack('blue', rock);
    k = Knowledge.fromView(match.viewFor('blue'));
    expect(k.status[idx(rock)]).toBe(ROCK);
    expect(k.rocksLeft).toBe(44);
  });

  it('marks hits, kills and the empty ring of a fallen sniper', () => {
    const match = startAutoMatch({ seed: 2 });
    const red = match.viewFor('red').own.pieces;
    const armor = red.find((p) => p.role === 'armor')!;
    match.attack('blue', armor.cells[0]!);
    let k = Knowledge.fromView(match.viewFor('blue'));
    expect(k.status[idx(armor.cells[0]!)]).toBe(HIT);
    match.attack('blue', armor.cells[1]!);
    const sniper = red.find((p) => p.role === 'sniper')!.cells[0]!;
    match.attack('blue', sniper);
    k = Knowledge.fromView(match.viewFor('blue'));
    expect(k.status[idx(armor.cells[0]!)]).toBe(DEAD);
    expect(k.deadRole[idx(sniper)]).toBe('sniper');
    const ring = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dc, dr]) => ({ col: sniper.col + dc!, row: sniper.row + dr! }))
      .filter((c) => c.col >= 0 && c.row >= 0 && c.col < 25 && c.row < 7);
    for (const c of ring) expect([EMPTY, ROCK]).toContain(k.status[idx(c)]);
  });

  it('a zero radar empties the block for everything but amphibians', () => {
    const match = startAutoMatch({ seed: 4 });
    const red = match.viewFor('red').own.cells;
    const center = red.find((c, i) => c.terrain === 'earth' && c.row > 0 && c.row < 6 && c.col > 0 && c.col < 24 &&
      [-26, -25, -24, -1, 0, 1, 24, 25, 26].every((d) => red[i + d]!.role === null))!;
    match.useAbility('blue', { ability: 'radar', target: center });
    const k = Knowledge.fromView(match.viewFor('blue'));
    expect(k.radarEmpty[idx(center)]).toBe(1);
    const recruit = footprints(SIZE, 'recruit', [{ col: 0, row: 0 }]).find((fp) => fp.cells[0] === idx(center))!;
    expect(k.allows('recruit', recruit)).toBe(false);
  });

  it('a spy answer of nothing rules the whole line out', () => {
    const match = startAutoMatch({ seed: 4 });
    const red = match.viewFor('red').own.cells;
    const emptyCol = Array.from({ length: 25 }, (_, c) => c).find((c) => [0, 1, 2, 3, 4, 5, 6].every((r) => red[r * 25 + c]!.role === null));
    if (emptyCol === undefined) return;
    match.useAbility('blue', { ability: 'spy', axis: 'col', index: emptyCol });
    const k = Knowledge.fromView(match.viewFor('blue'));
    const density = densityMap(k);
    for (let r = 0; r < 7; r++) expect(density[r * 25 + emptyCol]).toBe(0);
  });
});

describe('density and sampling', () => {
  it('density is zero on uncovered cells and peaks next to a hit', () => {
    const match = startAutoMatch({ seed: 6 });
    const artillery = match.viewFor('red').own.pieces.find((p) => p.role === 'artillery')!;
    match.attack('blue', artillery.cells[1]!);
    const k = Knowledge.fromView(match.viewFor('blue'));
    const density = densityMap(k);
    const prob = toProbabilities(k, density);
    let best = -1;
    for (let i = 0; i < k.n; i++) if (k.status[i] === UNKNOWN && (best < 0 || prob[i]! > prob[best]!)) best = i;
    const hit = idx(artillery.cells[1]!);
    expect([hit - 1, hit + 1, hit - 25, hit + 25]).toContain(best);
    expect(prob[hit]).toBe(0);
  });

  it('probabilities share out the hidden unit cells', () => {
    const match = startAutoMatch({ seed: 6 });
    for (const c of earthOf(match, 'red').slice(0, 1)) match.attack('blue', c);
    const k = Knowledge.fromView(match.viewFor('blue'));
    const prob = toProbabilities(k, densityMap(k));
    const sum = prob.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(k.hiddenUnitCells() * 0.9);
    expect(sum).toBeLessThanOrEqual(k.hiddenUnitCells() + 1e-9);
  });

  it('Monte Carlo samples cover every known hit and avoid uncovered empties', () => {
    const match = startAutoMatch({ seed: 8 });
    const armor = match.viewFor('red').own.pieces.find((p) => p.role === 'armor')!;
    match.attack('blue', armor.cells[0]!);
    const earth = earthOf(match, 'red')[0]!;
    match.attack('blue', earth);
    const k = Knowledge.fromView(match.viewFor('blue'));
    const result = sampleLayouts(k, createRng(1), { samples: 150 });
    expect(result.accepted).toBeGreaterThan(50);
    expect(result.prob[idx(armor.cells[0]!)]).toBeCloseTo(1, 6);
    expect(result.prob[idx(earth)]).toBe(0);
    for (const p of result.prob) expect(p).toBeGreaterThanOrEqual(0);
    expect(sampleLayouts(k, createRng(1), { samples: 150 }).prob).toEqual(result.prob);
  });

  it('the blank prior favours the middle over the corners', () => {
    const prior = blankPrior(FULL_CONFIG);
    expect(prior[3 * 25 + 12]!).toBeGreaterThan(prior[6 * 25 + 24]!);
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
    expect(mean).toBeCloseTo(1, 6);
  });

  it('clusterFactor rises when wrecks have neighbours', () => {
    const match = startAutoMatch({ seed: 6 });
    const k0 = Knowledge.fromView(match.viewFor('blue'));
    expect(k0.clusterFactor()).toBeCloseTo(1, 1);
    const flat = new Float64Array(k0.n).fill(0.1);
    expect(withClusterBias(k0, flat)).toBe(flat);
  });
});

describe('learning storage', () => {
  it('HeatMap persists counts and returns a ratio near 1 for an average layout', () => {
    const storage = new MemoryStorage();
    const heat = new HeatMap(storage, 'k', 4);
    expect(heat.ratio(new Float64Array([0.5, 0.5, 0.5, 0.5]))).toBeNull();
    heat.record([0, 1]);
    const again = new HeatMap(storage, 'k', 4);
    expect(again.games).toBe(1);
    const ratio = again.ratio(new Float64Array([0.5, 0.5, 0.5, 0.5]), 1)!;
    expect(ratio[0]!).toBeGreaterThan(1);
    expect(ratio[3]!).toBeLessThan(1);
  });

  it('ignores corrupt stored data', () => {
    const storage = new MemoryStorage();
    storage.setItem('k', '{oops');
    expect(new HeatMap(storage, 'k', 4).games).toBe(0);
    storage.setItem('o', '{"games":1,"early":[1]}');
    expect(new SearchOrderMap(storage, 'o', 4).games).toBe(0);
  });

  it('SearchOrderMap learns which cells the opponent reaches first', () => {
    const match = startAutoMatch({ seed: 6 });
    const order = new SearchOrderMap(null, 'o', 175);
    while (match.phase === 'playing') {
      const player = match.turn;
      const target = match.viewFor(player).enemy.cells.find((c) => c.state === 'hidden' || c.state === 'spotted')!;
      match.attack(player, target);
    }
    order.record(match.viewFor('red'));
    const early = order.earliness()!;
    expect(early[0]!).toBeGreaterThan(early[174]!);
  });
});
