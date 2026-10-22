import { sfxPreset, type MotifStyle, type SfxPreset, type SfxPresetId } from './presets';

export type SoundName =
  | 'click'
  | 'hover'
  | 'tick'
  | 'launch'
  | 'hit'
  | 'explosion'
  | 'splash'
  | 'dust'
  | 'rockChips'
  | 'turn'
  | 'warn10'
  | 'warn5'
  | 'victory'
  | 'defeat'
  | 'plop'
  | 'frog'
  | 'bird'
  | 'flap'
  | 'sizzle'
  | 'seal'
  | 'crack'
  | 'fireworkLaunch'
  | 'fireworkBurst'
  | 'gull'
  | 'grunt'
  | 'snap'
  | 'motif';

export const SOUND_NAMES: readonly SoundName[] = [
  'click',
  'hover',
  'tick',
  'launch',
  'hit',
  'explosion',
  'splash',
  'dust',
  'rockChips',
  'turn',
  'warn10',
  'warn5',
  'victory',
  'defeat',
  'plop',
  'frog',
  'bird',
  'flap',
  'sizzle',
  'seal',
  'crack',
  'fireworkLaunch',
  'fireworkBurst',
  'gull',
  'grunt',
  'snap',
  'motif',
];

interface Voice {
  start: number;
  dest?: AudioNode;
}

/**
 * Synthesiser for every game sound. Nothing is loaded from disk: each sound is
 * a few oscillators and filtered noise, shaped by the active theme preset.
 * The audio context is only created inside `unlock()`, which must run from a
 * user gesture.
 */
export class SoundBoard {
  #context: AudioContext | null = null;
  #master: GainNode | null = null;
  #dry: GainNode | null = null;
  #wet: GainNode | null = null;
  #reverb: ConvolverNode | null = null;
  #noiseBuffer: AudioBuffer | null = null;
  #ambience: { source: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  #rain: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  #preset: SfxPreset = sfxPreset('vale');
  readonly #plucks = new Map<string, AudioBuffer>();
  #muted = true;
  #volume = 0.8;
  #ambienceOn = true;
  #lastPlayed = new Map<SoundName, number>();

  get muted(): boolean {
    return this.#muted;
  }

  get volume(): number {
    return this.#volume;
  }

  get preset(): SfxPresetId {
    return this.#preset.id;
  }

  get unlocked(): boolean {
    return this.#context !== null;
  }

  /** Must be called from a user gesture; browsers block audio before that. */
  unlock(): void {
    if (!this.#context) this.#createContext();
    void this.#context?.resume();
    this.#syncAmbience();
  }

  setMuted(muted: boolean): void {
    this.#muted = muted;
    if (!muted) this.unlock();
    this.#applyGain();
  }

  /** Master volume, 0..1. */
  setVolume(volume: number): void {
    this.#volume = Math.min(1, Math.max(0, volume));
    this.#applyGain();
  }

  setPreset(id: SfxPresetId): void {
    this.#preset = sfxPreset(id);
    if (this.#context) {
      this.#reverb!.buffer = this.#impulse(this.#preset.reverbTime);
      this.#wet!.gain.value = this.#preset.reverb;
      this.#stopAmbience();
      this.#syncAmbience();
    }
  }

  /** Background bed (river, lava rumble or wind). */
  setAmbience(on: boolean): void {
    this.#ambienceOn = on;
    this.#syncAmbience();
  }

  /** Rain loop for the defeat screen. */
  setRain(on: boolean): void {
    const ctx = this.#context;
    if (!ctx) return;
    if (on && !this.#rain) {
      const source = this.#loop();
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.12, ctx.currentTime, 0.8);
      source.connect(filter).connect(gain).connect(this.#dry!);
      source.start();
      this.#rain = { source, gain };
    } else if (!on && this.#rain) {
      const rain = this.#rain;
      rain.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
      rain.source.stop(ctx.currentTime + 2);
      this.#rain = null;
    }
  }

  play(name: SoundName): void {
    const ctx = this.#context;
    if (this.#muted || !ctx || !this.#master) return;
    const now = ctx.currentTime;
    // Avoid machine-gunning identical sounds in the same few milliseconds.
    const last = this.#lastPlayed.get(name) ?? -1;
    const gap = name === 'hover' || name === 'tick' ? 0.05 : 0.025;
    if (now - last < gap) return;
    this.#lastPlayed.set(name, now);
    const b = this.#preset.brightness;
    const v: Voice = { start: now };

    switch (name) {
      case 'click':
        this.#tone(v, 880, 0.06, 'triangle', 0.25, 1320);
        break;
      case 'hover':
        this.#tone(v, 1600, 0.025, 'sine', 0.05);
        break;
      case 'tick':
        this.#tone(v, 1900 * b, 0.02, 'sine', 0.12);
        this.#noise(v, 0.012, 0.08, 'highpass', 5000, 5000, 1);
        break;
      case 'launch':
        this.#noise(v, 0.45, 0.35, 'bandpass', 600 * b, 2400 * b, 2);
        this.#tone(v, 180, 0.18, 'sawtooth', 0.12, 90);
        break;
      case 'hit':
        this.#noise(v, 0.22, 0.55, 'bandpass', 2400 * b, 900 * b, 4);
        this.#tone(v, 320, 0.12, 'square', 0.12, 140);
        this.#tone(v, 1250 * b, 0.08, 'triangle', 0.1, 900);
        break;
      case 'explosion':
        this.#explosion(v);
        break;
      case 'splash':
        this.#surfaceSplash(v);
        break;
      case 'dust':
        this.#tone(v, 95, 0.25, 'sine', 0.45, 45);
        this.#noise(v, 0.35, 0.35, 'lowpass', 900 * b, 200, 0.8, true);
        break;
      case 'rockChips':
        this.#tone(v, 140, 0.15, 'sine', 0.35, 70);
        for (let i = 0; i < 7; i++) this.#noise({ start: now + 0.02 + Math.random() * 0.3 }, 0.015, 0.25, 'bandpass', 3200 * b, 2600 * b, 6);
        break;
      case 'turn':
        this.#tone(v, 523.25, 0.18, 'sine', 0.16);
        this.#tone({ start: now + 0.09 }, 783.99, 0.26, 'sine', 0.13);
        break;
      case 'warn10':
        this.#woodblock(now, 1000);
        break;
      case 'warn5':
        this.#woodblock(now, 1400);
        this.#woodblock(now + 0.11, 1400);
        break;
      case 'victory':
        if (this.#preset.motif) this.#motif(now, true);
        else this.#fanfare(now);
        break;
      case 'defeat':
        this.#sting(now);
        break;
      case 'plop':
        this.#tone(v, 720, 0.12, 'sine', 0.3, 170);
        this.#noise(v, 0.05, 0.08, 'bandpass', 1500, 800, 2);
        break;
      case 'frog':
        this.#frog(now);
        break;
      case 'bird':
        this.#bird(now);
        break;
      case 'flap':
        for (let i = 0; i < 6; i++) this.#noise({ start: now + i * 0.11 }, 0.08, 0.22 * (1 - i / 7), 'lowpass', 700, 300, 1, true);
        break;
      case 'sizzle':
        this.#noise(v, 0.6, 0.25, 'highpass', 4000, 6500, 0.7, true);
        this.#tone(v, 110, 0.25, 'sine', 0.25, 60);
        break;
      case 'seal':
        this.#formant(now, 330, 230, 0.22);
        this.#formant(now + 0.3, 300, 210, 0.2);
        break;
      case 'crack':
        this.#noise(v, 0.06, 0.6, 'bandpass', 3000, 1800, 3, true);
        this.#tone(v, 2100, 0.35, 'sine', 0.12, 700);
        this.#tone({ start: now + 0.02 }, 2900, 0.25, 'sine', 0.08, 1100);
        break;
      case 'fireworkLaunch':
        this.#tone(v, 700, 0.7, 'sine', 0.06, 2600);
        this.#noise(v, 0.6, 0.08, 'bandpass', 1500, 4000, 3);
        break;
      case 'gull':
        this.#gull(now);
        break;
      case 'grunt':
        this.#formant(now, 110, 70, 0.5);
        this.#formant(now + 0.45, 95, 60, 0.35);
        this.#noise({ start: now }, 0.6, 0.12, 'lowpass', 400, 120, 1, true);
        break;
      case 'snap':
        this.#noise(v, 0.05, 0.6, 'bandpass', 1800, 900, 2);
        this.#tone(v, 210, 0.08, 'square', 0.15, 90);
        this.#surfaceSplash({ start: now + 0.03 });
        break;
      case 'motif':
        if (this.#preset.motif) this.#motif(now, false);
        else this.#fanfare(now);
        break;
      case 'fireworkBurst':
        this.#noise(v, 0.5, 0.45, 'lowpass', 3000, 300, 0.8, true);
        this.#tone(v, 70, 0.4, 'sine', 0.35, 35);
        for (let i = 0; i < 12; i++) this.#noise({ start: now + 0.15 + Math.random() * 0.8 }, 0.012, 0.18, 'bandpass', 4500, 4500, 5, true);
        break;
    }
  }

  // ------------------------------------------------------------ setup

  #createContext(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 6;
    const master = ctx.createGain();
    master.connect(compressor).connect(ctx.destination);
    const dry = ctx.createGain();
    dry.connect(master);
    const reverb = ctx.createConvolver();
    const wet = ctx.createGain();
    wet.gain.value = this.#preset.reverb;
    reverb.connect(wet).connect(master);

    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.#context = ctx;
    this.#master = master;
    this.#dry = dry;
    this.#wet = wet;
    this.#reverb = reverb;
    this.#noiseBuffer = noise;
    reverb.buffer = this.#impulse(this.#preset.reverbTime);
    this.#applyGain();
  }

  #applyGain(): void {
    if (!this.#master || !this.#context) return;
    this.#master.gain.setTargetAtTime(this.#muted ? 0 : this.#volume, this.#context.currentTime, 0.03);
  }

  /** Exponentially decaying stereo noise: a cheap room. */
  #impulse(seconds: number): AudioBuffer {
    const ctx = this.#context!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    return buffer;
  }

  #loop(): AudioBufferSourceNode {
    const source = this.#context!.createBufferSource();
    source.buffer = this.#noiseBuffer;
    source.loop = true;
    return source;
  }

  #syncAmbience(): void {
    const ctx = this.#context;
    if (!ctx) return;
    if (!this.#ambienceOn) {
      this.#stopAmbience();
      return;
    }
    if (this.#ambience) return;
    const source = this.#loop();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const kind = this.#preset.ambience;
    filter.type = kind === 'wind' ? 'bandpass' : 'lowpass';
    filter.frequency.value = kind === 'river' ? 650 : kind === 'lava' ? 160 : 420;
    filter.Q.value = kind === 'wind' ? 1.8 : 0.6;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(kind === 'lava' ? 0.09 : 0.035, ctx.currentTime, 1.2);
    // Slow modulation keeps the bed from sounding like static.
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = kind === 'wind' ? 0.13 : 0.31;
    depth.gain.value = kind === 'wind' ? 260 : 120;
    lfo.connect(depth).connect(filter.frequency);
    lfo.start();
    source.connect(filter).connect(gain).connect(this.#dry!);
    source.start(0, Math.random());
    source.onended = () => lfo.stop();
    this.#ambience = { source, gain, filter };
  }

  #stopAmbience(): void {
    const ctx = this.#context;
    const bed = this.#ambience;
    if (!ctx || !bed) return;
    bed.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    bed.source.stop(ctx.currentTime + 1.5);
    this.#ambience = null;
  }

  // ------------------------------------------------------------ building blocks

  #tone(v: Voice, freq: number, duration: number, type: OscillatorType, volume: number, endFreq?: number, wet = false): void {
    const ctx = this.#context!;
    const start = v.start;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.#dry!);
    if (wet) gain.connect(this.#reverb!);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  #noise(
    v: Voice,
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    fromHz: number,
    toHz: number,
    q: number,
    wet = false,
  ): void {
    const ctx = this.#context!;
    const start = v.start;
    const source = ctx.createBufferSource();
    source.buffer = this.#noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(Math.min(fromHz, 18000), start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, Math.min(toHz, 18000)), start + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.01, duration * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.#dry!);
    if (wet) gain.connect(this.#reverb!);
    source.start(start, Math.random() * 1.2);
    source.stop(start + duration + 0.05);
  }

  /** Layered blast: transient crack, filtered body, sub thump, crackle, rumble. */
  #explosion(v: Voice): void {
    const p = this.#preset;
    const now = v.start;
    this.#noise(v, 0.04, 0.7, 'highpass', 2500 * p.brightness, 3000, 0.7);
    this.#noise(v, 1.2, 0.85, 'lowpass', 2800 * p.brightness, 140, 1, true);
    this.#tone(v, p.boomHz, 0.9, 'sine', 0.8, 30);
    this.#tone({ start: now + 0.015 }, p.boomHz / 2, 1.1, 'triangle', 0.4, 26);
    for (let i = 0; i < 9; i++) {
      this.#noise({ start: now + 0.15 + Math.random() * 0.8 }, 0.02, 0.15 + Math.random() * 0.15, 'bandpass', 2500 * p.brightness, 1800, 4, true);
    }
    this.#noise({ start: now + 0.1 }, p.rumble, 0.28, 'lowpass', 320, 60, 0.7, true);
  }

  #surfaceSplash(v: Voice): void {
    const surface = this.#preset.surface;
    const now = v.start;
    if (surface === 'lava') {
      this.#noise(v, 0.7, 0.35, 'highpass', 3500, 6000, 0.7, true);
      this.#tone(v, 140, 0.3, 'sine', 0.35, 55);
      this.#tone({ start: now + 0.2 }, 90, 0.25, 'sine', 0.2, 50);
      return;
    }
    if (surface === 'ice') {
      this.#noise(v, 0.08, 0.6, 'bandpass', 3200, 2000, 3, true);
      this.#tone(v, 2300, 0.45, 'sine', 0.12, 650, true);
      for (let i = 0; i < 6; i++) this.#tone({ start: now + 0.03 + Math.random() * 0.25 }, 3000 + Math.random() * 2500, 0.05, 'sine', 0.05);
      return;
    }
    this.#noise(v, 0.42, 0.5, 'bandpass', 1900, 450, 1.1, true);
    this.#tone(v, 160, 0.2, 'sine', 0.3, 70);
    for (let i = 0; i < 7; i++) {
      const f = 900 + Math.random() * 1400;
      this.#tone({ start: now + 0.05 + Math.random() * 0.35 }, f, 0.035, 'sine', 0.06, f * 1.6);
    }
  }

  #woodblock(start: number, freq: number): void {
    this.#tone({ start }, freq, 0.07, 'sine', 0.32);
    this.#tone({ start }, freq * 2.6, 0.04, 'triangle', 0.1);
    this.#noise({ start }, 0.015, 0.15, 'bandpass', freq * 3, freq * 3, 2);
  }

  #frog(start: number): void {
    const ctx = this.#context!;
    for (let k = 0; k < 2; k++) {
      const t0 = start + k * 0.14;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(k === 0 ? 190 : 230, t0);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 950;
      filter.Q.value = 3;
      const am = ctx.createGain();
      am.gain.value = 0;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 42;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      lfo.connect(lfoGain).connect(am.gain);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.35, t0 + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(filter).connect(am).connect(env).connect(this.#dry!);
      osc.start(t0);
      lfo.start(t0);
      osc.stop(t0 + 0.12);
      lfo.stop(t0 + 0.12);
    }
  }

  /** FM chirps: a carrier swept up and down, modulated by a lower sine. */
  #bird(start: number): void {
    const ctx = this.#context!;
    const chirps = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1200;
    for (let k = 0; k < chirps; k++) {
      const t0 = start + k * (0.1 + Math.random() * 0.06);
      const carrier = ctx.createOscillator();
      const modulator = ctx.createOscillator();
      const depth = ctx.createGain();
      const env = ctx.createGain();
      carrier.frequency.setValueAtTime(base * 0.8, t0);
      carrier.frequency.exponentialRampToValueAtTime(base * 1.35, t0 + 0.04);
      carrier.frequency.exponentialRampToValueAtTime(base, t0 + 0.08);
      modulator.frequency.value = base * 0.5;
      depth.gain.value = 500;
      modulator.connect(depth).connect(carrier.frequency);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.085);
      carrier.connect(env).connect(this.#dry!);
      env.connect(this.#reverb!);
      carrier.start(t0);
      modulator.start(t0);
      carrier.stop(t0 + 0.1);
      modulator.stop(t0 + 0.1);
    }
  }

  #formant(start: number, from: number, to: number, duration: number): void {
    const ctx = this.#context!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 750;
    filter.Q.value = 4;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.3, start + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(filter).connect(env).connect(this.#dry!);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  /** Brassy voice: detuned saws through an opening low-pass. */
  #brass(start: number, freq: number, duration: number, volume: number): void {
    const ctx = this.#context!;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, start);
    filter.frequency.exponentialRampToValueAtTime(3200 * this.#preset.brightness, start + 0.08);
    filter.frequency.exponentialRampToValueAtTime(1400, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(volume, start + 0.03);
    env.gain.setValueAtTime(volume * 0.8, start + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    filter.connect(env).connect(this.#dry!);
    env.connect(this.#reverb!);
    for (const detune of [-7, 6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    }
  }

  /** Herring-gull style cry: a falling, nasal squeal repeated. */
  #gull(start: number): void {
    for (let k = 0; k < 3; k++) {
      const t0 = start + k * 0.2;
      const ctx = this.#context!;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400 - k * 80, t0);
      osc.frequency.exponentialRampToValueAtTime(820, t0 + 0.16);
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1900;
      filter.Q.value = 3;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.17);
      osc.connect(filter).connect(env).connect(this.#dry!);
      env.connect(this.#reverb!);
      osc.start(t0);
      osc.stop(t0 + 0.2);
    }
  }

  // ------------------------------------------------------------ faction motifs

  /** Plays the preset's signature phrase; the victory form is longer and ends high. */
  #motif(now: number, victory: boolean): void {
    const motif = this.#preset.motif;
    if (!motif) return;
    const scale = motif.scale;
    const freqOf = (degree: number) => {
      const octave = Math.floor(degree / scale.length);
      const semis = (scale[((degree % scale.length) + scale.length) % scale.length] ?? 0) + octave * 12;
      return motif.root * Math.pow(2, semis / 12);
    };
    const phrase = victory ? [...motif.phrase, ...motif.phrase.slice(-2).map((d) => d + scale.length), scale.length] : motif.phrase;
    phrase.forEach((degree, i) => {
      const at = now + i * motif.step;
      const last = i === phrase.length - 1;
      const length = last ? motif.step * 4 : motif.step * 1.6;
      this.#note(motif.style, at, freqOf(degree), length, last);
    });
    if (victory) {
      const end = now + phrase.length * motif.step;
      // Close on a chord of root, fifth and octave.
      for (const degree of [scale.length, scale.length + 4, scale.length * 2]) this.#note(motif.style, end, freqOf(degree), motif.step * 6, true);
    }
    // Percussion bed that fits the style.
    if (motif.style === 'pluck' || motif.style === 'drum') {
      for (let i = 0; i < phrase.length; i += 2) this.#frameDrum(now + i * motif.step, i % 4 === 0 ? 1 : 0.6);
    }
    if (motif.style === 'brass' || motif.style === 'horn') this.#tone({ start: now }, 98, 0.5, 'sine', 0.3, 80, true);
  }

  #note(style: MotifStyle, start: number, freq: number, length: number, accent: boolean): void {
    switch (style) {
      case 'pluck':
        this.#pluck(start, freq, 0.991, 0.65, accent ? 0.32 : 0.24);
        break;
      case 'lyre':
        this.#pluck(start, freq, 0.9975, 0.25, accent ? 0.26 : 0.2);
        this.#pluck(start + 0.012, freq * 2, 0.996, 0.2, 0.06);
        break;
      case 'brass':
      case 'horn':
        this.#brass(start, style === 'horn' ? freq / 2 : freq, length, accent ? 0.12 : 0.09);
        break;
      case 'flute':
        this.#flute(start, freq * 2, length, accent ? 0.11 : 0.08);
        break;
      case 'drum':
        this.#tone({ start }, freq / 2, length, 'triangle', 0.18, freq / 2.2, true);
        break;
      case 'bell':
        this.#bell(start, freq * 2, length * 1.5, accent ? 0.12 : 0.08);
        break;
    }
  }

  /** Karplus-Strong string. decay ~0.99..0.998, brightness 0 (dull) .. 1 (bright). */
  #pluck(start: number, freq: number, decay: number, brightness: number, volume: number): void {
    const ctx = this.#context!;
    const key = freq.toFixed(1) + ':' + decay + ':' + brightness;
    let buffer = this.#plucks.get(key);
    if (!buffer) {
      const rate = ctx.sampleRate;
      const length = Math.floor(rate * 2.2);
      buffer = ctx.createBuffer(1, length, rate);
      const out = buffer.getChannelData(0);
      const period = Math.max(2, Math.round(rate / freq));
      const ring = new Float32Array(period);
      // Excitation: noise, smoothed more for darker strings.
      let last = 0;
      for (let i = 0; i < period; i++) {
        const n = Math.random() * 2 - 1;
        last = last + (n - last) * (0.25 + brightness * 0.75);
        ring[i] = last;
      }
      let index = 0;
      for (let i = 0; i < length; i++) {
        const a = ring[index]!;
        const b = ring[(index + 1) % period]!;
        out[i] = a;
        ring[index] = decay * (a * brightness * 0.5 + ((a + b) / 2) * (1 - brightness * 0.5));
        index = (index + 1) % period;
      }
      this.#plucks.set(key, buffer);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain).connect(this.#dry!);
    gain.connect(this.#reverb!);
    source.start(start);
    source.stop(start + 2.2);
  }

  #frameDrum(start: number, level: number): void {
    this.#tone({ start }, 120, 0.25, 'sine', 0.35 * level, 70);
    this.#noise({ start }, 0.06, 0.12 * level, 'bandpass', 900, 600, 1.5);
  }

  #flute(start: number, freq: number, duration: number, volume: number): void {
    const ctx = this.#context!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const vibrato = ctx.createOscillator();
    const depth = ctx.createGain();
    vibrato.frequency.value = 5.2;
    depth.gain.value = freq * 0.006;
    vibrato.connect(depth).connect(osc.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(volume, start + 0.06);
    env.gain.setValueAtTime(volume * 0.85, start + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(env).connect(this.#dry!);
    env.connect(this.#reverb!);
    osc.start(start);
    vibrato.start(start);
    osc.stop(start + duration + 0.05);
    vibrato.stop(start + duration + 0.05);
    this.#noise({ start }, Math.min(0.15, duration), volume * 0.5, 'bandpass', freq * 2, freq * 2, 2);
  }

  /** Two-operator FM with an inharmonic ratio: a struck bell. */
  #bell(start: number, freq: number, duration: number, volume: number): void {
    const ctx = this.#context!;
    const carrier = ctx.createOscillator();
    const modulator = ctx.createOscillator();
    const depth = ctx.createGain();
    carrier.frequency.value = freq;
    modulator.frequency.value = freq * 1.41;
    depth.gain.setValueAtTime(freq * 2.2, start);
    depth.gain.exponentialRampToValueAtTime(freq * 0.05, start + duration);
    modulator.connect(depth).connect(carrier.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(volume, start + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    carrier.connect(env).connect(this.#dry!);
    env.connect(this.#reverb!);
    carrier.start(start);
    modulator.start(start);
    carrier.stop(start + duration + 0.05);
    modulator.stop(start + duration + 0.05);
  }

  #fanfare(now: number): void {
    const notes: Array<[number, number, number]> = [
      [392, 0, 0.12],
      [392, 0.13, 0.12],
      [392, 0.26, 0.12],
      [523.25, 0.4, 0.5],
      [466.16, 0.92, 0.22],
      [523.25, 1.16, 0.95],
    ];
    for (const [f, at, d] of notes) this.#brass(now + at, f, d, 0.12);
    // Final chord with a timpani hit.
    for (const f of [659.25, 783.99]) this.#brass(now + 1.16, f, 0.95, 0.07);
    this.#tone({ start: now + 1.16 }, 98, 0.6, 'sine', 0.4, 80, true);
    this.#tone({ start: now + 0.4 }, 98, 0.4, 'sine', 0.3, 85);
  }

  #sting(now: number): void {
    const ctx = this.#context!;
    const notes = [392, 369.99, 349.23, 329.63];
    notes.forEach((f, i) => {
      const start = now + i * 0.42;
      const duration = i === notes.length - 1 ? 1.4 : 0.4;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f / 2;
      const vibrato = ctx.createOscillator();
      const vibratoDepth = ctx.createGain();
      vibrato.frequency.value = i === notes.length - 1 ? 5.5 : 0.1;
      vibratoDepth.gain.value = i === notes.length - 1 ? 6 : 0;
      vibrato.connect(vibratoDepth).connect(osc.frequency);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, start);
      filter.frequency.exponentialRampToValueAtTime(1200, start + 0.1);
      filter.frequency.exponentialRampToValueAtTime(350, start + duration);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, start);
      env.gain.exponentialRampToValueAtTime(0.16, start + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(filter).connect(env).connect(this.#dry!);
      env.connect(this.#reverb!);
      osc.start(start);
      vibrato.start(start);
      osc.stop(start + duration + 0.05);
      vibrato.stop(start + duration + 0.05);
    });
    this.#tone({ start: now }, 55, 2.2, 'sine', 0.25, 45, true);
  }
}
