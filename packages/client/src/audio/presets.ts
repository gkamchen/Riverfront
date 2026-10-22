/** Built-in ids; factions register more at load time (see registerSfxPreset). */
export type SfxPresetId = string;

/**
 * Signature phrase a faction plays for its turn cue, special moments and the
 * victory sting. Everything is synthesised:
 * - pluck: bright, short Karplus-Strong string over a frame drum;
 * - lyre: soft, long Karplus-Strong strum;
 * - brass: detuned saws through an opening filter, with timpani;
 * - flute: breathy sine with vibrato;
 * - drum: big low drums and a wooden click;
 * - bell: inharmonic FM bells;
 * - horn: low, slow brass call.
 */
export type MotifStyle = 'pluck' | 'lyre' | 'brass' | 'flute' | 'drum' | 'bell' | 'horn';

/** Per-theme (or per-faction) flavour of the synthesised sounds. */
export interface SfxPreset {
  readonly id: SfxPresetId;
  /** Start frequency of the sub "thump" under explosions. */
  readonly boomHz: number;
  /** Seconds of rumble after an explosion. */
  readonly rumble: number;
  /** Multiplier on filter cut-offs (higher = brighter, crisper). */
  readonly brightness: number;
  /** Reverb send level and tail length. */
  readonly reverb: number;
  readonly reverbTime: number;
  /** What a shot into the river sounds like. */
  readonly surface: 'water' | 'lava' | 'ice';
  /** Constant background bed. */
  readonly ambience: 'river' | 'lava' | 'wind';
  /** Signature phrase; without it the generic brass fanfare is used. */
  readonly motif?: {
    readonly style: MotifStyle;
    /** Root note in Hz. */
    readonly root: number;
    /** Scale as semitone offsets from the root. */
    readonly scale: readonly number[];
    /** Scale degrees of the phrase (indices into `scale`, may exceed its length to go up an octave). */
    readonly phrase: readonly number[];
    /** Seconds per step. */
    readonly step: number;
  };
}

export const SCALES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  /** Japanese 'in' pentatonic (miyako-bushi). */
  in: [0, 1, 5, 7, 8],
} as const;

const SFX_PRESETS: Record<SfxPresetId, SfxPreset> = {
  vale: { id: 'vale', boomHz: 110, rumble: 1.6, brightness: 1, reverb: 0.18, reverbTime: 1.6, surface: 'water', ambience: 'river' },
  vulcao: { id: 'vulcao', boomHz: 80, rumble: 2.6, brightness: 0.75, reverb: 0.26, reverbTime: 2.4, surface: 'lava', ambience: 'lava' },
  tundra: { id: 'tundra', boomHz: 130, rumble: 1.2, brightness: 1.35, reverb: 0.34, reverbTime: 3.2, surface: 'ice', ambience: 'wind' },
};

export function registerSfxPreset(preset: SfxPreset): void {
  SFX_PRESETS[preset.id] = preset;
}

/** Unknown ids fall back to the valley preset. */
export function sfxPreset(id: SfxPresetId): SfxPreset {
  return SFX_PRESETS[id] ?? SFX_PRESETS.vale!;
}
