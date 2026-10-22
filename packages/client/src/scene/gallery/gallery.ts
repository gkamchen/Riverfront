import { Group, Raycaster, Vector2, Vector3, type Mesh } from 'three';
import { Tweens } from '../../anim/tweens';
import { SOUND_NAMES, SoundBoard, type SoundName } from '../../audio/sfx';
import { Board } from '../../board/board';
import type { CoordinateMode } from '../../board/coordinates';
import { COLS, ROWS, cellCenter, cellIndexOf, type Side } from '../../board/layout';
import type { ResultKind } from '../../board/resultMarkers';
import { CameraRig, type ViewPreset } from '../../camera/cameraRig';
import { EffectsDirector } from '../../effects/fx';
import { EXPRESSIONS, EXPRESSION_LABELS } from '../../factions/portrait';
import { FACTION_LIST, FACTIONS, applyFaction, leaderPortrait } from '../../factions/registry';
import type { FactionDef } from '../../factions/types';
import { createMaterialLibrary } from '../../materials/library';
import { PALETTES, TEAM_COLORS, teamPaletteMode } from '../../materials/palettes';
import { THEMES, THEME_IDS, type ThemeId } from '../../materials/themes';
import { setTeamUnitFactories } from '../../units/factories';
import { flagTime } from '../../units/flag';
import { ROLE_LABELS, UNIT_ROLES, type QuarterTurns, type TeamId, type UnitRole } from '../../units/roles';
import type { UnitPiece } from '../../units/unitPiece';
import { FpsProbe, QUALITY_LABELS, QUALITY_PRESETS, type QualityTier } from '../quality';
import { Stage } from '../stage';
import { ThemeDirector } from '../themeDirector';

/** Where each role stands in the gallery (column of its origin, row). */
const LAYOUT: Record<UnitRole, [number, number]> = {
  recruit: [0, 2],
  sniper: [2, 2],
  armor: [4, 2],
  artillery: [7, 2],
  antenna: [11, 1],
  bunker: [14, 1],
  amphibian: [17, 0],
  generator: [20, 2],
  workshop: [22, 2],
  tower: [24, 5],
};

const ARCHETYPES: Record<string, string> = { informacao: 'Informação', defesa: 'Defesa', ataque: 'Ataque', tempo: 'Tempo', energia: 'Energia' };

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const panel = document.getElementById('panel') as HTMLElement;
const panelBody = document.getElementById('panel-body') as HTMLElement;
const panelToggle = document.getElementById('panel-toggle') as HTMLButtonElement;
const stats = document.getElementById('stats') as HTMLElement;
const toast = document.getElementById('toast') as HTMLElement;

const rig = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
const stage = new Stage(canvas, rig.camera);
const materials = createMaterialLibrary();
const tweens = new Tweens();
const sound = new SoundBoard();
const board = new Board(materials, PALETTES[0]!, () => false);
const fx = new EffectsDirector(materials, (strength) => rig.shake(strength));
board.attachEffects(fx);
fx.attachWater(board.lake);
board.wildlife.setSoundHandler((name) => sound.play(name));
const dynamic = new Group();
stage.scene.add(board.group, fx.group, dynamic);
const themes = new ThemeDirector({ stage, board, sound });

let quality: QualityTier = 'high';
let rotation: QuarterTurns = 0;
let compact = false;
let probe: FpsProbe | null = null;
let pieces: UnitPiece[] = [];
/** Current faction (null = a plain theme) and the optional rival dressing the red army. */
let faction: FactionDef | null = null;
let rival: FactionDef | null = null;

// ---------------------------------------------------------------- scene setup

function placeAll(): void {
  board.reset();
  fx.clear();
  pieces = [];
  for (const side of ['own', 'enemy'] as const) {
    const team: TeamId = side === 'own' ? 'blue' : 'red';
    for (const role of UNIT_ROLES) {
      const [col, row] = LAYOUT[role];
      if (compact) {
        if (role !== 'recruit' && role !== 'armor' && role !== 'antenna') continue;
        const legacy = role === 'recruit' ? 'soldier' : role === 'armor' ? 'tank' : 'tower';
        if (side === 'enemy') board.revealEnemy(col, row + 3, { kind: 'unit', unit: legacy }, team);
        else board.populateOwn([{ col, row: row + 3, kind: 'unit', unit: legacy }], team);
        continue;
      }
      const effectiveRow = role === 'amphibian' ? 0 : row;
      pieces.push(board.placeUnit({ role, team, side, origin: { col, row: effectiveRow }, rotation: role === 'amphibian' ? 0 : rotation }));
    }
    for (const [col, row] of [
      [1, 5],
      [9, 5],
      [17, 4],
    ] as const) {
      board.populateOwn([{ col, row, kind: 'rock' }], team);
      if (side === 'enemy') board.revealEnemy(col, row, { kind: 'rock' }, team);
    }
  }
  pieces = board.units();
  for (let i = 0; i < COLS * ROWS; i++) void board.enemyTiles.flipOpen(i, tweens);
  void Promise.all(pieces.map((p) => p.rise(tweens)));
}

function centreOf(piece: UnitPiece): Vector3 {
  const centre = new Vector3();
  for (const cell of piece.cells) centre.add(cellCenter(piece.side, cell.col, cell.row));
  return centre.divideScalar(piece.cells.length);
}

async function destroy(piece: UnitPiece): Promise<void> {
  if (piece.destroyed) return;
  const at = centreOf(piece);
  fx.explosion(at, TEAM_COLORS[piece.team].main, piece.cells.length > 2 ? 1.25 : 1);
  sound.play('explosion');
  board.onImpact(at, 1);
  for (const cell of piece.cells) board.markResult(piece.side, cell.col, cell.row, 'unit');
  await piece.destroy(tweens);
}

function hitOneCell(piece: UnitPiece): void {
  const cell = piece.cells.find((c) => !piece.isCellHit(c.col, c.row));
  if (!cell || piece.destroyed) return;
  piece.hitCell(cell.col, cell.row, tweens);
  const at = cellCenter(piece.side, cell.col, cell.row);
  fx.explosion(at, TEAM_COLORS[piece.team].main, 0.55);
  board.markResult(piece.side, cell.col, cell.row, 'unit');
  sound.play('hit');
}

function randomCell(side: Side): { col: number; row: number } {
  return { col: Math.floor(Math.random() * COLS), row: 3 + Math.floor(Math.random() * 3) + (side === 'own' ? 1 : 0) };
}

function riverPoint(): Vector3 {
  return new Vector3((Math.random() - 0.5) * 18, 0.07, (Math.random() - 0.5) * 1.6);
}

// ---------------------------------------------------------------- panel helpers

function section(title: string, parent: HTMLElement = panelBody): HTMLElement {
  const h = document.createElement('h2');
  h.textContent = title;
  parent.append(h);
  const row = document.createElement('div');
  row.className = 'row';
  parent.append(row);
  return row;
}

function button(row: HTMLElement, label: string, action: () => void, id?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (id) b.dataset.id = id;
  b.addEventListener('click', () => {
    sound.unlock();
    action();
  });
  row.append(b);
  return b;
}

function slider(label: string, min: number, max: number, value: number, onInput: (v: number) => void): void {
  const wrap = document.createElement('label');
  wrap.textContent = label;
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  wrap.append(input);
  panelBody.append(wrap);
}

function select(row: HTMLElement, options: Array<[string, string]>, onChange: (value: string) => void): HTMLSelectElement {
  const s = document.createElement('select');
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    s.append(o);
  }
  s.addEventListener('change', () => {
    sound.unlock();
    onChange(s.value);
  });
  row.append(s);
  return s;
}

function say(text: string): void {
  toast.textContent = text;
  toast.classList.add('show');
  window.clearTimeout(Number(toast.dataset.timer));
  toast.dataset.timer = String(window.setTimeout(() => toast.classList.remove('show'), 2200));
}

function mark(row: HTMLElement, active: string): void {
  for (const b of row.querySelectorAll('button')) b.classList.toggle('on', b.dataset.id === active);
}

function roleName(role: UnitRole): string {
  return faction ? faction.unitSkins[role].name : ROLE_LABELS[role];
}

// ---------------------------------------------------------------- panel

panelToggle.addEventListener('click', () => panel.classList.toggle('collapsed'));
if (window.matchMedia('(max-width: 700px)').matches) panel.classList.add('collapsed');

const lookRow = section('Facção ou tema');
const factionOptions: Array<[string, string]> = [
  ...THEME_IDS.map((id): [string, string] => [`tema:${id}`, `Tema · ${THEMES[id].name}`]),
  ...FACTION_LIST.map((f): [string, string] => [f.id, `${f.status === 'pronta' ? '★' : '○'} Onda ${f.wave} · ${f.name}${f.status === 'planejada' ? ' (planejada)' : ''}`]),
];
const lookSelect = select(lookRow, factionOptions, (value) => setLook(value));
const rivalRow = section('Exército vermelho');
const rivalSelect = select(rivalRow, [['', 'Mesma facção'], ...FACTION_LIST.map((f): [string, string] => [f.id, f.name])], (value) => {
  rival = value ? FACTIONS[value] ?? null : null;
  applyRival();
  placeAll();
  refreshNames();
});
const info = document.createElement('div');
info.className = 'info';
panelBody.append(info);
const portraitRow = document.createElement('div');
portraitRow.className = 'portraits';
panelBody.append(portraitRow);

slider('Entardecer', 0, 1, 0, (v) => themes.setDusk(v));
const paletteRow = section('Cores dos times');
button(paletteRow, 'Padrão', () => {
  themes.setTeamPalette('standard');
  mark(paletteRow, 'standard');
}, 'standard');
button(paletteRow, 'Daltônico (azul × laranja)', () => {
  themes.setTeamPalette('colorblind');
  mark(paletteRow, 'colorblind');
}, 'colorblind');

const coordRow = section('Coordenadas');
for (const [label, mode] of [
  ['Gravadas', 'engraved'],
  ['De frente para a câmera', 'billboard'],
  ['Ocultas', 'off'],
] as const) {
  button(coordRow, label, () => setCoordinates(mode), mode);
}

const qualityRow = section('Qualidade');
for (const tier of ['high', 'low'] as const) button(qualityRow, QUALITY_LABELS[tier], () => setQuality(tier), tier);
button(qualityRow, 'Medir FPS (3 s)', () => {
  probe = new FpsProbe(3);
  say('Medindo…');
});

const unitRow = section('Unidades');
button(unitRow, 'Recolocar', placeAll);
button(unitRow, 'Girar 90°', () => {
  rotation = ((rotation + 1) % 4) as QuarterTurns;
  placeAll();
  say(`Rotação: ${rotation * 90}°`);
});
button(unitRow, 'Legado (soldier/tank/tower)', () => {
  compact = !compact;
  placeAll();
  say(compact ? 'Peças legadas em 1 célula' : 'Peças completas');
});
button(unitRow, 'Atingir uma célula de cada', () => pieces.forEach(hitOneCell));
button(unitRow, 'Piscar (hit-flash)', () => pieces.forEach((p) => p.flash(1)));
button(unitRow, 'Destruir todos', () => pieces.forEach((p, i) => void tweens.wait(i * 0.18).then(() => destroy(p))));
const destroyRow = section('Destruição por papel');
const destroyButtons = UNIT_ROLES.map((role) =>
  button(destroyRow, ROLE_LABELS[role], () => {
    for (const piece of pieces.filter((p) => p.role === role)) void destroy(piece);
  }),
);
const closeRow = section('Ver de perto');
const closeButtons = UNIT_ROLES.map((role) =>
  button(closeRow, ROLE_LABELS[role], () => {
    const piece = pieces.find((p) => p.role === role && p.side === 'own');
    if (!piece) return;
    const c = centreOf(piece);
    look(c.x, c.z, piece.cells.length > 2 ? 3.6 : 2.6, 0.95, 0.35, 0.35);
  }),
);
button(closeRow, 'Câmera normal', () => {
  unlook();
  mosaic = null;
});
for (const [label, roles] of [
  ['Mosaico 1–4', UNIT_ROLES.slice(0, 4)],
  ['Mosaico 5–8', UNIT_ROLES.slice(4, 8)],
  ['Mosaico 9–10 + inimigos', [UNIT_ROLES[8]!, UNIT_ROLES[9]!, 'enemy:recruit', 'enemy:bunker']],
] as const) {
  button(closeRow, label, () => (mosaic = [...roles]));
}

const sheetRow = section('Verificação rápida');
button(sheetRow, 'Facções prontas: tabuleiros', () => void contactSheet('board'));
button(sheetRow, 'Facções prontas: peças', () => void contactSheet('pieces'));
button(sheetRow, 'Relatório no console', () => void report());

const lifeRow = section('Vida no rio');
const GENERIC_TRIGGERS: Array<[string, string]> = [
  ['Saltos de lambari', 'jump'],
  ['Carpa', 'carp'],
  ['Garça pesca', 'heronFish'],
  ['Garça voa', 'heronFly'],
  ['Sapos', 'frogs'],
  ['Libélula pousa', 'land'],
  ['Salamandra', 'salamander'],
  ['Focas', 'seal'],
  ['Crocodilo abocanha', 'crocSnap'],
  ['Hipopótamo', 'hippo'],
  ['Golfinhos', 'dolphins'],
  ['Gaivota mergulha', 'gulls'],
  ['Patos', 'ducks'],
  ['Barco balança', 'boat'],
];
function buildLifeButtons(): void {
  lifeRow.replaceChildren();
  const list = faction?.wildlife.triggers ? [...faction.wildlife.triggers] : GENERIC_TRIGGERS;
  for (const [label, event] of list) {
    button(lifeRow, label, () => {
      if (event === 'land') board.wildlife.onHoverIdle(board.enemyTiles.topOf(cellIndexOf(12, 0)));
      if (!board.wildlife.trigger(event)) say('Não existe neste rio');
    });
  }
  button(lifeRow, 'Explosão no rio', () => {
    const at = riverPoint();
    fx.waterSplash(at, 1.2);
    fx.explosion(at.clone().setY(0.1), TEAM_COLORS.red.main, 0.6);
    board.onImpact(at, 1);
    sound.play('explosion');
  });
  button(lifeRow, 'Rio de perto', () => look(0, 0, 6, 0.85, 0.2, 0.1));
}

const fxRow = section('Efeitos');
button(fxRow, 'Explosão', () => {
  const cell = randomCell('enemy');
  const at = cellCenter('enemy', cell.col, cell.row);
  fx.explosion(at, TEAM_COLORS.red.main);
  board.onImpact(at, 1);
  sound.play('explosion');
});
for (const [label, surface] of [
  ['Erro: terra', 'earth'],
  ['Erro: rocha', 'rock'],
  ['Erro: água', 'water'],
] as const) {
  button(fxRow, label, () => {
    const cell = randomCell('enemy');
    const at = surface === 'water' ? riverPoint() : cellCenter('enemy', cell.col, cell.row);
    fx.miss(at, surface);
    board.onImpact(at, 0.3);
    if (surface !== 'water') board.markResult('enemy', cell.col, cell.row, surface);
    sound.play(surface === 'water' ? 'splash' : surface === 'rock' ? 'rockChips' : 'dust');
  });
}
button(fxRow, 'Hit-stop', () => fx.hitstop(0.25, 0.02));
button(fxRow, 'Câmera lenta', () => fx.slowMo(2.5, 0.25));
button(fxRow, 'Vitória (fogos)', () => {
  fx.victory('blue');
  playSound('victory');
  fx.fireworks.onLaunch = () => sound.play('fireworkLaunch');
  fx.fireworks.onBurst = () => sound.play('fireworkBurst');
});
button(fxRow, 'Derrota (chuva + bandeira)', () => {
  fx.defeat('red');
  playSound('defeat');
  sound.setRain(true);
});
button(fxRow, 'Limpar final', () => {
  fx.clearEnding();
  sound.setRain(false);
});
button(fxRow, 'Marcadores', () => {
  const kinds: ResultKind[] = ['earth', 'rock', 'unit'];
  for (let i = 0; i < 12; i++) {
    const cell = randomCell('enemy');
    board.markResult('enemy', cell.col, cell.row, kinds[i % 3]!);
  }
});

const soundRow = section('Áudio');
const muteButton = button(soundRow, 'Som: desligado', () => {
  sound.setMuted(!sound.muted);
  muteButton.textContent = sound.muted ? 'Som: desligado' : 'Som: ligado';
});
button(soundRow, 'Tema da facção', () => playSound('motif'));
slider('Volume', 0, 1, 0.8, (v) => sound.setVolume(v));
const sfxRow = document.createElement('div');
sfxRow.className = 'row';
panelBody.append(sfxRow);
for (const name of SOUND_NAMES) button(sfxRow, name, () => playSound(name));

const cameraRow = section('Câmera');
for (const [label, preset] of [
  ['Padrão', 'default'],
  ['Topo', 'top'],
  ['Lateral', 'side'],
] as const) {
  button(cameraRow, label, () => {
    unlook();
    setView(preset);
  });
}
button(cameraRow, 'Girar 180°', () => rig.rotate180());

// ---------------------------------------------------------------- actions

function playSound(name: SoundName): void {
  if (sound.muted) {
    sound.setMuted(false);
    muteButton.textContent = 'Som: ligado';
  }
  sound.play(name);
}

function setView(preset: ViewPreset): void {
  rig.setPreset(preset);
}

function setCoordinates(mode: CoordinateMode): void {
  board.setCoordinateMode(mode);
  mark(coordRow, mode);
}

function applyRival(): void {
  if (rival) applyFaction(rival.id, null, { environment: false, teams: ['red'] });
  else if (faction) applyFaction(faction.id, null, { environment: false, teams: ['red'] });
  else setTeamUnitFactories('red', null);
}

/** `tema:<id>` for a plain theme, otherwise a faction id. */
function setLook(value: string): void {
  if (value.startsWith('tema:')) {
    const id = value.slice(5) as ThemeId;
    faction = null;
    themes.setTheme(id);
    say(`Tema: ${THEMES[id].name}`);
  } else {
    const f = FACTIONS[value];
    if (!f) return;
    faction = f;
    applyFaction(f.id, themes);
    say(`${f.name} · rio ${f.river.name}`);
  }
  applyRival();
  lookSelect.value = value;
  const url = new URL(window.location.href);
  url.searchParams.set('faction', value);
  window.history.replaceState(null, '', url);
  refreshNames();
  buildLifeButtons();
  placeAll();
}

function refreshNames(): void {
  UNIT_ROLES.forEach((role, i) => {
    destroyButtons[i]!.textContent = roleName(role);
    closeButtons[i]!.textContent = roleName(role);
  });
  portraitRow.replaceChildren();
  if (!faction) {
    info.innerHTML = '<p>Tema visual sem facção: peças padrão.</p>';
    return;
  }
  const f = faction;
  const lines = [
    `<strong>${f.name}</strong> · ${f.people} · ${f.region}`,
    `Onda ${f.wave} · ${f.status === 'pronta' ? 'arte pronta' : 'planejada (kit genérico)'} · arquétipo ${ARCHETYPES[f.archetype] ?? f.archetype}`,
    `Rio: ${f.river.name} · ${f.brand}`,
    `<em>${f.leader.name}</em>, ${f.leader.title}`,
  ];
  if (rival) lines.push(`Vermelho: ${rival.name}`);
  info.innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
  const names = document.createElement('ol');
  names.className = 'names';
  for (const role of UNIT_ROLES) {
    const li = document.createElement('li');
    li.textContent = `${ROLE_LABELS[role]}: ${f.unitSkins[role].name}${f.unitSkins[role].factory ? ' ✦' : ''}`;
    names.append(li);
  }
  info.append(names);
  for (const expression of EXPRESSIONS) {
    const figure = document.createElement('figure');
    const portrait = leaderPortrait(f, expression, 128);
    const caption = document.createElement('figcaption');
    caption.textContent = EXPRESSION_LABELS[expression];
    figure.append(portrait, caption);
    figure.title = f.leader.lines?.[expression]?.[0] ?? '';
    portraitRow.append(figure);
  }
}

function setQuality(tier: QualityTier): void {
  quality = tier;
  stage.setQuality(tier);
  board.setQuality(QUALITY_PRESETS[tier].wildlife);
  fx.setDensity(QUALITY_PRESETS[tier].particles);
  mark(qualityRow, tier);
  resize();
}

// ---------------------------------------------------------------- input & loop

const raycaster = new Raycaster();
const pointer = new Vector2();
let dragging: { x: number; y: number; moved: number } | null = null;
canvas.addEventListener('pointerdown', (e) => {
  dragging = { x: e.clientX, y: e.clientY, moved: 0 };
  canvas.setPointerCapture(e.pointerId);
  sound.unlock();
});
canvas.addEventListener('pointermove', (e) => {
  if (dragging) {
    dragging.moved += Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y);
    rig.orbitBy(-(e.clientX - dragging.x) * 0.006, -(e.clientY - dragging.y) * 0.004);
    dragging = { ...dragging, x: e.clientX, y: e.clientY };
    return;
  }
  hover(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', (e) => {
  // A tap without dragging (phones) also aims, so the coordinate echo can be checked.
  if (dragging && dragging.moved < 6) hover(e.clientX, e.clientY);
  dragging = null;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  rig.zoomBy(e.deltaY > 0 ? 1.08 : 0.92);
}, { passive: false });

/** Aims at a tile under the pointer; the board echoes its letter and number on the frame. */
function hover(clientX: number, clientY: number): void {
  const rect = canvas.getBoundingClientRect();
  pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, rig.camera);
  const enemy = raycaster.intersectObject(board.enemyTiles.mesh, false)[0];
  const own = raycaster.intersectObject(board.ownTiles.mesh, false)[0];
  board.enemyTiles.setHovered(enemy?.instanceId ?? null);
  board.ownTiles.setHovered(enemy ? null : (own?.instanceId ?? null));
}

function resize(): void {
  stage.resize();
  rig.resize(canvas.clientWidth / Math.max(1, canvas.clientHeight));
  fx.setViewport(stage.drawingHeight, rig.camera.fov);
  board.wildlife.setViewport(stage.drawingHeight, rig.camera.fov);
}
window.addEventListener('resize', resize);

let last = performance.now();
let time = 0;
let fpsSmoothed = 60;
let frameMs = 16;

/** Split view of four close-ups (role ids, 'enemy:' prefix for the far side), or null. */
let mosaic: string[] | null = null;

function pieceCentre(role: UnitRole, side: Side): { at: Vector3; cells: number } | null {
  const piece = pieces.find((p) => p.role === role && p.side === side);
  return piece ? { at: centreOf(piece), cells: piece.cells.length } : null;
}

/** Renders up to four front close-ups into the quadrants of the canvas. */
function renderMosaic(items: readonly string[]): void {
  const renderer = stage.renderer;
  const camera = rig.camera;
  const size = renderer.getSize(new Vector2());
  const aspect = camera.aspect;
  renderer.setScissorTest(true);
  items.slice(0, 4).forEach((item, i) => {
    const enemy = item.startsWith('enemy:');
    const role = (enemy ? item.slice(6) : item) as UnitRole;
    const side: Side = enemy ? 'enemy' : 'own';
    const found = pieceCentre(role, side);
    const x0 = (i % 2) * (size.x / 2);
    const y0 = i < 2 ? size.y / 2 : 0;
    renderer.setViewport(x0, y0, size.x / 2, size.y / 2);
    renderer.setScissor(x0, y0, size.x / 2, size.y / 2);
    if (!found) return;
    const d = found.cells > 2 ? 3.8 : found.cells > 1 ? 3.0 : 2.3;
    // Pieces face the river: look at them from the water side, a little to one side.
    const toward = side === 'own' ? -1 : 1;
    const look = found.cells > 1 ? 0.3 : 0.42;
    camera.position.set(found.at.x + 0.55 * d, look + 0.5 * d, found.at.z + toward * 0.75 * d);
    camera.lookAt(found.at.x, look, found.at.z);
    renderer.render(stage.scene, camera);
  });
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.x, size.y);
  camera.aspect = aspect;
}

// ---------------------------------------------------------------- quick checks

const sheet = document.createElement('div');
sheet.id = 'sheet';
sheet.hidden = true;
document.body.append(sheet);
sheet.addEventListener('click', () => {
  sheet.hidden = true;
  sheet.replaceChildren();
});

/**
 * Renders every finished faction one after another and lays the pictures out
 * side by side: whole boards, or four signature pieces each. Click to close.
 */
async function contactSheet(kind: 'board' | 'pieces', roles: string[] = ['antenna', 'bunker', 'amphibian', 'generator'], only?: readonly string[]): Promise<void> {
  const ready = FACTION_LIST.filter((f) => f.status === 'pronta' && (!only || only.includes(f.id)));
  const previous = lookSelect.value;
  const canvasEl = stage.renderer.domElement;
  sheet.replaceChildren();
  sheet.hidden = false;
  const grid = document.createElement('div');
  grid.className = 'sheet-grid';
  sheet.append(grid);
  for (const f of ready) {
    setLook(f.id);
    unlook();
    rig.setPreset('default');
    advance(2.2);
    mosaic = kind === 'pieces' ? roles : null;
    frame(1 / 60);
    const shot = document.createElement('canvas');
    shot.width = Math.round(canvasEl.width / 2);
    shot.height = Math.round(canvasEl.height / 2);
    shot.getContext('2d')?.drawImage(canvasEl, 0, 0, shot.width, shot.height);
    const cell = document.createElement('figure');
    const caption = document.createElement('figcaption');
    caption.textContent = `${f.name} · ${f.river.name}`;
    cell.append(shot, caption);
    grid.append(cell);
    // Let the page breathe between factions.
    await new Promise((r) => setTimeout(r, 30));
  }
  mosaic = null;
  setLook(previous);
}

interface PieceCheck {
  faction: string;
  role: UnitRole;
  name: string;
  triangles: number;
  meshes: number;
  issue: string;
}

/**
 * Builds and destroys every role of every faction (finished and planned) and
 * prints a table to the console, with a warning for anything suspicious:
 * build errors, empty or broken geometry, very heavy pieces, missing names.
 */
async function report(): Promise<{ rows: PieceCheck[]; warnings: string[] }> {
  const rows: PieceCheck[] = [];
  const warnings: string[] = [];
  const previous = lookSelect.value;
  for (const f of FACTION_LIST) {
    let issue = '';
    try {
      setLook(f.id);
      advance(0.6);
    } catch (error) {
      warnings.push(`${f.id}: falhou ao aplicar (${(error as Error).message})`);
      continue;
    }
    const team = f.palette.team;
    if (team.cloth === 'none' && team.shield === 'none') warnings.push(`${f.id}: nem túnica nem escudo levam a cor do time`);
    for (const role of UNIT_ROLES) {
      const piece = pieces.find((p) => p.role === role && p.side === 'own');
      issue = '';
      if (!piece) {
        rows.push({ faction: f.id, role, name: f.unitSkins[role].name, triangles: 0, meshes: 0, issue: 'não foi colocada' });
        warnings.push(`${f.id}/${role}: peça não foi colocada`);
        continue;
      }
      let triangles = 0;
      let meshes = 0;
      piece.group.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        meshes++;
        const g = m.geometry;
        const count = g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0);
        triangles += count / 3;
        g.computeBoundingSphere();
        if (g.boundingSphere && !Number.isFinite(g.boundingSphere.radius)) issue = 'geometria com NaN';
      });
      if (!f.unitSkins[role].name) issue ||= 'sem nome';
      if (triangles > 25000) issue ||= 'muito pesada';
      if (issue) warnings.push(`${f.id}/${role}: ${issue}`);
      rows.push({ faction: f.id, role, name: f.unitSkins[role].name, triangles: Math.round(triangles), meshes, issue });
    }
    try {
      for (const p of pieces) void destroy(p);
      advance(2.6);
    } catch (error) {
      warnings.push(`${f.id}: falhou na destruição (${(error as Error).message})`);
    }
    await new Promise((r) => setTimeout(r, 0));
  }
  setLook(previous);
  console.groupCollapsed(`Relatório da galeria: ${FACTION_LIST.length} facções, ${rows.length} peças`);
  console.table(rows);
  console.groupEnd();
  const heaviest = [...rows].sort((a, b) => b.triangles - a.triangles).slice(0, 5);
  console.info('[galeria] mais pesadas: ' + heaviest.map((r) => `${r.faction}/${r.role} ${r.triangles}`).join(', '));
  if (warnings.length) for (const w of warnings) console.warn(`[galeria] ${w}`);
  else console.info('[galeria] nenhum aviso');
  say(warnings.length ? `${warnings.length} aviso(s) no console` : 'Relatório sem avisos (console)');
  return { rows, warnings };
}

/** Debug close-up camera (null = normal orbit rig). */
let closeUp: { target: Vector3; distance: number; polar: number; azimuth: number } | null = null;
function look(x: number, z: number, distance = 4, polar = 0.9, azimuth = 0, y = 0.3): void {
  closeUp = { target: new Vector3(x, y, z), distance, polar, azimuth };
}
function unlook(): void {
  closeUp = null;
}

function frame(forced?: number): void {
  stage.renderer.info.reset();
  const now = performance.now();
  const raw = forced ?? Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = fx.warp(raw);
  time += dt;
  fpsSmoothed += (1 / Math.max(raw, 1e-3) - fpsSmoothed) * 0.05;
  frameMs += (raw * 1000 - frameMs) * 0.05;

  flagTime.value = time;
  tweens.update(dt);
  rig.update(raw);
  if (closeUp) {
    const c = closeUp;
    rig.camera.position.set(c.target.x + Math.sin(c.azimuth) * Math.sin(c.polar) * c.distance, c.target.y + Math.cos(c.polar) * c.distance, c.target.z + Math.cos(c.azimuth) * Math.sin(c.polar) * c.distance);
    rig.camera.lookAt(c.target);
  }
  board.update(dt, time, false);
  fx.update(dt);
  stage.setGloom(fx.rain.level);
  if (mosaic) renderMosaic(mosaic);
  else stage.render(dt);

  if (probe) {
    const report = probe.sample(raw);
    if (report) {
      say(`Média ${report.average.toFixed(0)} fps · p95 ${report.p95.toFixed(1)} ms → ${QUALITY_LABELS[report.recommendation]}`);
      probe = null;
    }
  }
  const info = stage.renderer.info.render;
  stats.textContent =
    `${fpsSmoothed.toFixed(0)} fps  ${frameMs.toFixed(1)} ms\n` +
    `draw calls ${info.calls}\ntriângulos ${(info.triangles / 1000).toFixed(0)}k\n` +
    `qualidade ${QUALITY_LABELS[quality]} · tempo ×${fx.time.scale.toFixed(2)}\n` +
    `${themes.theme.name} · cores ${teamPaletteMode() === 'colorblind' ? 'daltônico' : 'padrão'}`;
}

const params = new URLSearchParams(window.location.search);
const requested = params.get('faction') ?? params.get('theme') ?? 'tema:vale';
const initial = requested.startsWith('tema:') || FACTIONS[requested] ? requested : THEME_IDS.includes(requested as ThemeId) ? `tema:${requested}` : 'tema:vale';
setQuality(params.get('quality') === 'low' ? 'low' : 'high');
mark(paletteRow, 'standard');
setCoordinates('engraved');
rivalSelect.value = '';
setLook(initial);
resize();
stage.renderer.info.autoReset = false;
void stage.precompile().then(() => stage.renderer.setAnimationLoop(() => frame()));

/** Steps the scene by fixed frames (for inspection when the page is throttled in the background). */
function advance(seconds: number, step = 1 / 30): void {
  for (let t = 0; t < seconds; t += step) frame(step);
}

Object.assign(window, {
  gallery: { stage, board, fx, rig, tweens, sound, themes, pieces: () => pieces, destroy, placeAll, look, unlook, setLook, setQuality, setCoordinates, advance, faction: () => faction, mosaic: (items: string[] | null) => (mosaic = items), contactSheet, report },
});
