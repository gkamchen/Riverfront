// The few Node APIs the simulation script touches (the project does not pull @types/node).
declare module 'node:worker_threads' {
  export const isMainThread: boolean;
  export const parentPort: { postMessage(value: unknown): void } | null;
  export const workerData: unknown;
  export class Worker {
    constructor(filename: string | URL, options?: { workerData?: unknown });
    on(event: 'message', listener: (value: unknown) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'exit', listener: (code: number) => void): this;
  }
}

declare module 'node:os' {
  export function availableParallelism(): number;
}

declare module 'node:fs' {
  export function writeFileSync(path: string | URL, data: string): void;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module 'node:path' {
  export const sep: string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare class URL {
  constructor(url: string, base?: string | URL);
  readonly href: string;
}

declare const process: {
  readonly argv: string[];
  exitCode?: number;
  readonly stdout: { write(text: string): boolean };
};

interface ImportMeta {
  readonly url: string;
}
