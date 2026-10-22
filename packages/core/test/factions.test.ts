import { describe, expect, it } from 'vitest';
import {
  ABILITIES,
  ENERGY,
  FACTIONS,
  FACTION_BUDGET,
  FACTION_IDS,
  Match,
  ROLES,
  extraPieceFor,
  factionPower,
  factionsOfWave,
  modifiersFor,
  indexOf,
  neighbors4,
  plusShape,
  resolveFaction,
  startAutoMatch,
  type FactionId,
} from '../src/index.ts';
import { cellsOf, miss, piecesOf, ready, sameCoord, skipTurns, terrainCells } from './helpers.ts';

const SIZE = { cols: 25, rows: 7 };

describe('faction registry', () => {
  it('lists every faction of the roadmap with its wave and archetype', () => {
    const expected: Record<string, [number, string]> = {
      egito: [1, 'informacao'],
      roma: [1, 'defesa'],
      grecia: [1, 'ataque'],
      vikings: [2, 'tempo'],
      japoneses: [2, 'informacao'],
      chineses: [2, 'ataque'],
      persas: [2, 'energia'],
      mongois: [3, 'tempo'],
      otomanos: [3, 'ataque'],
      maias: [3, 'informacao'],
      astecas: [3, 'energia'],
      incas: [3, 'defesa'],
      celtas: [3, 'informacao'],
      cartagineses: [3, 'energia'],
      assirios: [4, 'ataque'],
      babilonios: [4, 'informacao'],
      arabes: [4, 'tempo'],
      bizantinos: [4, 'defesa'],
      indianos: [4, 'ataque'],
      hunos: [4, 'tempo'],
      partos: [4, 'ataque'],
      macedonios: [4, 'ataque'],
      espartanos: [4, 'defesa'],
    };
    expect(FACTION_IDS.filter((id) => id !== 'neutra').sort()).toEqual(Object.keys(expected).sort());
    for (const [id, [wave, archetype]] of Object.entries(expected)) {
      const f = FACTIONS[id as FactionId];
      expect(f.wave).toBe(wave);
      expect(f.archetype).toBe(archetype);
      expect(f.leader.name.length).toBeGreaterThan(3);
      expect(f.leader.title.length).toBeGreaterThan(3);
      expect(f.specialShot).not.toBeNull();
    }
    expect(factionsOfWave(1).map((f) => f.id)).toEqual(['egito', 'roma', 'grecia']);
  });

  it('every faction spends exactly the same power budget', () => {
    for (const id of FACTION_IDS) {
      if (id === 'neutra') continue;
      expect([id, factionPower(FACTIONS[id])]).toEqual([id, FACTION_BUDGET]);
    }
    expect(factionPower(FACTIONS.neutra)).toBe(0);
  });

  it('resolves ids, accepts full definitions and refuses unknown ids', () => {
    expect(resolveFaction(undefined).id).toBe('neutra');
    expect(resolveFaction('roma').leader.title).toContain('Legado');
    expect(resolveFaction(FACTIONS.egito)).toBe(FACTIONS.egito);
    expect(() => resolveFaction('atlantes' as FactionId)).toThrow();
  });
});

describe('mode overrides', () => {
  it('special shot costs and ability deltas can change per preset; the budget uses the base numbers', () => {
    const full = startAutoMatch({ seed: 3, factions: { blue: 'hunos', red: 'grecia' } });
    const quick = startAutoMatch({ seed: 3, config: 'rapido-poderes', factions: { blue: 'hunos', red: 'grecia' } });
    expect(full.viewFor('blue').own.faction?.special).toMatchObject({ kind: 'ricochet', energy: 1, cooldown: 1 });
    expect(quick.viewFor('blue').own.faction?.special).toMatchObject({ kind: 'ricochet', energy: 3, cooldown: 2 });
    const bombCooldown = (m: Match) => m.viewFor('red').own.abilities.find((a) => a.id === 'bomb')!.cooldown;
    expect(bombCooldown(full)).toBe(ABILITIES.bomb.cooldownWith!.cooldown);
    expect(bombCooldown(quick)).toBe(ABILITIES.bomb.cooldownWith!.cooldown - 1);
    expect(quick.piecesOf('red').some((p) => p.role === 'tower')).toBe(true);
    expect(factionPower(FACTIONS.grecia)).toBe(FACTION_BUDGET);
  });

  it('a mode can drop the extra piece', () => {
    const def = { ...FACTIONS.grecia, id: 'teste', modes: { rapido: { extraPiece: null } } };
    expect(extraPieceFor(def, 'rapido')).toBeNull();
    expect(extraPieceFor(def, 'full')).toEqual({ role: 'tower', count: 1 });
    expect(modifiersFor(FACTIONS.grecia, 'rapido-poderes')).toEqual({ bomb: { cooldown: -1 } });
  });
});

describe('neutral default', () => {
  it('a match without factions is exactly a neutral-vs-neutral match', () => {
    for (const seed of [1, 2, 3]) {
      const a = startAutoMatch({ seed });
      const b = startAutoMatch({ seed, factions: { blue: 'neutra', red: 'neutra' } });
      for (let i = 0; i < 6; i++) {
        miss(a);
        miss(b);
      }
      expect(b.serverState()).toEqual(a.serverState());
      expect(b.viewFor('blue').own.faction?.special).toBeNull();
    }
  });

  it('factions are cosmetic in the classic preset', () => {
    const match = ready({ seed: 2, config: 'classic', factions: { blue: 'grecia', red: 'roma' } });
    const view = match.viewFor('blue');
    expect(view.own.faction).toMatchObject({ id: 'grecia', active: false, special: null, tower: null });
    expect(view.own.pieces.some((p) => p.role === 'tower')).toBe(false);
    expect(match.special('blue', { target: { col: 3, row: 3 } })).toEqual({ ok: false, error: 'no-special' });
  });
});

describe('Egypt (information)', () => {
  it('radar is cheaper and also counts amphibians; the spy keeps its ranking', () => {
    const match = ready({ seed: 7, factions: { blue: 'egito' } });
    const radar = match.viewFor('blue').own.abilities.find((a) => a.id === 'radar')!;
    expect(radar.cost).toBe(ABILITIES.radar.cost - 1);
    const amph = cellsOf(match, 'red', 'amphibian')[0]!;
    const red = match.viewFor('red').own.cells;
    const expected = [-1, 0, 1]
      .flatMap((dr) => [-1, 0, 1].map((dc) => ({ col: amph.col + dc, row: amph.row + dr })))
      .filter((c) => c.col >= 0 && c.row >= 0 && c.col < 25 && c.row < 7)
      .filter((c) => red[indexOf(SIZE, c)]!.role !== null).length;
    const result = match.useAbility('blue', { ability: 'radar', target: amph });
    expect(result.ok && result.outcome.ability === 'radar' && result.outcome.count).toBe(expected);
    expect(match.viewFor('blue').intel.radar[0]?.amphibians).toBe(true);
    const spy = match.viewFor('blue').own.abilities.find((a) => a.id === 'spy')!;
    expect(spy.cooldown).toBe(ABILITIES.spy.cooldown);
    expect(FACTIONS.egito.passives.spyRanked).toBe(true);
  });
});

describe('Rome (defence)', () => {
  it('cheaper shield and repair, more energy per kill', () => {
    const match = ready({ seed: 5, factions: { blue: 'roma' } });
    const abilities = match.viewFor('blue').own.abilities;
    expect(abilities.find((a) => a.id === 'shield')?.cost).toBe(ABILITIES.shield.cost - 1);
    expect(abilities.find((a) => a.id === 'repair')?.cost).toBe(ABILITIES.repair.cost - 1);
    const before = match.viewFor('blue').own.energy;
    const recruit = match.viewFor('red').own.pieces.find((p) => p.role === 'recruit')!;
    match.attack('blue', recruit.cells[0]!);
    expect(match.viewFor('blue').own.energy).toBe(before + ENERGY.perKill + 1);
  });

  it('testudo: the first hit on the bunker or a piece touching it is absorbed, once per match', () => {
    const match = ready({ seed: 9, factions: { red: 'roma' } });
    const bunker = piecesOf(match, 'red', 'bunker')[0]!;
    const first = match.attack('blue', bunker.cells[0]!);
    expect(first.ok && first.outcome.result).toBe('shield');
    expect(first.ok && first.outcome.absorbedBy).toBe('testudo');
    expect(first.ok && first.outcome.extraShot).toBe(false);
    expect(match.viewFor('red').own.faction?.testudo).toEqual({ used: true });
    expect(match.viewFor('blue').enemy.faction?.testudo).toEqual({ used: true });
    expect(match.viewFor('blue').enemy.cells[indexOf(SIZE, bunker.cells[0]!)]).toMatchObject({ state: 'spotted', shield: true });
    miss(match);
    const second = match.attack('blue', bunker.cells[0]!);
    expect(second.ok && second.outcome.result).toBe('hit');
  });

  it('testudo does not cover pieces away from the bunker', () => {
    const match = ready({ seed: 9, factions: { red: 'roma' } });
    const view = match.viewFor('red');
    const bunkerCells = new Set(piecesOf(match, 'red', 'bunker')[0]!.cells.map((c) => indexOf(SIZE, c)));
    const far = view.own.pieces.find(
      (p) => p.role !== 'bunker' && p.cells.every((c) => neighbors4(SIZE, indexOf(SIZE, c)).every((n) => !bunkerCells.has(n))),
    )!;
    const shot = match.attack('blue', far.cells[0]!);
    expect(shot.ok && ['hit', 'destroyed'].includes(shot.outcome.result)).toBe(true);
    expect(match.viewFor('red').own.faction?.testudo).toEqual({ used: false });
  });
});

describe('Greece (attack)', () => {
  it('brings a tower: one more piece and one more unit cell, visible to both', () => {
    const match = ready({ seed: 4, factions: { blue: 'grecia' } });
    expect(match.piecesOf('blue')).toHaveLength(14);
    expect(match.piecesOf('red')).toHaveLength(13);
    expect(match.viewFor('blue').own.unitCellsTotal).toBe(25);
    expect(match.viewFor('red').enemy.unitCellsTotal).toBe(25);
    expect(match.viewFor('red').enemy.remaining).toContainEqual({ role: 'tower', count: 1 });
    expect(match.viewFor('red').enemy.units).toContainEqual({ role: 'tower', count: 1 });
    const tower = piecesOf(match, 'blue', 'tower')[0]!;
    expect(tower.cells[0]!.row).toBeGreaterThanOrEqual(5);
  });

  it('the bomb is not stopped by a rock in the centre; energy cap is higher', () => {
    const match = ready({ seed: 8, factions: { blue: 'grecia' } });
    skipTurns(match, 2);
    const red = match.viewFor('red').own.cells;
    const rock = terrainCells(match, 'red', 'rock').find((c) =>
      plusShape(SIZE, indexOf(SIZE, c)).length === 5 && plusShape(SIZE, indexOf(SIZE, c)).every((i) => !red[i]!.struck),
    )!;
    const result = match.useAbility('blue', { ability: 'bomb', target: rock });
    expect(result.ok && result.outcome.ability === 'bomb' && result.outcome.shots).toHaveLength(5);
    skipTurns(match, 30);
    expect(match.viewFor('blue').own.energy).toBe(ENERGY.max + 1);
  });

  it('tower value tops the spy ranking and it must stay in the rear rows', () => {
    expect(Math.max(...Object.values(ROLES).map((r) => r.value))).toBe(ROLES.tower.value);
    const match = new Match({ seed: 3, factions: { blue: 'grecia' } });
    const terrain = match.viewFor('blue').own.cells;
    const front = terrain.find((c) => c.row === 2 && c.terrain === 'earth')!;
    expect(match.place('blue', 'tower-1', front)).toEqual({ ok: false, error: 'rear-only' });
    const back = terrain.find((c) => c.row === 6 && c.terrain === 'earth')!;
    expect(match.place('blue', 'tower-1', back)).toEqual({ ok: true });
    expect(sameCoord(match.viewFor('blue').own.pieces.find((p) => p.id === 'tower-1')!.cells[0]!, back)).toBe(true);
  });
});
