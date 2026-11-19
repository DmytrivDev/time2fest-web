/**
 * Серверна «машина часу» інтеграційної збірки (test + http, SPEC-07 AC-59…AC-61): та сама поверхня, що й `TimeMachine`,
 * але стан живе в тестовому годиннику сервера (дверцята `GET/POST <endpoint>`, `{ ok, value: { now, speed, frozen } }`).
 * - старт: `GET`, якір із поправкою RTT/2;
 * - `set`/`advance`: одразу локальний якір (панель і `__t2f` бачать зміну без очікування), потім `POST` і якір із відповіді;
 * - опитування `GET` кожні 1,5 с: зміну поза сторінкою видно за ≤2 с (AC-61); якір переставляється, коли розбіжність
 *   > 250 мс або змінилась швидкість;
 * - відмова мережі лишає чинний якір, наступна спроба — за розкладом опитування.
 * Адреса дверцят і текст попередження приходять від `createAppTimeSource` — їх немає в коді класу (AC-58).
 */
import type { TestClockSet, TestClockState } from '@time2fest/contracts/schemas';
import { sanitizeSpeed } from './speed';
import type { MachineLike } from './types';

export const POLL_MS = 1_500;
/** Розбіжність з опитування, нижче якої якір не переставляється (без смикання відліку). */
export const REANCHOR_THRESHOLD_MS = 250;

export interface ServerTimeMachineDeps {
  endpoint: string;
  fetch?: typeof globalThis.fetch;
  perfNow?: () => number;
  /** Час до першої відповіді дверцят (`ready === false`). */
  dateNow?: () => number;
  /** Планує виклик; повертає скасування. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  /** Перша відмова дверцят за сеанс (рівно один виклик). */
  onUnreachable?: () => void;
}

interface Reading {
  state: TestClockState;
  rtt: number;
  /** `perfNow()` у мить відповіді. */
  at: number;
}

function readState(body: unknown): TestClockState | null {
  const v = (body as { ok?: unknown; value?: Partial<TestClockState> } | null)?.value;
  if ((body as { ok?: unknown } | null)?.ok !== true || !v) return null;
  const { now, speed, frozen } = v;
  if (typeof now !== 'number' || !Number.isFinite(now) || typeof speed !== 'number' || !Number.isFinite(speed)) return null;
  return { now, speed, frozen: frozen === true };
}

export class ServerTimeMachine implements MachineLike {
  readonly status = 'machine' as const;
  ready = false;

  private anchor: { virtual: number; perf: number } | null = null;
  private currentSpeed = 1;
  /** Номер останньої локальної зміни: відповіді на старіші запити не перебивають новішу зміну. */
  private seq = 0;
  private started = false;
  private warned = false;
  private cancelPoll: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  private readonly endpoint: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly perfNow: () => number;
  private readonly dateNow: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly onUnreachable: () => void;

  constructor(deps: ServerTimeMachineDeps) {
    this.endpoint = deps.endpoint;
    this.fetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.perfNow = deps.perfNow ?? (() => performance.now());
    this.dateNow = deps.dateNow ?? (() => Date.now());
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      });
    this.onUnreachable = deps.onUnreachable ?? (() => undefined);
  }

  get speed(): number {
    return this.currentSpeed;
  }

  now(): number {
    if (!this.anchor) return this.dateNow();
    return this.anchor.virtual + (this.perfNow() - this.anchor.perf) * this.currentSpeed;
  }

  get(): { at: number; speed: number } {
    return { at: this.now(), speed: this.currentSpeed };
  }

  /**
   * Старт: з `initial` (дійсні `?t=` / `?speed=`) — один `POST`, інакше стан дверцят через `GET` (AC-59).
   * Далі — опитування.
   */
  start(initial?: { at?: number; speed?: number }): void {
    if (this.started) return;
    this.started = true;
    if (initial && (initial.at !== undefined || initial.speed !== undefined)) this.set(initial);
    else void this.pull();
    this.schedulePoll();
  }

  stop(): void {
    this.started = false;
    this.cancelPoll?.();
    this.cancelPoll = null;
  }

  set(opts: { at?: number; speed?: number }): void {
    const body: TestClockSet = {};
    if (opts.at !== undefined) {
      if (!Number.isFinite(opts.at) || opts.at < 0) return;
      body.at = Math.round(opts.at);
    }
    if (opts.speed !== undefined) {
      body.speed = Math.round(sanitizeSpeed(opts.speed));
      body.frozen = false;
    }
    if (body.at === undefined && body.speed === undefined) {
      if (!this.anchor) return;
      body.at = Math.round(this.now());
    }
    const seq = ++this.seq;
    // Локально — одразу; без якоря й без `at` (лише швидкість до першої відповіді) чекаємо сервер.
    if (body.at !== undefined || this.anchor) {
      this.anchor = { virtual: body.at ?? this.now(), perf: this.perfNow() };
      if (body.speed !== undefined) this.currentSpeed = body.speed;
      this.ready = true;
      this.emit();
    }
    void this.request({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }).then(
      (r) => {
        if (r && seq === this.seq) this.adopt(r);
      },
    );
  }

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

  private async pull(): Promise<void> {
    const seq = this.seq;
    const r = await this.request();
    if (r && seq === this.seq) this.adopt(r);
  }

  private schedulePoll(): void {
    if (!this.started) return;
    this.cancelPoll = this.setTimer(() => {
      this.cancelPoll = null;
      void this.pull().finally(() => this.schedulePoll());
    }, POLL_MS);
  }

  private async request(init?: RequestInit): Promise<Reading | null> {
    try {
      const p0 = this.perfNow();
      const res = await this.fetchFn(this.endpoint, {
        cache: 'no-store',
        ...init,
        headers: { Accept: 'application/json', ...(init?.headers as Record<string, string> | undefined) },
      });
      const state = res.ok ? readState(await res.json()) : null;
      const p1 = this.perfNow();
      if (state) return { state, rtt: p1 - p0, at: p1 };
    } catch {
      // мережа — нижче, як і невдала відповідь
    }
    if (!this.warned) {
      this.warned = true;
      this.onUnreachable();
    }
    return null;
  }

  /** Якір зі стану дверцят: сервер рахував `now` приблизно посередині запиту (RTT/2). */
  private adopt({ state, rtt, at }: Reading): void {
    const speed = state.frozen ? 0 : state.speed;
    const virtual = state.now + (rtt / 2) * speed;
    const predicted = this.anchor ? this.anchor.virtual + (at - this.anchor.perf) * this.currentSpeed : null;
    const changed =
      !this.ready || predicted === null || speed !== this.currentSpeed || Math.abs(predicted - virtual) > REANCHOR_THRESHOLD_MS;
    if (!changed) return;
    this.anchor = { virtual, perf: at };
    this.currentSpeed = speed;
    this.ready = true;
    this.emit();
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }
}
