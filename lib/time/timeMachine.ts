/**
 * «Машина часу» за `contracts/time-machine.md`: віртуальний «зараз»
 * `virtualNow = anchorVirtual + (performance.now() − anchorPerf) × speed`.
 * Підміняє лише джерело часу; вмикається тільки в тестовій збірці (`IS_TEST_BUILD`).
 */
import { sanitizeSpeed } from './speed';
import type { TimeSourceLike } from './types';

export { MAX_SPEED, sanitizeSpeed } from './speed';

/** Старт без параметрів (Clarifications 2026-10-26): до півночі Лондона 22 хв. */
export const DEFAULT_START_ISO = '2027-01-01T01:38:00+02:00';
export const DEFAULT_START_MS = Date.parse(DEFAULT_START_ISO);
/** Демо (рішення власника 2026-11-11): за 20 хв до півночі Парижа (UTC+1) — трансляції поясу щойно відкрились. */
export const DEMO_START_ISO = '2026-12-31T22:40:00Z';
export const DEMO_START_MS = Date.parse(DEMO_START_ISO);
export const MACHINE_STORAGE_KEY = 't2f:session:timeMachine';

export interface TimeMachineOptions {
  at: number;
  speed?: number;
  perfNow?: () => number;
}

export class TimeMachine implements TimeSourceLike {
  readonly status = 'machine' as const;
  readonly ready = true;

  private anchorVirtual: number;
  private anchorPerf: number;
  private currentSpeed: number;
  private readonly perfNow: () => number;
  private readonly listeners = new Set<() => void>();

  constructor(opts: TimeMachineOptions) {
    this.perfNow = opts.perfNow ?? (() => performance.now());
    this.anchorVirtual = opts.at;
    this.anchorPerf = this.perfNow();
    this.currentSpeed = sanitizeSpeed(opts.speed ?? 1);
  }

  get speed(): number {
    return this.currentSpeed;
  }

  now(): number {
    return this.anchorVirtual + (this.perfNow() - this.anchorPerf) * this.currentSpeed;
  }

  get(): { at: number; speed: number } {
    return { at: this.now(), speed: this.currentSpeed };
  }

  /** Перезаписує обидва якорі; без `at` — продовжує з поточного віртуального часу. */
  set(opts: { at?: number; speed?: number }): void {
    const at = opts.at ?? this.now();
    if (!Number.isFinite(at)) return;
    this.anchorVirtual = at;
    this.anchorPerf = this.perfNow();
    if (opts.speed !== undefined) this.currentSpeed = sanitizeSpeed(opts.speed);
    this.emit();
  }

  /** Миттєвий стрибок уперед (від’ємні значення ігноруються). */
  advance(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.set({ at: this.now() + ms });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
