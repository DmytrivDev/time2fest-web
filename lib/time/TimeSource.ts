/**
 * Серверний час для всього сайту за `contracts/time-api.md` (принцип II, III).
 * Вимірює час між опитуваннями монотонним `performance.now()`, а не годинником пристрою.
 */
import type { TimeSourceLike, TimeStatus } from './types';

export const SAMPLE_COUNT = 5;
export const SAMPLE_INTERVAL_MS = 300;
export const MAX_RTT_MS = 2_000;
export const BEST_SAMPLES = 3;
export const HIDDEN_RESYNC_MS = 60_000;
export const PERIODIC_RESYNC_MS = 10 * 60_000;
export const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 60_000] as const;
/** Розбіжність, нижче якої поправка плавна; вище — перескок. */
export const SMOOTH_THRESHOLD_MS = 1_000;
/** За скільки мс плавна поправка гасне повністю (research.md, розділ 8: 2–3 с). */
export const SLEW_MS = 2_000;
export const FALLBACK_WARNING = '[time] /api/time недоступний, відлік від годинника пристрою';

export interface TimeSourceDeps {
  endpoint?: string;
  fetch?: typeof globalThis.fetch;
  perfNow?: () => number;
  dateNow?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Планує виклик; повертає скасування. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  warn?: (message: string) => void;
  /** Для `visibilitychange`; за замовчуванням `document`. */
  doc?: (EventTarget & { visibilityState: DocumentVisibilityState }) | null;
  /** Для `online`/`offline`; за замовчуванням `window`. */
  win?: EventTarget | null;
}

export interface Anchor {
  perf: number;
  server: number;
}

interface Sample {
  rtt: number;
  /** Оцінка серверного часу мінус perf у момент відповіді. */
  offset: number;
}

export class TimeSource implements TimeSourceLike {
  status: TimeStatus = 'device-fallback';
  ready = false;
  readonly speed = 1;
  anchor: Anchor | null = null;

  private readonly endpoint: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly perfNow: () => number;
  private readonly dateNow: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly warn: (message: string) => void;
  private readonly doc: TimeSourceDeps['doc'];
  private readonly win: TimeSourceDeps['win'];

  private slew: { from: number; amount: number } | null = null;
  private warned = false;
  private failures = 0;
  private inflight: Promise<boolean> | null = null;
  private cancelRetry: (() => void) | null = null;
  private cancelPeriodic: (() => void) | null = null;
  private hiddenAt: number | null = null;
  private started = false;
  private readonly listeners = new Set<() => void>();

  constructor(deps: TimeSourceDeps = {}) {
    this.endpoint = deps.endpoint ?? '/api/time';
    this.fetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.perfNow = deps.perfNow ?? (() => performance.now());
    this.dateNow = deps.dateNow ?? (() => Date.now());
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.warn = deps.warn ?? ((m) => console.warn(m));
    this.doc = deps.doc !== undefined ? deps.doc : typeof document !== 'undefined' ? document : null;
    this.win = deps.win !== undefined ? deps.win : typeof window !== 'undefined' ? window : null;
  }

  now(): number {
    if (!this.anchor) return this.dateNow();
    const p = this.perfNow();
    let t = this.anchor.server + (p - this.anchor.perf);
    if (this.slew) {
      const k = 1 - (p - this.slew.from) / SLEW_MS;
      if (k > 0) t += this.slew.amount * k;
      else this.slew = null;
    }
    return t;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc?.addEventListener('visibilitychange', this.onVisibility);
    this.win?.addEventListener('online', this.onOnline);
    void this.sync().then(() => this.schedulePeriodic());
  }

  stop(): void {
    this.started = false;
    this.doc?.removeEventListener('visibilitychange', this.onVisibility);
    this.win?.removeEventListener('online', this.onOnline);
    this.cancelRetry?.();
    this.cancelPeriodic?.();
    this.cancelRetry = this.cancelPeriodic = null;
  }

  /** Серія до `count` запитів; `true`, якщо якір оновлено. */
  sync(count: number = SAMPLE_COUNT): Promise<boolean> {
    if (this.inflight) return this.inflight;
    this.inflight = this.runSeries(count).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runSeries(count: number): Promise<boolean> {
    const samples: Sample[] = [];
    for (let i = 0; i < count; i++) {
      if (i > 0) await this.sleep(SAMPLE_INTERVAL_MS);
      const s = await this.sample();
      if (s && s.rtt <= MAX_RTT_MS) samples.push(s);
    }
    if (samples.length === 0) {
      this.onFailure();
      return false;
    }
    const best = samples.sort((a, b) => a.rtt - b.rtt).slice(0, BEST_SAMPLES);
    this.applyOffset(median(best.map((s) => s.offset)));
    return true;
  }

  private async sample(): Promise<Sample | null> {
    try {
      const p0 = this.perfNow();
      const res = await this.fetchFn(this.endpoint, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      const p1 = this.perfNow();
      const now = (body as { now?: unknown } | null)?.now;
      if (typeof now !== 'number' || !Number.isInteger(now) || now < 0) return null;
      const rtt = p1 - p0;
      return { rtt, offset: now + rtt / 2 - p1 };
    } catch {
      return null;
    }
  }

  private applyOffset(offset: number): void {
    const p = this.perfNow();
    const before = this.now();
    const after = offset + p;
    const diff = before - after;
    this.anchor = { perf: p, server: after };
    this.slew = Math.abs(diff) < SMOOTH_THRESHOLD_MS && diff !== 0 ? { from: p, amount: diff } : null;
    this.status = 'server';
    this.ready = true;
    this.failures = 0;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.emit();
  }

  private onFailure(): void {
    if (this.anchor) return; // якір лишається дійсним; наступна спроба — за розкладом
    const wasReady = this.ready;
    this.status = 'device-fallback';
    this.ready = true;
    if (!this.warned) {
      this.warned = true;
      this.warn(FALLBACK_WARNING);
    }
    if (this.started) {
      const delay = RETRY_BACKOFF_MS[Math.min(this.failures, RETRY_BACKOFF_MS.length - 1)]!;
      this.failures++;
      this.cancelRetry?.();
      this.cancelRetry = this.setTimer(() => {
        this.cancelRetry = null;
        void this.sync();
      }, delay);
    }
    if (!wasReady) this.emit();
  }

  private schedulePeriodic(): void {
    if (!this.started) return;
    this.cancelPeriodic?.();
    this.cancelPeriodic = this.setTimer(() => {
      this.cancelPeriodic = null;
      void this.sync(1).finally(() => this.schedulePeriodic());
    }, PERIODIC_RESYNC_MS);
  }

  private readonly onVisibility = (): void => {
    if (!this.doc) return;
    if (this.doc.visibilityState === 'hidden') {
      this.hiddenAt = this.perfNow();
      return;
    }
    const hiddenFor = this.hiddenAt === null ? 0 : this.perfNow() - this.hiddenAt;
    this.hiddenAt = null;
    if (hiddenFor > HIDDEN_RESYNC_MS) void this.sync();
  };

  private readonly onOnline = (): void => {
    void this.sync();
  };

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}
