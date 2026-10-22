import {
  cellLabel,
  type AbilityId,
  type AbilityRequest,
  type Coord,
  type HistoryEntry,
  type LineAxis,
  type PlayerId,
  type PlayerView,
  type ShotReport,
  type SpecialShotRequest,
  type SeatId,
  type TeamView,
  seatCells,
} from '@riverfront/core';
import type { CoachAdvice, TauntEvent } from '@riverfront/ai';
import { aiModule } from './aiLoader';
import { EMOTE, EMOJI_GLYPHS, TAUNT_TEXT, type EmojiId, type TauntId } from '@riverfront/protocol';
import { Vector3 } from 'three';
import type { Tweens } from '../anim/tweens';
import type { SoundBoard } from '../audio/sfx';
import type { Board } from '../board/board';
import { COLS, FIELD_INNER_Z, FIELD_OUTER_Z, ROWS, cellCenter, type Side } from '../board/layout';
import { FieldBoard } from './fieldBoard';
import type { CameraRig } from '../camera/cameraRig';
import type { EmojiFloaters } from '../effects/emojis';
import type { EffectsDirector } from '../effects/fx';
import type { Projectile } from '../effects/projectile';
import type { Expression } from '../factions/types';
import { emptyOverlay, type MarkKind, type OverlayCell, type OverlayState } from '../hud/boardOverlay';
import { sideOf, type Hud, type MessageTone, type TeamInfo } from '../hud/hud';
import { abilityName, mutatorName, placementError, roleName, t, type TextKey } from '../hud/i18n';
import { isPhone, type LayoutMode } from '../hud/layout';
import { TEAM_COLORS } from '../materials/palettes';
import { RockPiece } from '../units/rockPiece';
import { UnitPiece } from '../units/unitPiece';
import { rand } from '../util/random';
import { crossedSecond, crossedWarning, readClock, formatSeconds, seatReading } from './clockDisplay';
import { INITIAL_FLOW, canAim, canPlace, footprintOf, reduceFlow, targetField, type FlowEvent, type FlowState, type Targeting } from './flow';
import { isBotDriven, type BotDriven, type GameHost, type HostResult, type HostUpdate } from './matchHost';
import { canPause, type MatchSetup, type PlayMode } from './modes';
import { PlacementEditor } from './placement';
import { statsOf, type MatchStats } from './stats';

export interface Presentation {
  board: Board;
  fx: EffectsDirector;
  projectile: Projectile;
  emojis: EmojiFloaters;
  tweens: Tweens;
  sound: SoundBoard;
  hud: Hud;
  camera: CameraRig;
}

export interface ControllerHooks {
  /** The match is over and the scene finished its ending; show the result screen. */
  onEnd(summary: EndSummary): void;
  /** Phase change (camera framing, menus). */
  onPhase(phase: FlowState['phase']): void;
  reducedMotion(): boolean;
  /** Tap, then confirm with a big button (touch screens). */
  confirmShots(): boolean;
  layout(): LayoutMode;
  glyphs(): boolean;
  coordinates(): boolean;
  heatMap(): boolean;
  /** Bot leader portrait for speech bubbles. */
  portrait(expression: Expression): string | null;
}

export interface MatchContext {
  readonly host: GameHost;
  readonly play: PlayMode;
  readonly setup: MatchSetup | null;
  readonly teams: { readonly own: TeamInfo; readonly enemy: TeamInfo };
  /** Online: sends emotes; vs bot: null. */
  readonly social: SocialLink | null;
  /** Start the placement with a ready-made layout (quick play). */
  readonly autoLayout: boolean;
  /** Doubles: display name of every seat. */
  readonly seatNames?: Readonly<Partial<Record<SeatId, string>>>;
  /** Why the active mutators are on (campaign signature, daily challenge, room...). */
  readonly mutatorReason?: string;
}

export interface SocialLink {
  sendEmoji(id: EmojiId): Promise<HostResult>;
  sendTaunt(id: TauntId): Promise<HostResult>;
}

export interface EndSummary {
  readonly victory: boolean;
  readonly reason: string;
  readonly stats: MatchStats;
  readonly durationMs: number;
  readonly play: PlayMode;
  readonly setup: MatchSetup | null;
}

interface Pick {
  readonly side: Side;
  readonly col: number;
  readonly row: number;
}

const BOT_DELAY: readonly [number, number] = [0.55, 0.95];

/**
 * Runs one match on the board: placement, turns, abilities and the ending.
 * Everything that happens is read from the match history and animated in
 * order, so local and online matches go through the same code.
 */
export class GameController {
  readonly overlay: OverlayState = emptyOverlay();
  readonly #p: Presentation;
  readonly #hooks: ControllerHooks;
  #field: FieldBoard;
  #ctx: MatchContext | null = null;
  #flow: FlowState = INITIAL_FLOW;
  #view: PlayerView | null = null;
  #seen = 0;
  #queue: Promise<void> = Promise.resolve();
  #pending = 0;
  #generation = 0;
  #unsubscribe: (() => void) | null = null;
  #editor: PlacementEditor | null = null;
  #editorDrawn = -1;
  #hover: Pick | null = null;
  #cursor: Pick = { side: 'enemy', col: Math.floor(COLS / 2), row: 0 };
  #coach: CoachAdvice | null = null;
  #clockLeft: number | null = null;
  #clockTurn = -1;
  #startedAt = 0;
  #idleTime = 0;
  #idleTaunted = false;
  #botBusy = false;
  #placementSync = 0;
  #emojiTimes: number[] = [];
  #tauntAt = 0;
  #tideWarned = -1;
  #aimMode = false;
  #ended = false;
  /** Doubles: seat that was on turn when the entries being animated happened. */
  #actor: SeatId | null = null;

  constructor(presentation: Presentation, hooks: ControllerHooks) {
    this.#p = presentation;
    this.#hooks = hooks;
    this.#field = new FieldBoard(presentation.board);
  }

  get flow(): FlowState {
    return this.#flow;
  }

  get context(): MatchContext | null {
    return this.#ctx;
  }

  get view(): PlayerView | null {
    return this.#view;
  }

  get active(): boolean {
    return this.#ctx !== null;
  }

  get seat(): PlayerId {
    return this.#ctx?.host.seat ?? 'blue';
  }

  get opponent(): PlayerId {
    return this.seat === 'blue' ? 'red' : 'blue';
  }

  // ------------------------------------------------------------ lifecycle

  start(ctx: MatchContext): void {
    this.stop();
    this.#generation++;
    this.#ctx = ctx;
    this.#ended = false;
    this.#seen = 0;
    this.#view = null;
    this.#coach = null;
    this.#editor = null;
    this.#editorDrawn = -1;
    this.#clockLeft = null;
    this.#tideWarned = -1;
    this.#startedAt = ctx.host.now();
    this.#queue = Promise.resolve();
    this.#pending = 0;
    this.#resetOverlay();
    this.#dispatch({ type: 'reset' });

    const { hud } = this.#p;
    hud.clearLog();
    hud.setTeams(ctx.teams.own, ctx.teams.enemy);
    hud.setFlag('online', ctx.host.online);
    hud.setFlag('training', ctx.play === 'training');
    hud.setPaused(false, canPause(ctx.play));
    hud.setHeatAvailable(ctx.play === 'training', this.#hooks.heatMap());
    hud.setCoach(null);

    this.#unsubscribe = ctx.host.onUpdate((update) => this.#enqueue(update));
    if (isBotDriven(ctx.host)) ctx.host.placeBot();
    const view = ctx.host.view();
    if (view) this.#enqueue({ kind: 'state', view });
    else hud.setMessage(t('msg.connecting'), 'neutral');
  }

  /** Leaves the match (back to the menu). The host is disposed by the caller. */
  stop(): void {
    this.#generation++;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#ctx = null;
    this.#editor = null;
    this.#view = null;
    this.#flow = INITIAL_FLOW;
    this.#p.tweens.finishAll();
    this.#p.fx.clear();
    this.#p.sound.setRain(false);
    this.#resetOverlay();
    this.#p.hud.tooltip(0, 0, null);
    this.#p.hud.setFire(null);
  }

  update(dt: number): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const host = ctx.host;
    if (isBotDriven(host) && !this.#flow.paused && this.#flow.phase === 'playing') host.advance(dt * 1000);
    this.#updateClock();
    this.#updateIdle(dt);
    this.#updateOverlay();
    if (this.#flow.phase === 'placing' && this.#editor && this.#editor.version !== this.#editorDrawn) this.#drawPlacement();
  }

  // ------------------------------------------------------------ host updates

  #enqueue(update: HostUpdate): void {
    const generation = this.#generation;
    this.#pending++;
    this.#dispatch({ type: 'busy', busy: true });
    this.#queue = this.#queue
      .then(() => (generation === this.#generation ? this.#consume(update) : undefined))
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        if (generation !== this.#generation) return;
        this.#pending--;
        if (this.#pending === 0) {
          this.#dispatch({ type: 'busy', busy: false });
          this.#afterIdle();
        }
      });
  }

  async #consume(update: HostUpdate): Promise<void> {
    const view = update.view;
    const previous = this.#view;
    if (update.kind === 'state' || !previous || view.phase !== previous.phase || this.#diverged(view)) {
      this.#rebuild(view, previous);
      return;
    }
    this.#actor = (previous as Partial<TeamView>).doubles?.seatOnTurn ?? null;
    const fresh = view.history.slice(this.#seen);
    this.#seen = view.history.length;
    // Intermediate views are not kept: the last one is the truth after the animations.
    for (const entry of fresh) {
      await this.#animate(entry, view);
      if (!this.#ctx) return;
    }
    this.#view = view;
    if (update.kind === 'event' && update.event?.kind === 'confirmed' && update.event.by !== this.seat) {
      this.#p.hud.toast(t('msg.opponentReady'), 'neutral');
    }
    this.#sync(view);
  }

  /** Repairs and fog can close cells again; the cheapest honest answer is a redraw. */
  #diverged(view: PlayerView): boolean {
    if (view.phase !== 'playing') return false;
    const tiles = this.#p.board.enemyTiles;
    for (const cell of view.enemy.cells) {
      const open = tiles.isOpen(this.#field.index(cell.col, cell.row));
      if (open && (cell.state === 'hidden' || cell.state === 'spotted')) return true;
    }
    return view.history.length < this.#seen;
  }

  #rebuild(view: PlayerView, previous: PlayerView | null): void {
    const { board, tweens, fx } = this.#p;
    const enteringPlay = previous?.phase === 'placing' && view.phase === 'playing';
    tweens.finishAll();
    if (!enteringPlay) fx.clear();
    board.reset();
    this.#view = view;
    this.#seen = view.history.length;
    this.#field = new FieldBoard(board, view.config.cols, view.config.rows);
    this.#resetOverlay();

    if (view.phase === 'placing') {
      this.#enterPlacement(view);
      return;
    }

    this.#drawOwnField(view);
    if (view.phase === 'playing' || view.phase === 'finished') this.#drawEnemyField(view);
    tweens.finishAll();

    if (view.phase === 'playing') {
      this.#editor = null;
      this.#dispatch({ type: 'playing', myTurn: this.#isMyTurn(view) });
      this.#p.hud.setPhase('playing');
      this.#hooks.onPhase('playing');
      if (enteringPlay) {
        this.#p.hud.banner(t('msg.battle'), 'info');
        this.#log(t('log.start'), '⚑', 'neutral', false);
      }
      this.#sync(view, true);
    } else {
      this.#sync(view, true);
      void this.#finish(view);
    }
  }

  #drawOwnField(view: PlayerView): void {
    const { board, tweens } = this.#p;
    const pieces = view.own.pieces.filter((p) => p.cells.length > 0).map((p) => ({ id: p.id, role: p.role, cells: p.cells, placement: p.placement }));
    this.#field.populateOwn(
      view.own.cells.map((c) => ({ col: c.col, row: c.row, terrain: c.terrain })),
      this.seat,
      pieces,
    );
    for (const cell of view.own.cells) {
      if (!cell.struck) continue;
      const unit = this.#field.unitAt('own', cell.col, cell.row);
      if (unit) {
        unit.hitCell(cell.col, cell.row);
        this.#field.markResult('own', cell.col, cell.row, 'unit');
      } else if (cell.terrain === 'rock') this.#field.markResult('own', cell.col, cell.row, 'rock');
      else {
        board.ownTiles.scorch(this.#field.index(cell.col, cell.row));
        this.#field.markResult('own', cell.col, cell.row, 'earth');
      }
    }
    for (const piece of view.own.pieces) {
      if (!piece.destroyed || piece.cells.length === 0) continue;
      const first = piece.cells[0]!;
      void this.#field.unitAt('own', first.col, first.row)?.destroy(tweens);
    }
  }

  #drawEnemyField(view: PlayerView): void {
    const { board, tweens } = this.#p;
    const enemyTeam = this.opponent;
    for (const cell of view.enemy.cells) {
      if (cell.state === 'hidden' || cell.state === 'spotted') continue;
      void board.enemyTiles.flipOpen(this.#field.index(cell.col, cell.row), tweens);
      if (cell.state === 'rock') {
        this.#field.revealEnemy(cell.col, cell.row, { kind: 'rock' }, enemyTeam);
        this.#field.markResult('enemy', cell.col, cell.row, 'rock');
      } else if (cell.state === 'earth') this.#field.markResult('enemy', cell.col, cell.row, 'earth');
      else this.#field.markResult('enemy', cell.col, cell.row, 'unit');
    }
    for (const piece of view.enemy.destroyed) {
      const unit = this.#field.placePiece({ role: piece.role, cells: piece.cells }, enemyTeam, 'enemy');
      void unit?.destroy(tweens);
    }
  }

  // ------------------------------------------------------------ placement

  #enterPlacement(view: PlayerView): void {
    const doubles = (view as Partial<TeamView>).doubles;
    const owned = doubles ? new Set(Object.entries(doubles.pieceOwners).filter(([, s]) => s === doubles.seat).map(([id]) => id)) : null;
    const editor = new PlacementEditor(view, owned);
    this.#editor = editor;
    if (this.#ctx?.autoLayout && !editor.complete && !this.#seatConfirmed(view)) editor.auto((Date.now() ^ 0x9e3779b9) >>> 0);
    this.#dispatch({ type: 'placing' });
    if (this.#seatConfirmed(view)) this.#dispatch({ type: 'confirmed' });
    this.#p.hud.setPhase('placing');
    this.#hooks.onPhase('placing');
    this.#drawPlacement();
    this.#p.hud.setMessage(t(this.#seatConfirmed(view) ? 'place.waiting' : 'place.hint'), 'info');
    this.#p.camera.focusSide(1);
    this.#sync(view, true);
  }

  #drawPlacement(): void {
    const editor = this.#editor;
    const view = this.#view;
    if (!editor || !view) return;
    this.#editorDrawn = editor.version;
    const { board } = this.#p;
    board.reset();
    const rocks = view.own.cells.filter((c) => c.terrain === 'rock').map((c) => ({ col: c.col, row: c.row, kind: 'rock' }));
    this.#field.populateOwn(rocks, this.seat);
    for (const placement of editor.placements()) {
      const slot = editor.board.slotOf(placement.pieceId);
      const piece = editor.pieces[slot];
      if (piece) this.#field.placeUnit({ role: piece.role, team: this.seat, side: 'own', origin: placement.anchor, rotation: placement.rotation });
    }
    const issues = editor.issues();
    const mineSlots = editor.pieces.map((_, slot) => slot).filter((slot) => editor.mine(slot));
    const placed = mineSlots.filter((slot) => editor.isPlaced(slot)).length;
    const total = mineSlots.length;
    const hard = issues.filter((i) => i.error !== 'not-placed');
    const status =
      this.#flow.phase === 'waiting'
        ? t('place.waiting')
        : placed < total
          ? t('place.progress', { n: placed, total })
          : hard.length > 0
            ? placementError(hard[0]!.error)
            : t('place.ready');
    this.#p.hud.setTray(
      mineSlots.map((slot) => {
        const piece = editor.pieces[slot]!;
        const issue = hard.find((i) => i.pieceId === piece.id);
        return {
          slot,
          role: piece.role,
          cells: piece.shape,
          placed: editor.isPlaced(slot),
          held: editor.held?.slot === slot,
          issue: issue ? placementError(issue.error) : null,
        };
      }),
      status,
      editor.complete && hard.length === 0 && this.#flow.phase === 'placing',
    );
    this.overlay.partner = editor.pieces.flatMap((_, slot) =>
      editor.mine(slot) ? [] : editor.board.cellsOf(slot).map((i) => ({ side: 'own' as const, col: i % editor.cols, row: Math.floor(i / editor.cols) })),
    );
    this.overlay.issues = hard.flatMap((issue) => {
      const slot = editor.board.slotOf(issue.pieceId);
      return editor.board.cellsOf(slot).map((i) => ({ side: 'own' as const, col: i % editor.cols, row: Math.floor(i / editor.cols) }));
    });
    this.#syncPlacementOnline();
  }

  pickPiece(slot: number): void {
    if (!this.#editor || !canPlace(this.#flow)) return;
    if (this.#editor.held?.slot === slot) {
      this.#editor.cancel();
    } else {
      this.#editor.pick(slot);
      this.#p.hud.announce(t('place.holding', { piece: roleName(this.#editor.pieces[slot]!.role) }));
      this.#p.sound.play('click');
    }
  }

  placeRotate(): void {
    const editor = this.#editor;
    if (!editor || !canPlace(this.#flow)) return;
    if (editor.held) {
      editor.rotateHeld();
      this.#p.sound.play('click');
      return;
    }
    const hover = this.#hover;
    if (hover?.side === 'own') {
      const slot = editor.slotAt(hover.col, hover.row);
      if (slot >= 0 && editor.mine(slot)) {
        const error = editor.rotatePlaced(slot);
        if (error) this.#rejectPlacement(error);
        else this.#p.sound.play('click');
      }
    }
  }

  placeAuto(): void {
    if (!this.#editor || !canPlace(this.#flow)) return;
    this.#editor.auto((Date.now() * 2654435761) >>> 0);
    this.#p.sound.play('click');
    this.#p.hud.announce(t('place.autoDone'));
  }

  placeClear(): void {
    if (!this.#editor || !canPlace(this.#flow)) return;
    this.#editor.removeAll();
    this.#p.sound.play('click');
  }

  async placeConfirm(): Promise<void> {
    const editor = this.#editor;
    const ctx = this.#ctx;
    if (!editor || !ctx || !canPlace(this.#flow)) return;
    const issue = editor.issues()[0];
    if (issue) {
      this.#rejectPlacement(issue.error === 'not-placed' ? 'layout-incomplete' : issue.error);
      return;
    }
    this.#dispatch({ type: 'busy', busy: true });
    const result = await ctx.host.submitLayout(this.#myPlacements(editor), true);
    this.#dispatch({ type: 'busy', busy: false });
    if (!result.ok) {
      this.#p.hud.toast(this.#errorText(result), 'bad');
      return;
    }
    this.#dispatch({ type: 'confirmed' });
    this.#p.sound.play('click');
    // Against the bot the match may already be running (the update was handled first).
    if (this.#view?.phase === 'placing') this.#p.hud.setMessage(t('place.waiting'), 'neutral');
    this.#editorDrawn = -1;
  }

  /** Online: keep the server's copy of the layout current, so the deadline uses it. */
  #syncPlacementOnline(): void {
    const ctx = this.#ctx;
    const editor = this.#editor;
    if (!ctx?.host.online || !editor || this.#flow.phase !== 'placing' || !editor.complete || editor.issues().length > 0) return;
    window.clearTimeout(this.#placementSync);
    const placements = this.#myPlacements(editor);
    this.#placementSync = window.setTimeout(() => void ctx.host.submitLayout(placements, false), 600);
  }

  /** Doubles: only the player's own pieces are sent (the partner's are theirs to move). */
  #myPlacements(editor: PlacementEditor) {
    return editor.placements().filter((p) => editor.owned === null || editor.owned.has(p.pieceId));
  }

  #rejectPlacement(error: string): void {
    this.#p.hud.toast(placementError(error), 'bad');
    this.#p.sound.play('hit');
  }

  // ------------------------------------------------------------ pointer and keyboard

  /** Pointer over a cell (null when over nothing). Screen position for the tooltip. */
  hover(boardPick: Pick | null, x = 0, y = 0): void {
    const pick = this.#field.toMatch(boardPick);
    const changed = pick?.side !== this.#hover?.side || pick?.col !== this.#hover?.col || pick?.row !== this.#hover?.row;
    this.#hover = pick;
    if (pick) this.#cursor = pick;
    if (changed && pick && this.#interactive(pick)) this.#p.sound.play('hover');
    this.#p.hud.tooltip(x, y, pick ? this.#describe(pick) : null);
    this.#updateHoverTile();
  }

  /** Tap / click on a cell. */
  tap(boardPick: Pick): void {
    const pick = this.#field.toMatch(boardPick);
    if (!pick) return;
    if (this.#flow.phase === 'placing') {
      this.#tapPlacement(pick);
      return;
    }
    if (!canAim(this.#flow)) {
      if (this.#flow.phase === 'playing' && !this.#flow.myTurn && pick.side === 'enemy') this.#p.hud.toast(t('msg.notYourTurn'), 'neutral', 1.6);
      return;
    }
    const field = targetField(this.#flow.targeting);
    if (pick.side !== field) {
      this.#p.hud.toast(t(field === 'enemy' ? 'target.enemyField' : 'target.ownField'), 'neutral', 1.8);
      return;
    }
    if (this.#flow.targeting.kind === 'shot' && this.#enemyCellOpen(pick)) {
      this.#p.hud.toast(t('err.already-revealed'), 'neutral', 1.6);
      return;
    }
    if (this.#hooks.confirmShots()) {
      const armed = this.#flow.armed;
      if (!armed || armed.col !== pick.col || armed.row !== pick.row) {
        this.#dispatch({ type: 'arm', cell: { col: pick.col, row: pick.row } });
        this.#p.sound.play('hover');
        this.#refreshFire();
        return;
      }
    }
    void this.#execute(pick);
  }

  /** The big confirm button (touch). */
  fire(): void {
    const armed = this.#flow.armed;
    if (!armed) return;
    void this.#execute({ side: targetField(this.#flow.targeting), col: armed.col, row: armed.row });
  }

  /** Would a drag starting on this cell move a piece (rather than the camera)? */
  canGrab(boardPick: Pick | null): boolean {
    const pick = this.#field.toMatch(boardPick);
    const editor = this.#editor;
    if (!editor || !pick || pick.side !== 'own' || !canPlace(this.#flow)) return false;
    if (editor.held) return true;
    const slot = editor.slotAt(pick.col, pick.row);
    return slot >= 0 && editor.mine(slot);
  }

  /** Placement drag: returns true when a piece was grabbed (the gesture then is not a camera orbit). */
  dragStart(boardPick: Pick | null): boolean {
    const pick = this.#field.toMatch(boardPick);
    const editor = this.#editor;
    if (!editor || !pick || pick.side !== 'own' || !canPlace(this.#flow)) return false;
    if (editor.held) return true;
    if (editor.slotAt(pick.col, pick.row) < 0) return false;
    editor.pickAt(pick.col, pick.row);
    this.#p.sound.play('click');
    return true;
  }

  dragEnd(boardPick: Pick | null): void {
    const pick = this.#field.toMatch(boardPick);
    const editor = this.#editor;
    if (!editor?.held) return;
    if (!pick || pick.side !== 'own') {
      editor.cancel();
      return;
    }
    const error = editor.drop(pick);
    if (error) {
      this.#rejectPlacement(error);
      editor.cancel();
    } else this.#p.sound.play('click');
  }

  /** Arrow keys move a cursor over the field the current action targets. */
  moveCursor(dCol: number, dRow: number, flipped: boolean): void {
    const side: Side = this.#flow.phase === 'placing' ? 'own' : targetField(this.#flow.targeting);
    const sign = flipped ? -1 : 1;
    // On the far field "up" goes away from the lake, on the near field towards it.
    const rowSign = side === 'enemy' ? 1 : -1;
    const base = this.#cursor.side === side ? this.#cursor : { side, col: Math.floor(this.#field.cols / 2), row: 0 };
    const next = {
      side,
      col: Math.min(this.#field.cols - 1, Math.max(0, base.col + dCol * sign)),
      row: Math.min(this.#field.rows - 1, Math.max(0, base.row + dRow * sign * rowSign)),
    };
    this.#cursor = next;
    this.#hover = next;
    this.#updateHoverTile();
    this.#p.sound.play('hover');
    this.#p.hud.announce(this.#describe(next));
  }

  activateCursor(): void {
    this.tap(this.#field.toBoard(this.#cursor));
  }

  // ------------------------------------------------------------ actions from the HUD

  selectAbility(id: AbilityId): void {
    const view = this.#view;
    if (!view || !canAim(this.#flow)) return;
    const status = view.own.abilities.find((a) => a.id === id);
    if (!status?.ready) {
      if (status?.blocker) this.#p.hud.toast(t(`blocker.${status.blocker}` as TextKey), 'neutral', 1.8);
      return;
    }
    const current = this.#flow.targeting;
    if (current.kind === 'ability' && current.ability === id) {
      this.cancelTarget();
      return;
    }
    this.#dispatch({ type: 'target', targeting: { kind: 'ability', ability: id, axis: 'row' } });
    this.#p.sound.play('click');
  }

  selectSpecial(): void {
    const special = this.#view?.own.faction?.special;
    if (!special || !canAim(this.#flow)) return;
    if (!special.ready) {
      if (special.blocker) this.#p.hud.toast(t(`blocker.${special.blocker}` as TextKey), 'neutral', 1.8);
      return;
    }
    if (this.#flow.targeting.kind === 'special') {
      this.cancelTarget();
      return;
    }
    this.#dispatch({ type: 'target', targeting: { kind: 'special', shot: special.kind, axis: 'row', first: null } });
    this.#p.sound.play('click');
  }

  toggleAxis(): void {
    const tg = this.#flow.targeting;
    if (tg.kind === 'shot') return;
    const axis: LineAxis = tg.axis === 'row' ? 'col' : 'row';
    this.#dispatch({ type: 'target', targeting: { ...tg, axis } as Targeting });
  }

  /** Escape: drops an armed cell, then the selected action. Returns whether it did anything. */
  cancelTarget(): boolean {
    if (this.#editor?.held) {
      this.#editor.cancel();
      return true;
    }
    if (this.#flow.armed || this.#flow.targeting.kind !== 'shot') {
      this.#dispatch({ type: 'cancel' });
      return true;
    }
    return false;
  }

  async surrender(): Promise<void> {
    const ctx = this.#ctx;
    if (!ctx || this.#ended) return;
    const result = await ctx.host.surrender();
    if (!result.ok) this.#p.hud.toast(this.#errorText(result), 'bad');
  }

  get canPause(): boolean {
    return this.#ctx !== null && canPause(this.#ctx.play) && !this.#ended;
  }

  setPaused(paused: boolean): void {
    if (!this.canPause || this.#flow.paused === paused) return;
    this.#dispatch({ type: 'pause', paused });
    this.#p.hud.setPaused(paused, true);
    if (!paused) this.#afterIdle();
  }

  setOffline(offline: boolean): void {
    this.#dispatch({ type: 'offline', offline });
  }

  toggleAimMode(): boolean {
    this.#aimMode = !this.#aimMode;
    this.#frame();
    return this.#aimMode;
  }

  /** Recomputes the camera framing (turn, phone layout, aim mode). */
  reframe(): void {
    this.#frame();
  }

  // ------------------------------------------------------------ social

  /** Our emoji: shown on our side; online it goes to the server (same cooldowns). */
  async sendEmoji(id: EmojiId): Promise<boolean> {
    const now = performance.now();
    this.#emojiTimes = this.#emojiTimes.filter((at) => now - at < EMOTE.emojiWindowMs);
    const last = this.#emojiTimes.at(-1) ?? -Infinity;
    if (now - last < EMOTE.emojiCooldownMs || this.#emojiTimes.length >= EMOTE.emojiPerWindow) {
      this.#p.hud.toast(t('social.cooldown'), 'neutral', 1.6);
      return false;
    }
    const link = this.#ctx?.social;
    if (link) {
      const result = await link.sendEmoji(id);
      if (!result.ok) {
        this.#p.hud.toast(this.#errorText(result), 'neutral');
        return false;
      }
    }
    this.#emojiTimes.push(now);
    this.showEmote(this.seat, 'emoji', id);
    if (!link && Math.random() < 0.4) this.#botEmote();
    return true;
  }

  async sendTaunt(id: TauntId): Promise<boolean> {
    const now = performance.now();
    if (now - this.#tauntAt < EMOTE.tauntCooldownMs) {
      this.#p.hud.toast(t('social.cooldown'), 'neutral', 1.6);
      return false;
    }
    const link = this.#ctx?.social;
    if (link) {
      const result = await link.sendTaunt(id);
      if (!result.ok) {
        this.#p.hud.toast(this.#errorText(result), 'neutral');
        return false;
      }
    }
    this.#tauntAt = now;
    this.showEmote(this.seat, 'taunt', id);
    if (!link && Math.random() < 0.6) {
      void this.#p.tweens.wait(rand(0.8, 1.4)).then(() => this.#botSay('onIdle'));
    }
    return true;
  }

  /** Seconds until the next emoji / taunt may be sent (for disabling buttons). */
  cooldowns(): { emoji: number; taunt: number } {
    const now = performance.now();
    const recent = this.#emojiTimes.filter((at) => now - at < EMOTE.emojiWindowMs);
    const last = recent.at(-1) ?? -Infinity;
    let emoji = Math.max(0, EMOTE.emojiCooldownMs - (now - last));
    if (recent.length >= EMOTE.emojiPerWindow) emoji = Math.max(emoji, EMOTE.emojiWindowMs - (now - recent[0]!));
    return { emoji: emoji / 1000, taunt: Math.max(0, EMOTE.tauntCooldownMs - (now - this.#tauntAt)) / 1000 };
  }

  /** An emote from either side (online: from the session). */
  showEmote(from: PlayerId, kind: 'emoji' | 'taunt', id: string, who?: string): void {
    const mine = from === this.seat;
    const z = mine ? rand(3.5, 6) : rand(-6, -3.5);
    if (kind === 'emoji') {
      const glyph = EMOJI_GLYPHS[id as EmojiId];
      if (glyph) this.#p.emojis.spawn(glyph, new Vector3(rand(-7, 7), 1.4, z));
      return;
    }
    if (!TAUNT_TEXT[id as TauntId]) return;
    const text = t(`taunt.${id}` as TextKey);
    if (mine) this.#p.hud.toast(`${who ?? t('social.you')}: “${text}”`, 'neutral', 2.6);
    else this.#p.hud.say(this.#ctx?.teams.enemy.name ?? '', text, null);
  }

  // ------------------------------------------------------------ executing actions

  async #execute(pick: Pick): Promise<void> {
    const ctx = this.#ctx;
    const view = this.#view;
    if (!ctx || !view || !canAim(this.#flow)) return;
    const tg = this.#flow.targeting;
    const coord: Coord = { col: pick.col, row: pick.row };
    let request: Promise<HostResult>;

    if (tg.kind === 'shot') request = ctx.host.attack(coord);
    else if (tg.kind === 'ability') {
      const ability = this.#abilityRequest(tg.ability, tg.axis, pick, view);
      if (!ability) {
        this.#p.hud.toast(t('err.invalid-target'), 'bad');
        return;
      }
      request = ctx.host.ability(ability);
    } else {
      if (tg.shot === 'double' && !tg.first) {
        this.#dispatch({ type: 'target', targeting: { ...tg, first: coord } });
        this.#p.hud.toast(t('target.second'), 'neutral', 1.8);
        return;
      }
      const special: SpecialShotRequest =
        tg.shot === 'double' && tg.first ? { target: tg.first, second: coord } : tg.shot === 'line3' ? { target: coord, axis: tg.axis } : { target: coord };
      request = ctx.host.special(special);
    }

    this.#dispatch({ type: 'busy', busy: true });
    this.#idleTime = 0;
    const result = await request;
    if (!result.ok) {
      this.#dispatch({ type: 'busy', busy: this.#pending > 0 });
      this.#p.hud.toast(this.#errorText(result), 'bad');
      this.#p.sound.play('hit');
      return;
    }
    this.#p.hud.setFire(null);
    // After an ability or special the next tap is a plain shot again.
    for (let i = 0; i < 3 && (this.#flow.targeting.kind !== 'shot' || this.#flow.armed); i++) this.#dispatch({ type: 'cancel' });
    if (this.#pending === 0) this.#dispatch({ type: 'busy', busy: false });
  }

  #abilityRequest(id: AbilityId, axis: LineAxis, pick: Pick, view: PlayerView): AbilityRequest | null {
    const target = { col: pick.col, row: pick.row };
    switch (id) {
      case 'radar':
      case 'bomb':
      case 'repair':
        return { ability: id, target };
      case 'spy':
        return { ability: 'spy', axis, index: axis === 'row' ? pick.row : pick.col };
      case 'shield': {
        const piece = view.own.pieces.find((p) => p.cells.some((c) => c.col === pick.col && c.row === pick.row));
        return piece ? { ability: 'shield', pieceId: piece.id } : null;
      }
    }
  }

  // ------------------------------------------------------------ animation of history entries

  async #animate(entry: HistoryEntry, view: PlayerView): Promise<void> {
    const mine = 'by' in entry && entry.by === this.seat;
    switch (entry.kind) {
      case 'shot':
        await this.#animateShot(entry.by, entry.report, 'shot');
        this.#reportShot(entry.by, entry.report, entry.extraShot, view);
        break;
      case 'tower':
        await this.#animateShot(entry.by, entry.report, 'tower');
        this.#reportShot(entry.by, entry.report, false, view, 'tower');
        break;
      case 'ability':
        await this.#animateAbility(entry, mine);
        break;
      case 'special': {
        const name = entry.outcome?.special ?? entry.special;
        const label = mine ? view.own.faction?.special?.name ?? name : view.enemy.faction?.special?.name ?? name;
        if (!entry.outcome) {
          this.#log(t('log.enemySpecial', { name: label }), '★', 'neutral', false);
          this.#p.hud.toast(t('log.enemySpecial', { name: label }), 'neutral');
          break;
        }
        if (entry.outcome.probe) {
          const probe = entry.outcome.probe;
          const kind = probe.content === 'unit' ? t('cell.unit') : probe.content === 'rock' ? t('cell.rock') : t('cell.earth');
          this.#log(t('log.probe', { name: label, cell: cellLabel(probe.target), what: kind }), '★', probe.content === 'unit' ? 'good' : 'neutral', true);
          this.#p.sound.play('tick');
          break;
        }
        this.#p.hud.toast(mine ? t('msg.specialMine', { name: label }) : t('msg.specialTheirs', { name: label }), mine ? 'good' : 'warn');
        for (const report of entry.outcome.shots) {
          await this.#animateShot(entry.by, report, 'special');
          this.#reportShot(entry.by, report, false, view, 'special');
        }
        break;
      }
      case 'tide':
        this.#p.hud.toast(t(entry.submerged ? 'tide.up' : 'tide.down'), 'warn', 3.5);
        this.#log(t(entry.submerged ? 'tide.up' : 'tide.down'), '≈', 'neutral', false);
        this.#p.sound.play('splash');
        for (let col = 0; col < COLS; col += 4) this.#p.board.lake.addRipple(cellCenter('own', col, 0).x, 0, 0.6);
        break;
      case 'timeout': {
        const own = entry.by === this.seat;
        const clock = own ? view.own.clock : view.enemy.clock;
        const text = t(own ? 'msg.timeoutMine' : 'msg.timeoutTheirs', { n: clock.strikes });
        this.#p.hud.toast(text, own ? 'bad' : 'neutral');
        this.#log(text, '⌛', own ? 'bad' : 'neutral', own);
        break;
      }
      case 'end':
        break;
    }
  }

  /** Projectile, impact and the reveal of one struck cell. */
  async #animateShot(by: PlayerId, report: ShotReport, source: 'shot' | 'tower' | 'special' | 'bomb'): Promise<void> {
    const { board, projectile, tweens, sound, fx } = this.#p;
    const generation = this.#generation;
    const alive = () => generation === this.#generation;
    const side: Side = by === this.seat ? 'enemy' : 'own';
    const { col, row } = report.target;
    const index = this.#field.index(col, row);
    const tiles = side === 'enemy' ? board.enemyTiles : board.ownTiles;
    const impact = tiles.topOf(index);
    const calm = this.#hooks.reducedMotion();

    if (!calm) {
      sound.play('launch');
      if (side === 'enemy') void tiles.press(index, tweens);
      const from = this.#launchPoint(by, impact, source);
      await projectile.fire(from, impact, tweens, (apex) => board.lake.addRipple(apex.x, 0, 0.8));
      if (!alive()) return;
    }

    switch (report.result) {
      case 'submerged':
        fx.waterSplash(impact, 0.8);
        board.onImpact(impact, 0.4);
        sound.play('splash');
        return;
      case 'shield':
        fx.rockHit(impact);
        sound.play('crack');
        this.#mark({ side, col, row }, 'shield');
        if (side === 'own') this.#field.unitAt('own', col, row)?.flash(0.8);
        return;
      default:
        break;
    }

    if (side === 'enemy') await this.#revealEnemy(report, index, impact, alive);
    else await this.#strikeOwn(report, index, impact);
  }

  async #revealEnemy(report: ShotReport, index: number, impact: Vector3, alive: () => boolean): Promise<void> {
    const { board, fx, tweens, sound } = this.#p;
    const { col, row } = report.target;
    fx.muzzle(impact);
    await board.enemyTiles.flipOpen(index, tweens);
    if (!alive()) return;
    const top = board.enemyTiles.topOf(index);
    board.onImpact(top, report.result === 'destroyed' ? 1 : 0.5);

    if (report.result === 'earth') {
      fx.miss(top, 'earth');
      sound.play('dust');
      this.#field.markResult('enemy', col, row, 'earth');
      return;
    }
    if (report.result === 'rock') {
      const piece = this.#field.revealEnemy(col, row, { kind: 'rock' }, this.opponent);
      if (piece instanceof RockPiece) await piece.rise(tweens);
      fx.miss(top, 'rock');
      sound.play('rockChips');
      this.#field.markResult('enemy', col, row, 'rock');
      if (piece instanceof RockPiece) await piece.crack(tweens);
      return;
    }
    this.#field.markResult('enemy', col, row, 'unit');
    if (report.result === 'hit') {
      fx.explosion(top, TEAM_COLORS[this.opponent].main, 0.55);
      sound.play('hit');
      return;
    }
    // Destroyed: the whole piece shows up and goes down.
    const destroyed = report.destroyed;
    const unit = destroyed ? this.#field.placePiece({ role: destroyed.role, cells: destroyed.cells }, this.opponent, 'enemy') : null;
    if (destroyed) for (const cell of destroyed.cells) this.#field.markResult('enemy', cell.col, cell.row, 'unit');
    if (unit) {
      await unit.rise(tweens);
      await tweens.wait(0.1);
      if (!alive()) return;
      fx.explosion(this.#centre(unit), TEAM_COLORS[this.opponent].main, (destroyed?.cells.length ?? 1) > 2 ? 1.25 : 1);
      sound.play('explosion');
      if (!this.#hooks.reducedMotion()) fx.hitstop();
      await unit.destroy(tweens);
    } else {
      fx.explosion(top, TEAM_COLORS[this.opponent].main);
      sound.play('explosion');
    }
  }

  async #strikeOwn(report: ShotReport, index: number, impact: Vector3): Promise<void> {
    const { board, fx, tweens, sound } = this.#p;
    const { col, row } = report.target;
    const piece = this.#field.pieceAt('own', col, row);
    board.onImpact(impact, report.result === 'destroyed' ? 1 : 0.5);
    if (piece instanceof UnitPiece) {
      piece.hitCell(col, row, tweens);
      this.#field.markResult('own', col, row, 'unit');
      fx.explosion(impact, TEAM_COLORS[this.seat].main, report.result === 'destroyed' ? 1.1 : 0.55);
      sound.play(report.result === 'destroyed' ? 'explosion' : 'hit');
      if (report.result === 'destroyed') await piece.destroy(tweens);
      return;
    }
    if (piece instanceof RockPiece) {
      fx.miss(impact, 'rock');
      sound.play('rockChips');
      this.#field.markResult('own', col, row, 'rock');
      await piece.crack(tweens);
      return;
    }
    fx.miss(impact, 'earth');
    board.ownTiles.scorch(index);
    this.#field.markResult('own', col, row, 'earth');
    sound.play('dust');
    await tweens.wait(this.#hooks.reducedMotion() ? 0.05 : 0.25);
  }

  async #animateAbility(entry: Extract<HistoryEntry, { kind: 'ability' }>, mine: boolean): Promise<void> {
    const outcome = entry.outcome;
    const name = abilityName(entry.ability);
    const { hud, sound } = this.#p;
    if (!outcome) {
      hud.toast(t('log.enemyAbility', { name }), 'warn');
      this.#log(t('log.enemyAbility', { name }), '✦', 'neutral', false);
      sound.play('tick');
      if (this.#ctx?.host.online === false) this.#botSay('onHit', 0.2);
      return;
    }
    switch (outcome.ability) {
      case 'radar': {
        const text = outcome.count === null ? t('log.radarBlocked', { cell: cellLabel(outcome.target) }) : t('log.radar', { cell: cellLabel(outcome.target), n: outcome.count });
        this.#log(text, '◎', outcome.count ? 'good' : 'neutral', true);
        hud.setMessage(text, 'info');
        sound.play('tick');
        break;
      }
      case 'bomb': {
        hud.toast(mine ? t('msg.bombMine', { cell: cellLabel(outcome.target) }) : t('msg.bombTheirs', { cell: cellLabel(outcome.target) }), mine ? 'good' : 'warn');
        const by = mine ? this.seat : this.opponent;
        for (const report of outcome.shots) {
          await this.#animateShot(by, report, 'bomb');
          this.#reportShot(by, report, false, this.#view!, 'bomb');
        }
        break;
      }
      case 'shield': {
        const text = mine ? t('log.shieldMine') : t('log.enemyAbility', { name });
        this.#log(text, '⛨', 'good', mine);
        hud.setMessage(text, 'good');
        sound.play('seal');
        break;
      }
      case 'repair': {
        const text = t('log.repair', { cell: cellLabel(outcome.target) });
        this.#log(text, '✚', 'good', mine);
        hud.setMessage(text, 'good');
        sound.play('click');
        break;
      }
      case 'spy': {
        const line = outcome.axis === 'row' ? t('cell.row', { n: outcome.index + 1 }) : t('cell.col', { c: String.fromCharCode(65 + outcome.index) });
        const text = outcome.role ? t('log.spy', { line, role: roleName(outcome.role) }) : t('log.spyEmpty', { line });
        this.#log(text, '◉', outcome.role ? 'good' : 'neutral', true);
        hud.setMessage(text, 'info');
        sound.play('tick');
        break;
      }
    }
  }

  #reportShot(by: PlayerId, report: ShotReport, extra: boolean, view: PlayerView, source: 'shot' | 'tower' | 'special' | 'bomb' = 'shot'): void {
    const mine = by === this.seat;
    const cell = cellLabel(report.target);
    const prefix = source === 'tower' ? t(mine ? 'log.towerMine' : 'log.towerTheirs') : '';
    let key: TextKey;
    let glyph = '✗';
    let tone: MessageTone = 'neutral';
    switch (report.result) {
      case 'earth':
        key = mine ? 'log.myEarth' : 'log.theirEarth';
        break;
      case 'rock':
        key = mine ? 'log.myRock' : 'log.theirRock';
        glyph = '◆';
        break;
      case 'hit':
        key = mine ? 'log.myHit' : 'log.theirHit';
        glyph = '✓';
        tone = mine ? 'good' : 'bad';
        break;
      case 'destroyed':
        key = mine ? 'log.myDestroyed' : 'log.theirDestroyed';
        glyph = '✓✓';
        tone = mine ? 'good' : 'bad';
        break;
      case 'shield':
        key = report.absorbedBy === 'testudo' ? (mine ? 'log.myTestudo' : 'log.theirTestudo') : mine ? 'log.myShield' : 'log.theirShield';
        glyph = '⛨';
        break;
      case 'submerged':
        key = mine ? 'log.mySubmerged' : 'log.theirSubmerged';
        glyph = '≈';
        break;
    }
    const role = report.destroyed ? roleName(report.destroyed.role) : '';
    const text = `${prefix}${t(key, { cell, role, who: this.#who(mine) })}`;
    this.#log(text, glyph, tone, mine);

    let message = text;
    if (mine && extra) {
      const left = view.turnState.extraShotsLeft;
      message = `${text} ${t('msg.extraShot', { n: left })}`;
    }
    if (source === 'shot' || source === 'tower') this.#p.hud.setMessage(message, tone === 'neutral' ? 'neutral' : tone);
    this.#p.hud.announce(message);

    if (report.sniperReveal) {
      const text2 = mine ? t('log.sniperRevealMine', { cell: cellLabel(report.sniperReveal) }) : t('log.sniperRevealTheirs', { cell: cellLabel(report.sniperReveal) });
      this.#p.hud.toast(text2, mine ? 'warn' : 'good');
      this.#log(text2, '!', mine ? 'bad' : 'good', !mine);
    }

    // Bot banter.
    if (this.#ctx?.host.online === false) {
      if (mine && report.result === 'destroyed') this.#botSay('onLostPiece', 0.8);
      else if (!mine && (report.result === 'hit' || report.result === 'destroyed')) this.#botSay('onHit', 0.45);
      else if (!mine && report.result === 'earth') this.#botSay('onMiss', 0.12);
    }
  }

  #launchPoint(attacker: PlayerId, impact: Vector3, source: string): Vector3 {
    const sign = attacker === this.seat ? 1 : -1;
    if (source === 'tower') return new Vector3(impact.x * 0.3, 2.4, sign * (FIELD_OUTER_Z - 0.5));
    return new Vector3(impact.x * 0.55 + rand(-1.5, 1.5), 1.2, sign * (FIELD_OUTER_Z + 0.9));
  }

  #centre(unit: UnitPiece): Vector3 {
    const centre = new Vector3();
    for (const cell of unit.cells) centre.add(cellCenter(unit.side, cell.col, cell.row));
    return centre.divideScalar(Math.max(1, unit.cells.length));
  }

  // ------------------------------------------------------------ sync

  /** HUD, overlay marks and flow from a view, after its events were animated. */
  #sync(view: PlayerView, quiet = false): void {
    const { hud } = this.#p;
    const ctx = this.#ctx;
    if (!ctx) return;
    hud.setUnits('own', view.own.unitCellsLeft, view.own.unitCellsTotal);
    hud.setUnits('enemy', view.enemy.unitCellsLeft, view.enemy.unitCellsTotal);
    hud.setStrikes('own', view.own.clock.strikes, 5);
    hud.setStrikes('enemy', view.enemy.clock.strikes, 5);
    const destroyed = view.enemy.destroyed.map((d) => d.role);
    hud.setFleet(view.enemy.remaining, destroyed);
    this.#syncMarks(view);
    this.#syncNotes(view);

    if (view.phase === 'placing') {
      hud.setTurn(null, 0, t('place.phase'));
      return;
    }
    if (view.phase !== 'playing') return;

    const myTurn = this.#isMyTurn(view);
    const wasMine = this.#flow.myTurn;
    const turnChanged = this.#clockTurn !== view.turnNumber;
    this.#clockTurn = view.turnNumber;
    this.#dispatch({ type: 'turn', myTurn });
    const extra = myTurn && view.turnState.extraShotsUsed > 0 ? t('score.extra', { n: view.turnState.extraShotsLeft }) : view.turnState.shotsLeft ? t('score.shotsLeft', { n: view.turnState.shotsLeft }) : '';
    const doubles = (view as Partial<TeamView>).doubles;
    const onTurn = doubles?.seatOnTurn ? (ctx.seatNames?.[doubles.seatOnTurn] ?? doubles.seatOnTurn) : null;
    const partnerTurn = !!doubles && !myTurn && view.turn === this.seat;
    hud.setTurn(view.turn === this.seat ? 'own' : 'enemy', view.turnNumber, extra, doubles && !myTurn && onTurn ? t('score.seatTurn', { name: onTurn }) : undefined);

    if (turnChanged) {
      this.#idleTime = 0;
      this.#idleTaunted = false;
      this.#clockLeft = null;
      if (myTurn && (!wasMine || quiet)) {
        if (!quiet || this.#seen > 0) {
          hud.banner(t('msg.yourTurnBanner'), 'info');
          this.#p.sound.play('turn');
        }
        hud.setMessage(t(this.#hooks.confirmShots() ? 'msg.yourTurnTouch' : 'msg.yourTurn'), 'info');
      } else if (partnerTurn) {
        hud.setMessage(t('msg.partnerTurn', { name: onTurn ?? '' }), 'neutral');
      } else if (!myTurn) {
        hud.setMessage(t(ctx.host.online ? 'msg.theirTurnOnline' : 'msg.theirTurn', { name: onTurn ?? ctx.teams.enemy.name }), 'neutral');
      }
      this.#frame();
    }

    if (myTurn && ctx.play === 'training') this.#updateCoach(view);
    else {
      this.#coach = null;
      hud.setCoach(null);
    }
    this.#refreshActions();
  }

  #syncMarks(view: PlayerView): void {
    const marks: { cell: OverlayCell; kind: MarkKind }[] = [];
    for (const cell of view.enemy.cells) {
      const at = { side: 'enemy' as const, col: cell.col, row: cell.row };
      if (cell.state === 'spotted') marks.push({ cell: at, kind: cell.shield ? 'shield' : 'spotted' });
      else if (cell.state === 'hit') marks.push({ cell: at, kind: 'hit' });
      else if (cell.state === 'earth') marks.push({ cell: at, kind: 'miss' });
      else if (cell.state === 'rock') marks.push({ cell: at, kind: 'rock' });
    }
    for (const probe of view.intel.probes ?? []) {
      const cell = view.enemy.cells.find((c) => c.col === probe.target.col && c.row === probe.target.row);
      if (cell && cell.state !== 'hidden') continue;
      marks.push({ cell: { side: 'enemy', ...probe.target }, kind: probe.content === 'unit' ? 'probe-unit' : probe.content === 'rock' ? 'probe-rock' : 'probe-earth' });
    }
    for (const cell of view.own.cells) {
      if (cell.exposed && !cell.struck) marks.push({ cell: { side: 'own', col: cell.col, row: cell.row }, kind: 'spotted' });
    }
    for (const piece of view.own.pieces) {
      if (piece.shieldTurns > 0 && !piece.destroyed) for (const c of piece.cells) marks.push({ cell: { side: 'own', ...c }, kind: 'shield' });
    }
    this.overlay.marks = marks;
    const doubles = (view as Partial<TeamView>).doubles;
    this.overlay.partner = doubles ? seatCells(view as TeamView, doubles.partner).map((c) => ({ side: 'own' as const, ...c })) : [];
    this.overlay.radar = view.intel.radar.slice(-3).map((r) => ({ col: r.center.col, row: r.center.row, count: r.count }));
  }

  #syncNotes(view: PlayerView): void {
    const notes: { text: string; tone: MessageTone }[] = [];
    const active = view.mutators?.active ?? [];
    if (active.length > 0) {
      const reason = this.#ctx?.mutatorReason ?? (this.#ctx?.host.online ? t('reason.room') : null);
      notes.push({ text: `${t('note.mutators', { list: active.map(mutatorName).join(', ') })}${reason ? ` (${reason})` : ''}`, tone: 'neutral' });
    }
    if ((view as Partial<TeamView>).doubles) notes.push({ text: t('note.energyTeam'), tone: 'neutral' });
    const tide = view.mutators?.tide;
    if (tide) {
      if (tide.submerged) notes.push({ text: t('tide.under', { n: tide.turnsUntilRecede }), tone: 'warn' });
      else if (tide.turnsUntilRise <= 2) notes.push({ text: t('tide.soon', { n: tide.turnsUntilRise }), tone: 'warn' });
      else notes.push({ text: t('tide.later', { n: tide.turnsUntilRise }), tone: 'neutral' });
      this.overlay.tide = tide.submerged || tide.turnsUntilRise <= 2 ? { rows: tide.rows, rising: !tide.submerged } : null;
      if (!tide.submerged && tide.turnsUntilRise <= 2 && this.#tideWarned !== view.turnNumber && view.phase === 'playing') {
        this.#tideWarned = view.turnNumber;
        this.#p.hud.toast(t('tide.soon', { n: tide.turnsUntilRise }), 'warn');
      }
    } else this.overlay.tide = null;
    if (view.mutators?.fog) notes.push({ text: t('mutator.fog'), tone: 'neutral' });
    if (view.mutators?.doubleShot) notes.push({ text: t('mutator.double'), tone: 'neutral' });
    if (view.enemy.shieldActive) notes.push({ text: t('note.enemyShield'), tone: 'warn' });
    const tower = view.enemy.faction?.tower;
    if (tower && tower.alive > 0) notes.push({ text: t('note.enemyTower', { n: tower.nextFireIn }), tone: 'warn' });
    const ownTower = view.own.faction?.tower;
    if (ownTower && ownTower.alive > 0) notes.push({ text: t('note.ownTower', { n: ownTower.nextFireIn }), tone: 'neutral' });
    if (view.enemy.faction?.testudo && !view.enemy.faction.testudo.used) notes.push({ text: t('note.testudo'), tone: 'neutral' });
    this.#p.hud.setNotes(notes);
  }

  #updateCoach(view: PlayerView): void {
    try {
      this.#coach = aiModule()?.coach(view, { samples: 160 }) ?? null;
    } catch {
      this.#coach = null;
    }
    this.#p.hud.setCoach(this.#coach ? this.#coach.explanation : null);
  }

  #refreshActions(): void {
    const view = this.#view;
    const { hud } = this.#p;
    if (!view || view.phase !== 'playing') {
      hud.setActionBar(null);
      hud.setTargeting(null);
      hud.setFire(null);
      return;
    }
    const tg = this.#flow.targeting;
    const powers = view.config.abilities.length > 0;
    hud.setActionBar({
      energy: view.own.energy,
      energyMax: Math.max((view.own as { energyMax?: number }).energyMax ?? view.config.energy?.max ?? 8, view.own.energy),
      abilities: view.own.abilities,
      special: view.own.faction?.active ? (view.own.faction.special ?? null) : null,
      selected: tg.kind === 'ability' ? tg.ability : tg.kind === 'special' ? 'special' : null,
      enabled: canAim(this.#flow),
      powers,
    });
    hud.setFlag('powers', powers);
    if (tg.kind === 'shot') hud.setTargeting(null);
    else if (tg.kind === 'ability') {
      hud.setTargeting(t(`target.${tg.ability}` as TextKey), tg.ability === 'spy' ? tg.axis : null);
    } else {
      const name = view.own.faction?.special?.name ?? '';
      const key: TextKey = tg.shot === 'double' && tg.first ? 'target.second' : (`target.special.${tg.shot}` as TextKey);
      hud.setTargeting(`${name}: ${t(key)}`, tg.shot === 'line3' ? tg.axis : null);
    }
    this.#refreshFire();
  }

  #refreshFire(): void {
    const armed = this.#flow.armed;
    if (!armed || !canAim(this.#flow)) {
      this.#p.hud.setFire(null);
      return;
    }
    const tg = this.#flow.targeting;
    const cell = cellLabel(armed);
    const label =
      tg.kind === 'shot'
        ? t('target.fireAt', { cell })
        : tg.kind === 'ability'
          ? t('target.useAt', { name: abilityName(tg.ability), cell })
          : t('target.useAt', { name: this.#view?.own.faction?.special?.name ?? '', cell });
    this.#p.hud.setFire(label);
  }

  /** Camera framing for the current phase and turn. */
  #frame(): void {
    const { camera } = this.#p;
    const phone = isPhone(this.#hooks.layout());
    const flow = this.#flow;
    const enemyMid = -(FIELD_INNER_Z + ROWS / 2);
    if (this.#aimMode && flow.phase === 'playing') {
      camera.setPreset('top');
      camera.lookAtZ(enemyMid);
      camera.setZoom(0.62);
      return;
    }
    if (flow.phase === 'placing' || flow.phase === 'waiting') {
      camera.lookAtZ(phone ? -enemyMid * 0.8 : null);
      camera.setZoom(phone ? 0.7 : 1);
      camera.focusSide(1);
      return;
    }
    if (flow.phase === 'playing') {
      const mine = flow.myTurn;
      camera.lookAtZ(phone ? (mine ? enemyMid * 0.8 : -enemyMid * 0.8) : null);
      camera.setZoom(phone ? 0.7 : 1);
      camera.focusSide(mine ? -1 : 1);
      return;
    }
    camera.lookAtZ(null);
    camera.setZoom(1);
  }

  // ------------------------------------------------------------ after animations

  #afterIdle(): void {
    const ctx = this.#ctx;
    const view = this.#view;
    if (!ctx || !view) return;
    this.#refreshActions();
    if (view.phase === 'finished' && !this.#ended) {
      void this.#finish(view);
      return;
    }
    if (isBotDriven(ctx.host) && view.phase === 'playing' && !this.#isMyTurn(view) && !this.#flow.paused) this.#scheduleBot(ctx.host);
  }

  #scheduleBot(host: BotDriven): void {
    if (this.#botBusy) return;
    this.#botBusy = true;
    const generation = this.#generation;
    const delay = rand(BOT_DELAY[0], BOT_DELAY[1]) * (this.#hooks.reducedMotion() ? 0.5 : 1);
    void this.#p.tweens.wait(delay).then(() => {
      this.#botBusy = false;
      if (generation !== this.#generation || this.#flow.paused || this.#pending > 0) return;
      const onTurn = (this.#view as Partial<TeamView> | null)?.doubles?.seatOnTurn;
      const name = (onTurn && this.#ctx?.seatNames?.[onTurn]) || this.#ctx?.teams.enemy.name || '';
      this.#p.hud.setMessage(t(this.#view?.turn === this.seat ? 'msg.partnerTurn' : 'msg.botThinking', { name }), 'neutral');
      if (!host.botStep()) this.#afterIdle();
    });
  }

  // ------------------------------------------------------------ ending

  async #finish(view: PlayerView): Promise<void> {
    if (this.#ended) return;
    this.#ended = true;
    const ctx = this.#ctx;
    if (!ctx) return;
    const generation = this.#generation;
    const { hud, fx, sound, camera, tweens, board } = this.#p;
    const victory = view.winner === this.seat;
    this.#dispatch({ type: 'ended' });
    hud.setPhase('ended');
    hud.setFire(null);
    this.#coach = null;
    this.#resetOverlay();
    this.#syncMarks(view);
    const reasonKey = `end.reason.${view.winReason ?? 'destroyed'}.${victory ? 'won' : 'lost'}` as TextKey;
    hud.setMessage(t(reasonKey), victory ? 'good' : 'bad');
    this.#log(t(reasonKey), victory ? '★' : '✗', victory ? 'good' : 'bad', victory);
    this.#hooks.onPhase('ended');

    // Reveal what was left of the enemy army, then fly over it.
    const layout = view.enemy.layout;
    if (layout) {
      const calm = this.#hooks.reducedMotion();
      camera.lookAtZ(null);
      camera.setPreset('default');
      camera.focusSide(-1);
      camera.setZoom(0.8);
      for (const piece of layout.pieces) {
        const already = view.enemy.destroyed.some((d) => d.cells.some((c) => piece.cells.some((p) => p.col === c.col && p.row === c.row)));
        if (already) continue;
        for (const cell of piece.cells) {
          const index = this.#field.index(cell.col, cell.row);
          if (!board.enemyTiles.isOpen(index)) void board.enemyTiles.flipOpen(index, tweens);
        }
        const unit = this.#field.placePiece({ role: piece.role, cells: piece.cells }, this.opponent, 'enemy');
        if (unit && !calm) void unit.rise(tweens);
        if (!calm) await tweens.wait(0.12);
        if (generation !== this.#generation) return;
      }
      if (!calm) {
        await tweens.run(3.2, (k) => camera.orbitBy(0.0035 * (1 - k), 0));
      }
    }
    if (generation !== this.#generation) return;

    if (victory) {
      fx.victory(this.seat);
      sound.play('victory');
      fx.fireworks.onLaunch = () => sound.play('fireworkLaunch');
      fx.fireworks.onBurst = () => sound.play('fireworkBurst');
    } else {
      fx.defeat(this.seat);
      sound.play('defeat');
      sound.setRain(true);
    }
    if (ctx.host.online === false) this.#botSay(victory ? 'onLose' : 'onWin', 1);
    camera.setZoom(1);
    camera.focusSide(0);

    this.#hooks.onEnd({
      victory,
      reason: t(reasonKey),
      stats: statsOf(view),
      durationMs: Math.max(0, ctx.host.now() - this.#startedAt),
      play: ctx.play,
      setup: ctx.setup,
    });
  }

  // ------------------------------------------------------------ per-frame helpers

  #updateClock(): void {
    const ctx = this.#ctx;
    const view = this.#view;
    const { hud, sound } = this.#p;
    if (!ctx || !view) return;
    if (view.phase !== 'playing') {
      // Online placement shows the server deadline (set by the app); otherwise no clock.
      if (view.phase !== 'placing' || !ctx.host.online) hud.setClock('', '', 0, null);
      return;
    }
    const doubles = (view as Partial<TeamView>).doubles;
    // Doubles: each seat has its own clock; the team view gives the deadline of the seat on turn.
    const reading = doubles ? seatReading(doubles.deadline, ctx.host.now()) : readClock({ ...view.clock, now: ctx.host.now() });
    const mine = this.#isMyTurn(view);
    const note = reading.phase === 'bank' ? t('clock.bank') : reading.phase === 'frozen' ? t('clock.frozen') : reading.phase === 'none' ? t('clock.none') : t(mine ? 'clock.yours' : 'clock.theirs');
    hud.setClock(reading.phase === 'none' ? '' : reading.text, note, mine ? reading.warn : 0, mine ? 'own' : 'enemy');
    if (mine && !this.#flow.paused) {
      const warn = crossedWarning(this.#clockLeft, reading.leftMs);
      if (warn === 10) {
        sound.play('warn10');
        hud.toast(t('clock.warn10'), 'warn', 2);
      } else if (warn === 5) {
        sound.play('warn5');
        hud.announce(t('clock.warn5'));
      } else if (crossedSecond(this.#clockLeft, reading.leftMs)) sound.play('tick');
    }
    this.#clockLeft = reading.leftMs;
  }

  /** Online placement deadline shown in the clock slot. */
  setPlacementDeadline(deadline: number | null): void {
    const ctx = this.#ctx;
    if (!ctx || this.#flow.phase === 'playing') return;
    if (deadline === null) {
      this.#p.hud.setClock('', '', 0, null);
      return;
    }
    const left = deadline - ctx.host.now();
    this.#p.hud.setClock(formatSeconds(left), t('clock.placing'), left < 10_000 ? 10 : 0, 'own');
  }

  #updateIdle(dt: number): void {
    const ctx = this.#ctx;
    if (!ctx || ctx.host.online || this.#flow.paused || !canAim(this.#flow)) return;
    this.#idleTime += dt;
    if (!this.#idleTaunted && this.#idleTime > 18) {
      this.#idleTaunted = true;
      this.#botSay('onIdle', 0.7);
    }
  }

  #updateOverlay(): void {
    const o = this.overlay;
    const flow = this.#flow;
    o.coordinates = this.#hooks.coordinates();
    o.glyphs = this.#hooks.glyphs();
    o.hover = this.#hover && this.#interactive(this.#hover) ? this.#hover : null;
    o.armed = flow.armed ? { side: targetField(flow.targeting), ...flow.armed } : null;
    o.ghost = null;
    o.footprint = [];
    if (flow.phase === 'placing' && this.#editor?.held) {
      const target = this.#hover?.side === 'own' ? this.#hover : null;
      const preview = target ? this.#editor.preview(target) : null;
      o.ghost = preview ? { cells: preview.cells.map((c) => ({ side: 'own' as const, ...c })), ok: preview.ok } : null;
    }
    if (canAim(flow)) {
      const field = targetField(flow.targeting);
      const at = flow.armed ?? (this.#hover?.side === field ? this.#hover : null);
      if (at && flow.targeting.kind !== 'shot') o.footprint = footprintOf(flow.targeting, this.#field.cols, this.#field.rows, at).map((c) => ({ side: field, ...c }));
      const special = flow.targeting.kind === 'special' ? flow.targeting : null;
      if (special?.first) o.footprint = [...o.footprint, { side: 'enemy', ...special.first }];
    }
    const showHeat = this.#ctx?.play === 'training' && this.#hooks.heatMap() && flow.phase === 'playing' && flow.myTurn;
    o.heat = showHeat && this.#coach ? this.#coach.heat : null;
    o.best = showHeat && this.#coach?.best ? { side: 'enemy', ...this.#coach.best } : null;
  }

  #updateHoverTile(): void {
    const tiles = this.#p.board.enemyTiles;
    const hover = this.#hover;
    const active = hover && hover.side === 'enemy' && canAim(this.#flow) && targetField(this.#flow.targeting) === 'enemy';
    const index = active ? this.#field.index(hover.col, hover.row) : null;
    tiles.setHovered(index !== null && !tiles.isOpen(index) ? index : null);    const marker = this.#p.board.marker;
    if (hover && this.#interactive(hover)) {
      const field = hover.side === 'enemy' ? this.#p.board.enemyTiles : this.#p.board.ownTiles;
      marker.show(field.topOf(this.#field.index(hover.col, hover.row)));
      this.#p.board.wildlife.onHoverIdle(hover.side === 'enemy' ? field.topOf(this.#field.index(hover.col, hover.row)) : null);
    } else marker.hide();
  }

  #interactive(pick: Pick): boolean {
    if (this.#flow.phase === 'placing') return pick.side === 'own' && canPlace(this.#flow);
    return canAim(this.#flow) && pick.side === targetField(this.#flow.targeting);
  }

  #enemyCellOpen(pick: Pick): boolean {
    const cell = this.#view?.enemy.cells.find((c) => c.col === pick.col && c.row === pick.row);
    return cell !== undefined && cell.state !== 'hidden' && cell.state !== 'spotted';
  }

  /** Tooltip / screen-reader text for a cell. */
  #describe(pick: Pick): string {
    const label = cellLabel(pick);
    const view = this.#view;
    if (!view) return label;
    if (pick.side === 'enemy') {
      const cell = view.enemy.cells.find((c) => c.col === pick.col && c.row === pick.row);
      const state = cell?.state ?? 'hidden';
      const what =
        state === 'hit'
          ? `✓ ${cell?.role ? roleName(cell.role) : t('cell.hit')}`
          : state === 'earth'
            ? `✗ ${t('cell.earth')}`
            : state === 'rock'
              ? `◆ ${t('cell.rock')}`
              : state === 'spotted'
                ? `! ${t('cell.spotted')}`
                : t('cell.hidden');
      return `${label} · ${what}`;
    }
    if (this.#editor && this.#flow.phase === 'placing') {
      const preview = this.#editor.held ? this.#editor.preview(pick) : null;
      if (preview && !preview.ok && preview.error) return `${label} · ${placementError(preview.error)}`;
      const slot = this.#editor.slotAt(pick.col, pick.row);
      if (slot >= 0) return `${label} · ${roleName(this.#editor.pieces[slot]!.role)}`;
    }
    const own = view.own.cells.find((c) => c.col === pick.col && c.row === pick.row);
    if (!own) return label;
    const what = own.role ? roleName(own.role) + (own.struck ? ` (${t('cell.damaged')})` : '') : own.terrain === 'rock' ? t('cell.rock') : t('cell.earth');
    return `${label} · ${what}`;
  }

  // ------------------------------------------------------------ bot voice

  #botSay(event: TauntEvent, chance = 1): void {
    const host = this.#ctx?.host;
    if (!isBotDriven(host) || Math.random() > chance) return;
    const text = host.bot.taunt(event);
    if (!text) return;
    const expression: Expression = event === 'onHit' || event === 'onIdle' ? 'taunt' : event === 'onLostPiece' ? 'hit' : event === 'onWin' ? 'win' : event === 'onLose' ? 'lose' : 'neutral';
    this.#p.hud.say(this.#ctx!.teams.enemy.name, text, this.#hooks.portrait(expression));
  }

  #botEmote(): void {
    const choices: EmojiId[] = ['risada', 'susto', 'pensando', 'joinha', 'fogo'];
    const id = choices[Math.floor(Math.random() * choices.length)] ?? 'joinha';
    const generation = this.#generation;
    void this.#p.tweens.wait(rand(0.5, 1.1)).then(() => {
      if (generation === this.#generation) this.showEmote(this.opponent, 'emoji', id);
    });
  }

  // ------------------------------------------------------------ misc

  #tapPlacement(pick: Pick): void {
    const editor = this.#editor;
    if (!editor || !canPlace(this.#flow) || pick.side !== 'own') {
      if (this.#flow.phase === 'waiting') this.#p.hud.toast(t('place.waiting'), 'neutral', 1.6);
      return;
    }
    if (editor.held) {
      const error = editor.drop(pick);
      if (error) this.#rejectPlacement(error);
      else this.#p.sound.play('click');
      return;
    }
    if (editor.pickAt(pick.col, pick.row)) {
      this.#p.sound.play('click');
      this.#p.hud.announce(t('place.holding', { piece: roleName(editor.pieces[editor.held!.slot]!.role) }));
    }
  }

  #mark(cell: OverlayCell, kind: MarkKind): void {
    this.overlay.marks = [...this.overlay.marks, { cell, kind }];
  }

  #log(text: string, glyph: string, tone: MessageTone, mine: boolean): void {
    this.#p.hud.addLog({ text, glyph, tone, mine });
  }

  #errorText(result: HostResult): string {
    if (result.ok) return '';
    if (result.message) return result.message;
    const key = `err.${result.error}` as TextKey;
    const text = t(key);
    return text === key ? placementError(result.error) : text;
  }

  /** Log name of whoever played: you, your partner (doubles) or the other side. */
  #who(mineTeam: boolean): string {
    const actor = this.#actor;
    const names = this.#ctx?.seatNames;
    const mySeat = (this.#view as Partial<TeamView> | null)?.doubles?.seat;
    if (actor && names && actor !== mySeat) return names[actor] ?? actor;
    return mineTeam ? t('social.you') : t('player.opponent');
  }

  /** Doubles views say which seat plays; 1v1 views only say which side. */
  #isMyTurn(view: PlayerView): boolean {
    const doubles = (view as Partial<TeamView>).doubles;
    return doubles ? doubles.myTurn : view.turn === this.seat;
  }

  #seatConfirmed(view: PlayerView): boolean {
    const doubles = (view as Partial<TeamView>).doubles;
    return doubles ? (doubles.team.find((s) => s.seat === doubles.seat)?.confirmed ?? false) : view.own.confirmed;
  }

  #resetOverlay(): void {
    Object.assign(this.overlay, emptyOverlay());
    this.overlay.field = { cols: this.#field.cols, rows: this.#field.rows, offset: this.#field.offset };
  }

  #dispatch(event: FlowEvent): void {
    const before = this.#flow;
    this.#flow = reduceFlow(before, event);
    if (before.targeting !== this.#flow.targeting || before.armed !== this.#flow.armed || before.busy !== this.#flow.busy) this.#refreshActions();
    if (before.phase !== this.#flow.phase && this.#flow.phase === 'waiting') this.#editorDrawn = -1;
  }
}

export { sideOf };
