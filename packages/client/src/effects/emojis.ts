import { CanvasTexture, SRGBColorSpace, Sprite, SpriteMaterial, type Group, type Vector3 } from 'three';
import { easeOutBack } from '../anim/easing';
import { rand } from '../util/random';

interface Floater {
  sprite: Sprite;
  age: number;
  life: number;
  origin: Vector3;
  drift: number;
  phase: number;
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Twemoji Mozilla", sans-serif';

/** Native emoji rendered to canvas sprites that float up above the board. */
export class EmojiFloaters {
  readonly #parent: Group;
  readonly #textures = new Map<string, CanvasTexture>();
  readonly #floaters: Floater[] = [];

  constructor(parent: Group) {
    this.#parent = parent;
  }

  spawn(emoji: string, origin: Vector3): void {
    const material = new SpriteMaterial({ map: this.#texture(emoji), transparent: true, depthWrite: false });
    const sprite = new Sprite(material);
    sprite.renderOrder = 10;
    sprite.position.copy(origin);
    sprite.scale.setScalar(0.001);
    this.#parent.add(sprite);
    this.#floaters.push({ sprite, age: 0, life: rand(2.2, 2.8), origin: origin.clone(), drift: rand(-0.6, 0.6), phase: rand(0, 6) });
  }

  update(dt: number): void {
    for (let i = this.#floaters.length - 1; i >= 0; i--) {
      const f = this.#floaters[i]!;
      f.age += dt;
      const t = f.age / f.life;
      if (t >= 1) {
        f.sprite.removeFromParent();
        f.sprite.material.dispose();
        this.#floaters.splice(i, 1);
        continue;
      }
      const pop = easeOutBack(Math.min(1, f.age / 0.35));
      f.sprite.scale.setScalar(1.7 * pop);
      f.sprite.position.set(
        f.origin.x + Math.sin(f.age * 3 + f.phase) * 0.18 + f.drift * t,
        f.origin.y + t * 3.2,
        f.origin.z,
      );
      f.sprite.material.opacity = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      f.sprite.material.rotation = Math.sin(f.age * 2.4 + f.phase) * 0.2;
    }
  }

  #texture(emoji: string): CanvasTexture {
    const cached = this.#textures.get(emoji);
    if (cached) return cached;
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${size * 0.78}px ${EMOJI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, size / 2, size / 2 + size * 0.05);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.#textures.set(emoji, texture);
    return texture;
  }
}
