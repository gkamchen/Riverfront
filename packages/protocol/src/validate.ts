/**
 * Validadores pequenos, escritos à mão. Cada um recebe um valor desconhecido
 * e devolve uma cópia limpa (só com as chaves conhecidas) ou o caminho do erro.
 * Copiar em vez de devolver o objeto original evita levar adiante chaves
 * estranhas como `__proto__`.
 */

export type Check<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly path: string; readonly reason: string };

export type Validator<T> = (input: unknown, path?: string) => Check<T>;

const ok = <T>(value: T): Check<T> => ({ ok: true, value });
const bad = (path: string, reason: string): Check<never> => ({ ok: false, path: path || '$', reason });

export interface StringRules {
  readonly min?: number;
  readonly max: number;
  readonly pattern?: RegExp;
  readonly trim?: boolean;
}

export function str(rules: StringRules): Validator<string> {
  return (input, path = '') => {
    if (typeof input !== 'string') return bad(path, 'esperava texto');
    const value = rules.trim ? input.trim() : input;
    if (value.length > rules.max) return bad(path, `texto maior que ${rules.max}`);
    if (rules.min !== undefined && value.length < rules.min) return bad(path, `texto menor que ${rules.min}`);
    if (rules.pattern && !rules.pattern.test(value)) return bad(path, 'formato inválido');
    return ok(value);
  };
}

export function int(min: number, max: number): Validator<number> {
  return (input, path = '') => {
    if (typeof input !== 'number' || !Number.isInteger(input)) return bad(path, 'esperava inteiro');
    if (input < min || input > max) return bad(path, `fora do intervalo ${min}..${max}`);
    return ok(input);
  };
}

export function num(min: number, max: number): Validator<number> {
  return (input, path = '') => {
    if (typeof input !== 'number' || !Number.isFinite(input)) return bad(path, 'esperava número');
    if (input < min || input > max) return bad(path, `fora do intervalo ${min}..${max}`);
    return ok(input);
  };
}

export const bool: Validator<boolean> = (input, path = '') => (typeof input === 'boolean' ? ok(input) : bad(path, 'esperava booleano'));

export function literal<const T extends string | number | boolean>(expected: T): Validator<T> {
  return (input, path = '') => (input === expected ? ok(expected) : bad(path, `esperava ${String(expected)}`));
}

export function oneOf<const T extends string>(values: readonly T[]): Validator<T> {
  const set = new Set<string>(values);
  return (input, path = '') => (typeof input === 'string' && set.has(input) ? ok(input as T) : bad(path, 'valor desconhecido'));
}

export function arr<T>(item: Validator<T>, max: number, min = 0): Validator<T[]> {
  return (input, path = '') => {
    if (!Array.isArray(input)) return bad(path, 'esperava lista');
    if (input.length > max) return bad(path, `lista maior que ${max}`);
    if (input.length < min) return bad(path, `lista menor que ${min}`);
    const out: T[] = [];
    for (let i = 0; i < input.length; i++) {
      const r = item(input[i], `${path}[${i}]`);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  };
}

export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (input, path = '') => (input === undefined ? ok(undefined) : inner(input, path));
}

export function nullable<T>(inner: Validator<T>): Validator<T | null> {
  return (input, path = '') => (input === null ? ok(null) : inner(input, path));
}

type Shape = Record<string, Validator<unknown>>;
type Out<S extends Shape> = {
  [K in keyof S as undefined extends ValueOf<S[K]> ? never : K]: ValueOf<S[K]>;
} & {
  [K in keyof S as undefined extends ValueOf<S[K]> ? K : never]?: ValueOf<S[K]>;
};
type ValueOf<V> = V extends Validator<infer T> ? T : never;
type Pretty<T> = { [K in keyof T]: T[K] } & {};

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const proto = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

/** Objeto com chaves fixas. Chaves a mais são recusadas (`strict`) ou ignoradas. */
export function obj<S extends Shape>(shape: S, strict = true): Validator<Pretty<Out<S>>> {
  const keys = Object.keys(shape);
  return (input, path = '') => {
    if (!isPlainObject(input)) return bad(path, 'esperava objeto');
    if (strict) {
      for (const key of Object.keys(input)) {
        if (!Object.hasOwn(shape, key)) return bad(path ? `${path}.${key}` : key, 'campo desconhecido');
      }
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const r = (shape[key] as Validator<unknown>)(Object.hasOwn(input, key) ? input[key] : undefined, path ? `${path}.${key}` : key);
      if (!r.ok) return r;
      if (r.value !== undefined) out[key] = r.value;
    }
    return ok(out as Pretty<Out<S>>);
  };
}

/** União discriminada por um campo de texto (como `t` ou `ability`). */
export function tagged<T>(field: string, variants: Readonly<Record<string, Validator<T>>>): Validator<T> {
  return (input, path = '') => {
    if (!isPlainObject(input)) return bad(path, 'esperava objeto');
    const tag = input[field];
    if (typeof tag !== 'string' || !Object.hasOwn(variants, tag)) return bad(path ? `${path}.${field}` : field, 'tipo desconhecido');
    return (variants[tag] as Validator<T>)(input, path);
  };
}
