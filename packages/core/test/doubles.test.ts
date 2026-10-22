import { describe, expect, it } from 'vitest';
import {
  SEATS,
  TeamMatch,
  createRng,
  partnerOf,
  seatForTurn,
  seatsOf,
  teamOf,
  type SeatId,
  type TeamMatchOptions,
} from '../src/index.ts';

function started(options: Partial<TeamMatchOptions> = {}): TeamMatch {
  const tm = new TeamMatch({ seed: 5, ...options });
  for (const seat of SEATS) {
    expect(tm.autoPlace(seat).ok).toBe(true);
  }
  for (const seat of SEATS) expect(tm.confirm(seat)).toEqual({ ok: true });
  return tm;
}

/** The seat on turn misses (first open earth cell of the enemy field, away from the bank). */
function miss(tm: TeamMatch): void {
  const seat = tm.seatOnTurn!;
  const view = tm.viewFor(seat);
  const enemyTeam = teamOf(seat) === 'blue' ? 'red' : 'blue';
  const enemyView = tm.viewFor(seatsOf(enemyTeam)[0]);
  const earth = enemyView.own.cells.find((c, i) => c.role === null && c.terrain === 'earth' && !c.struck && c.row > 0 && view.enemy.cells[i]!.state === 'hidden')!;
  const r = tm.attack(seat, earth);
  if (!r.ok) throw new Error(r.error);
}

/** Random legal play, seat by seat, until the end. */
function playOut(tm: TeamMatch, seed: number): void {
  const rng = createRng(seed);
  for (let guard = 0; guard < 4000 && tm.phase === 'playing'; guard++) {
    const seat = tm.seatOnTurn!;
    const view = tm.viewFor(seat);
    const special = view.own.faction?.special;
    if (special?.ready && rng.next() < 0.3) {
      const t = rng.pick(view.enemy.cells.filter((c) => c.state === 'hidden'));
      tm.special(seat, { target: { col: t.col, row: t.row } });
      continue;
    }
    const open = view.enemy.cells.filter((c) => c.state === 'hidden' || c.state === 'spotted');
    const ok = rng.shuffle([...open]).some((c) => tm.attack(seat, { col: c.col, row: c.row }).ok);
    if (!ok) tm.surrender(seat);
  }
}

describe('doubles: seats and placement', () => {
  it('seat helpers and the interleaved order A1, B1, A2, B2', () => {
    expect(SEATS.map(partnerOf)).toEqual(['blue-2', 'blue-1', 'red-2', 'red-1']);
    expect([1, 2, 3, 4, 5].map((n) => seatForTurn(n, 'blue'))).toEqual(['blue-1', 'red-1', 'blue-2', 'red-2', 'blue-1']);
    expect([1, 2, 3, 4].map((n) => seatForTurn(n, 'red'))).toEqual(['red-1', 'blue-1', 'red-2', 'blue-2']);
  });

  it('each partner places about half of the team and only its own pieces', () => {
    const tm = new TeamMatch({ seed: 2 });
    const one = tm.piecesOfSeat('blue-1');
    const two = tm.piecesOfSeat('blue-2');
    expect(one.length + two.length).toBe(13);
    expect(Math.abs(one.length - two.length)).toBeLessThanOrEqual(1);
    expect(one.map((p) => p.role)).toEqual(expect.arrayContaining(['bunker', 'antenna', 'generator']));
    const cell = tm.viewFor('blue-1').own.cells.find((c) => c.terrain === 'earth' && c.row > 2)!;
    expect(tm.place('blue-1', two[0]!.id, cell)).toEqual({ ok: false, error: 'not-your-piece' });
    expect(tm.place('blue-1', 'nada-1', cell)).toEqual({ ok: false, error: 'unknown-piece' });
  });

  it('the match starts only when all four confirmed; a seat cannot confirm with own pieces missing', () => {
    const tm = new TeamMatch({ seed: 3 });
    expect(tm.confirm('blue-2')).toEqual({ ok: false, error: 'layout-incomplete' });
    for (const seat of SEATS) tm.autoPlace(seat);
    tm.confirm('blue-1');
    tm.confirm('blue-2');
    tm.confirm('red-1');
    expect(tm.phase).toBe('placing');
    expect(tm.viewFor('red-2').doubles.team[0].confirmed).toBe(true);
    tm.confirm('red-2');
    expect(tm.phase).toBe('playing');
    expect(tm.seatOnTurn).toBe('blue-1');
  });
});

describe('doubles: turns, shared energy and intel', () => {
  it('only the seat on turn acts and the order rotates through the four seats', () => {
    const tm = started();
    const seen: SeatId[] = [];
    for (let i = 0; i < 8; i++) {
      const seat = tm.seatOnTurn!;
      seen.push(seat);
      expect(tm.attack(partnerOf(seat), { col: 0, row: 3 })).toEqual({ ok: false, error: 'not-your-turn' });
      miss(tm);
    }
    expect(seen).toEqual(['blue-1', 'red-1', 'blue-2', 'red-2', 'blue-1', 'red-1', 'blue-2', 'red-2']);
  });

  it('energy is the team\'s and the radar of one partner shows for the other', () => {
    const tm = started({ seed: 7 });
    const energy = () => tm.viewFor('blue-2').own.energy;
    const before = energy();
    miss(tm); // blue-1
    miss(tm); // red-1: blue-2 starts and the team gains energy
    expect(energy()).toBe(before + 1);
    const r = tm.useAbility('blue-2', { ability: 'radar', target: { col: 10, row: 3 } });
    expect(r.ok).toBe(true);
    expect(tm.viewFor('blue-1').intel.radar).toHaveLength(1);
    expect(tm.viewFor('blue-1').own.energy).toBe(tm.viewFor('blue-2').own.energy);
    expect(tm.viewFor('red-1').intel.radar).toHaveLength(0);
  });
});

describe('doubles: secrecy', () => {
  it('a seat view does not depend on the hidden enemy layout; the partner sees the team field', () => {
    const make = (redSeeds: [number, number]) => {
      const tm = new TeamMatch({ seed: 11, factions: { blue: 'egito', red: 'grecia' }, mutators: ['mare'] });
      tm.autoPlace('blue-1', 1);
      tm.autoPlace('blue-2', 2);
      tm.autoPlace('red-1', redSeeds[0]);
      tm.autoPlace('red-2', redSeeds[1]);
      for (const s of SEATS) tm.confirm(s);
      return tm;
    };
    const a = make([100, 200]);
    const b = make([300, 400]);
    expect(JSON.stringify(a.viewFor('red-1').own.pieces)).not.toBe(JSON.stringify(b.viewFor('red-1').own.pieces));
    for (const seat of ['blue-1', 'blue-2'] as const) expect(JSON.stringify(b.viewFor(seat))).toBe(JSON.stringify(a.viewFor(seat)));
    const view = a.viewFor('blue-2');
    expect(view.own.pieces.every((p) => p.placement !== null)).toBe(true);
    for (const cell of view.enemy.cells) expect(cell).toEqual({ col: cell.col, row: cell.row, state: 'hidden', role: null, shield: false });
    expect(JSON.stringify(view.doubles.enemy)).not.toContain('pieces');
  });
});

describe('doubles: clocks, full flow and replay', () => {
  it('timeouts count per seat; three in a row from one seat lose the match for the team', () => {
    const tm = started({ clock: 'relampago' });
    // Every seat times out once; blue-1 keeps timing out.
    let now = 0;
    for (let i = 0; i < 4; i++) {
      now += 10_001;
      tm.tick(now);
    }
    expect(tm.viewFor('blue-1').doubles.team[0].clock.strikes).toBe(1);
    expect(tm.viewFor('blue-1').doubles.team[1].clock.strikes).toBe(1);
    for (let i = 0; i < 8 && tm.phase === 'playing'; i++) {
      now += 10_001;
      if (tm.seatOnTurn === 'blue-1') tm.tick(now);
      else {
        tm.tick(now - 10_000);
        miss(tm);
      }
    }
    expect(tm.phase).toBe('finished');
    expect(tm.winner).toBe('red');
    expect(tm.winReason).toBe('timeout');
  });

  it('plays to the end and replays exactly from its record', () => {
    for (const [i, options] of ([
      { seed: 1 },
      { seed: 2, config: 'rapido-poderes', factions: { blue: 'roma', red: 'grecia' }, mutators: ['mare', 'tiro-duplo'] },
      { seed: 3, config: 'classic', mutators: ['neblina'] },
    ] as TeamMatchOptions[]).entries()) {
      const tm = started(options);
      playOut(tm, 40 + i);
      expect(tm.phase).toBe('finished');
      const copy = TeamMatch.fromRecord(JSON.parse(JSON.stringify(tm.toRecord())));
      expect(copy.serverState()).toEqual(tm.serverState());
      for (const seat of SEATS) expect(JSON.stringify(copy.viewFor(seat))).toBe(JSON.stringify(tm.viewFor(seat)));
    }
  });
});
