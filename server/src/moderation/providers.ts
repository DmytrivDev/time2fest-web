/**
 * Provider layer (SPEC-09 AC-17 … AC-21, AC-32, AC-46, AC-47), ring 3. Keeps one health window per
 * provider and task (security S1-b: slow translations of long texts must not mark a provider `slow`
 * for moderation; each task has its own slow threshold), derives each task's state, tells the
 * process subscribers about every actual change, raises the moderation alarms and probes the
 * providers that are down — one probe per provider feeds every task window that is down. Time only
 * through the injected clock; ports arrive as parameters.
 *
 * Every call goes through `call`, which measures it, records the sample and writes one log line
 * with provider, task, latency, outcome and token counts — never the text, a subject, device or IP.
 */
import type { AiStatus, AiTask } from '@time2fest/contracts';
import {
  assess,
  AVAILABLE,
  inWindow,
  MIN_SAMPLES,
  p95,
  PROBE_INTERVAL_MS,
  probeDue,
  probeStreak,
  SLOW_MS,
  TRANSLATION_SLOW_MS,
  type Health,
  type HealthReason,
  type HealthSample,
  WINDOW_MS,
} from '../domain/moderation/health';
import { sameState, taskState, type TaskState } from '../domain/moderation/state';
import type { Alarm, Clock, Logger } from '../ports';
import type { AiProvider, ProviderAnswer } from './ports';

export const AI_TASKS: readonly AiTask[] = ['moderation', 'translation'];
const NOT_CONFIGURED: Health = { status: 'unavailable', reason: 'not-configured' };
/** Each task's slow threshold: moderation 1 s (AC-17), translation its 2.5 s primary budget. */
const SLOW_MS_OF: Record<AiTask, number> = { moderation: SLOW_MS, translation: TRANSLATION_SLOW_MS };

export type ProviderId = AiProvider['id'];

export interface ProviderLayerDeps {
  /** Per task: `[primary, backup]`. The same provider may serve both tasks (one health window per task). */
  providers: Record<AiTask, readonly [AiProvider, AiProvider]>;
  /** Monotonic clock, ms. */
  clock: Clock;
  alarm: Alarm;
  log: Logger;
  probeIntervalMs?: number;
  /** Upper bound of one probe call; the provider's own timeout applies inside. */
  probeTimeoutMs?: number;
  /** Every probe answer (the spend counter adds what the provider bills for it, AC-26). */
  onProbe?: (provider: ProviderId, answer: ProviderAnswer<unknown>) => void;
  /**
   * User calls a minute per provider in this process (security S7): a token bucket of that size,
   * refilled evenly. Absent → no limit. With N server processes the account sees up to N× this.
   */
  ratePerMin?: Partial<Record<ProviderId, number>>;
  /**
   * Share of each provider's rate reserved for the anonymous toast check (security N1), in (0, 1):
   * toast calls take only from it, every other call only from the rest, so toasts never starve chat.
   */
  toastsRpmShare?: number;
  /** Backoff after a 429 without `Retry-After` (S7). */
  saturationBackoffMs?: number;
  /** Upper bound of any backoff, `Retry-After` included (S7). */
  maxSaturationBackoffMs?: number;
}

/** Whose share of the provider's bucket a call takes: `toasts` is the toast check's own (N1). */
export type CallScope = 'toasts';
type Lane = 'main' | 'toasts';

export type StateListener = (status: AiStatus) => void;

/** One provider's health for one task over the current 60 s window, read-only (admin slice, AC-41). */
export interface ProviderStats {
  provider: ProviderId;
  task: AiTask;
  status: Health['status'];
  reason?: HealthReason;
  /** User calls in the window. */
  calls: number;
  /** Nearest-rank p95 of their durations, ms (0 without calls). */
  p95Ms: number;
  /** Share of transport failures among them, 0 … 1 (0 without calls). */
  errorShare: number;
}

export interface ProviderLayer {
  /** Providers to try now for the task, in order; empty when the task is `fallback`. */
  usable(task: AiTask): AiProvider[];
  /** The task's current state (equals the last notification). */
  state(task: AiTask): AiStatus;
  /** One call per actual change of a task's state (AC-20). Returns the unsubscribe function. */
  subscribe(fn: StateListener): () => void;
  /** Spend ceiling reached or lifted (AC-32): no request but probes while reached. */
  setCeiling(reached: boolean): void;
  /**
   * Runs one user call to `provider` for `task`: measures it on the clock, records the health sample
   * and logs one line. `accept` judges an `ok` answer (strict score, translation output check); a
   * rejected answer returns as `malformed` so the caller never uses it, but its health sample is a
   * success (security S1): the transport worked, and crafted text must not take a provider down. A
   * `refused` answer (the provider declined the content) is the same: a healthy, timed sample that
   * the caller never uses. Only transport failures (status, timeout, unreadable envelope) count
   * against health. A thrown error counts and returns as `http`. `scope: 'toasts'` takes the token from
   * the toast check's own share of the bucket (N1); any other call from the rest.
   */
  call<T>(
    task: AiTask,
    provider: AiProvider,
    run: () => Promise<ProviderAnswer<T>>,
    accept?: (value: T) => boolean,
    scope?: CallScope,
  ): Promise<ProviderAnswer<T>>;
  /** Per provider (configured or not) and per task it serves: status, p95 and error share over the current window (AC-41). */
  stats(): ProviderStats[];
  /** Sends a probe to every configured provider that is down and due (every 10 s). */
  tick(): Promise<void>;
  /** Starts the `unref` probe timer. */
  start(): { stop(): Promise<void> };
  /** Test door: every configured provider available, ceiling lifted, windows emptied. */
  reset(): void;
}

/** One provider's health for one task. */
interface TaskHealth {
  task: AiTask;
  samples: HealthSample[];
  /** Ends (`at`) of the window's `rejected-request` answers (S6). */
  rejects: number[];
  /** The rejected-request alarm is raised and not yet re-armed. */
  rejectAlarmed: boolean;
  /** Non-toast user calls of the window, oldest first, and whether the bucket turned each away (N1). */
  attempts: { at: number; throttled: boolean }[];
  /** The throttled alarm is raised and not yet re-armed. */
  throttleAlarmed: boolean;
  health: Health;
  /** When it became unavailable (start of the probe run). */
  downSince: number | null;
  probes: HealthSample[];
}

interface ProviderHealth {
  provider: AiProvider;
  tasks: Map<AiTask, TaskHealth>;
  lastProbeAt: number | null;
  /** Token buckets of user calls (S7): toast checks and the rest (N1); `Infinity` without a rate. */
  tokens: Record<Lane, number>;
  refilledAt: number;
  /** Skipped until then after a 429 (S7); one `moderation_saturated` page per episode. */
  saturatedUntil: number | null;
}

/** Above this share of `rejected-request` answers in a window of ≥ 20 calls, one `log` alarm (S6). */
export const REJECTED_ALARM_SHARE = 0.2;
/** Above this share of throttled non-toast calls in a window of ≥ 20, one `page` alarm per episode (N1). */
export const THROTTLED_ALARM_SHARE = 0.2;
/** Default share of each provider's rate for the toast check (N1). */
export const TOASTS_RPM_SHARE = 0.2;
export const SATURATION_BACKOFF_MS = 10_000;
export const MAX_SATURATION_BACKOFF_MS = 60_000;

function failure<T>(kind: 'http' | 'malformed'): ProviderAnswer<T> {
  return { ok: false, kind };
}

export function createProviderLayer({
  providers,
  clock,
  alarm,
  log,
  probeIntervalMs = PROBE_INTERVAL_MS,
  probeTimeoutMs = 5_000,
  onProbe,
  ratePerMin = {},
  toastsRpmShare = TOASTS_RPM_SHARE,
  saturationBackoffMs = SATURATION_BACKOFF_MS,
  maxSaturationBackoffMs = MAX_SATURATION_BACKOFF_MS,
}: ProviderLayerDeps): ProviderLayer {
  const byId = new Map<ProviderId, ProviderHealth>();
  const toastsShare = Number.isFinite(toastsRpmShare) && toastsRpmShare > 0 && toastsRpmShare < 1 ? toastsRpmShare : TOASTS_RPM_SHARE;
  /** One lane's bucket size and refill a minute. */
  const capacity = (id: ProviderId, lane: Lane): number => {
    const r = ratePerMin[id];
    if (r === undefined || !Number.isFinite(r) || r <= 0) return Infinity;
    return r * (lane === 'toasts' ? toastsShare : 1 - toastsShare);
  };
  const fullTokens = (id: ProviderId): Record<Lane, number> => ({ main: capacity(id, 'main'), toasts: capacity(id, 'toasts') });
  for (const task of AI_TASKS) {
    for (const p of providers[task]) {
      let h = byId.get(p.id);
      if (h === undefined) {
        h = { provider: p, tasks: new Map(), lastProbeAt: null, tokens: fullTokens(p.id), refilledAt: clock.now(), saturatedUntil: null };
        byId.set(p.id, h);
      }
      if (!h.tasks.has(task)) {
        h.tasks.set(task, {
          task,
          samples: [],
          rejects: [],
          rejectAlarmed: false,
          attempts: [],
          throttleAlarmed: false,
          health: p.configured ? AVAILABLE : NOT_CONFIGURED,
          downSince: null,
          probes: [],
        });
      }
    }
  }

  /** Takes one token of the lane's bucket; false when it is empty (S7, N1). Both lanes refill together. */
  function takeToken(h: ProviderHealth, lane: Lane, now: number): boolean {
    for (const l of ['main', 'toasts'] as const) {
      const cap = capacity(h.provider.id, l);
      if (cap !== Infinity) h.tokens[l] = Math.min(cap, h.tokens[l] + ((now - h.refilledAt) * cap) / 60_000);
    }
    h.refilledAt = now;
    if (capacity(h.provider.id, lane) === Infinity) return true;
    if (h.tokens[lane] < 1) return false;
    h.tokens[lane] -= 1;
    return true;
  }

  /**
   * Tracks non-toast calls the bucket turned away in a task window; one `page` per episode while their
   * share stays above 20 % of ≥ 20 attempts (N1). Health is untouched, so this is the only signal.
   */
  function trackThrottle(h: ProviderHealth, t: TaskHealth, at: number, throttled: boolean) {
    t.attempts.push({ at, throttled });
    let drop = 0;
    while (drop < t.attempts.length && (t.attempts[drop] as { at: number }).at <= at - WINDOW_MS) drop++;
    if (drop > 0) t.attempts.splice(0, drop);
    if (t.attempts.length < MIN_SAMPLES) return;
    const share = t.attempts.filter((x) => x.throttled).length / t.attempts.length;
    if (share <= THROTTLED_ALARM_SHARE) {
      t.throttleAlarmed = false;
    } else if (!t.throttleAlarmed) {
      t.throttleAlarmed = true;
      alarm.raise({
        level: 'page',
        source: 'mod',
        code: 'moderation_throttled',
        details: { provider: h.provider.id, task: t.task, share: Math.round(share * 100) / 100 },
      });
    }
  }

  const saturated = (h: ProviderHealth, now: number) => h.saturatedUntil !== null && now < h.saturatedUntil;

  /** A 429 (S7): skip the provider for the backoff; one page per episode, never a health sample. */
  function saturate(h: ProviderHealth, retryAfterMs: number | undefined, now: number) {
    const episode = !saturated(h, now);
    const backoff = Math.min(maxSaturationBackoffMs, Math.max(0, retryAfterMs ?? saturationBackoffMs));
    h.saturatedUntil = Math.max(h.saturatedUntil ?? 0, now + backoff);
    if (episode) {
      alarm.raise({ level: 'page', source: 'mod', code: 'moderation_saturated', details: { provider: h.provider.id, backoffMs: backoff } });
    }
  }

  /** Tracks `rejected-request` answers of a task window; one `log` alarm while their share stays high (S6). */
  function trackRejects(h: ProviderHealth, t: TaskHealth, at: number, rejected: boolean) {
    if (rejected) t.rejects.push(at);
    t.rejects = t.rejects.filter((x) => x > at - WINDOW_MS && x <= at);
    const calls = inWindow(t.samples, at).length;
    if (calls < MIN_SAMPLES) return;
    const share = t.rejects.length / calls;
    if (share <= REJECTED_ALARM_SHARE) {
      t.rejectAlarmed = false;
    } else if (!t.rejectAlarmed) {
      t.rejectAlarmed = true;
      alarm.raise({
        level: 'log',
        source: 'mod',
        code: 'moderation_rejected_requests',
        details: { provider: h.provider.id, task: t.task, share: Math.round(share * 100) / 100 },
      });
    }
  }
  let ceiling = false;
  const listeners = new Set<StateListener>();

  const healthOf = (p: AiProvider): ProviderHealth => byId.get(p.id) as ProviderHealth;
  const taskHealthOf = (p: AiProvider, task: AiTask): TaskHealth => healthOf(p).tasks.get(task) as TaskHealth;
  const compute = (task: AiTask): TaskState => {
    const [primary, backup] = providers[task];
    return taskState({ primary: taskHealthOf(primary, task).health, backup: taskHealthOf(backup, task).health, ceiling });
  };
  const current = new Map<AiTask, TaskState>(AI_TASKS.map((t) => [t, compute(t)]));
  const statusOf = (task: AiTask): AiStatus => {
    const s = current.get(task) as TaskState;
    return s.reason ? { task, state: s.state, reason: s.reason } : { task, state: s.state };
  };

  function raiseFor(before: TaskState, after: TaskState) {
    const details = after.reason ? { reason: after.reason } : undefined;
    if (after.state === 'fallback') {
      alarm.raise({ level: 'page', source: 'mod', code: 'moderation_fallback', details });
    } else if (after.state === 'degraded') {
      alarm.raise({ level: 'log', source: 'mod', code: 'moderation_degraded', details });
    } else if (before.state !== 'available') {
      alarm.raise({ level: 'log', source: 'mod', code: 'moderation_recovered' });
    }
  }

  function recompute(withAlarms = true) {
    for (const task of AI_TASKS) {
      const before = current.get(task) as TaskState;
      const after = compute(task);
      if (sameState(before, after)) continue;
      current.set(task, after);
      if (withAlarms && task === 'moderation') raiseFor(before, after);
      const status = statusOf(task);
      for (const fn of listeners) {
        try {
          fn(status);
        } catch (err) {
          log.warn({ event: 'ai-state-listener-failed', err: err instanceof Error ? err.name : 'error' });
        }
      }
    }
  }

  function markDown(h: ProviderHealth, t: TaskHealth, health: Health, now: number) {
    t.health = health;
    t.downSince = now;
    t.probes = [];
    h.lastProbeAt = null;
  }

  function record(h: ProviderHealth, t: TaskHealth, sample: HealthSample) {
    // A late answer from a task window already down does not touch its probe run.
    if (t.health.status !== 'available') return;
    t.samples = inWindow([...t.samples, sample], sample.at);
    const verdict = assess(t.samples, sample.at, SLOW_MS_OF[t.task]);
    if (verdict.status === 'unavailable') {
      markDown(h, t, verdict, sample.at);
      recompute();
    }
  }

  const down = (t: TaskHealth): boolean => t.health.status === 'unavailable' && t.downSince !== null;

  function logCall(
    provider: ProviderId,
    task: AiTask | 'probe',
    ms: number,
    answer: ProviderAnswer<unknown>,
    rejected = false,
  ) {
    const usage = answer.ok ? answer.usage : undefined;
    log.info({
      event: 'ai-call',
      provider,
      task,
      ms,
      outcome: rejected ? 'rejected' : answer.ok ? 'ok' : answer.kind,
      tokensIn: usage ? usage.input + usage.cacheRead + usage.cacheWrite : null,
      tokensOut: usage ? usage.output : null,
    });
  }

  async function measure<T>(run: () => Promise<ProviderAnswer<T>>): Promise<{ answer: ProviderAnswer<T>; ms: number; at: number }> {
    const start = clock.now();
    let answer: ProviderAnswer<T>;
    try {
      answer = await run();
    } catch {
      answer = failure('http');
    }
    const at = clock.now();
    return { answer, ms: at - start, at };
  }

  async function probeOne(h: ProviderHealth) {
    h.lastProbeAt = clock.now();
    const { answer, ms, at } = await measure(() => h.provider.probe(AbortSignal.timeout(probeTimeoutMs)));
    logCall(h.provider.id, 'probe', ms, answer);
    try {
      onProbe?.(h.provider.id, answer);
    } catch (err) {
      log.warn({ event: 'ai-probe-hook-failed', err: err instanceof Error ? err.name : 'error' });
    }
    let changed = false;
    // One probe feeds every task window of this provider that is down, each by its own threshold.
    for (const t of h.tasks.values()) {
      if (!down(t)) continue;
      t.probes.push({ at, ms, ok: answer.ok });
      const streak = probeStreak(t.probes, t.downSince as number, SLOW_MS_OF[t.task]);
      if (streak.recovered) {
        t.health = AVAILABLE;
        t.samples = [];
        t.probes = [];
        t.downSince = null;
        changed = true;
      } else {
        // Only the current run matters; older probes are dropped.
        t.probes = t.probes.filter((p) => p.at >= streak.from);
      }
    }
    if (changed) {
      if (![...h.tasks.values()].some(down)) h.lastProbeAt = null;
      recompute();
    }
  }

  let ticking: Promise<void> | null = null;
  function tick(): Promise<void> {
    if (ticking) return ticking;
    ticking = tickOnce().finally(() => {
      ticking = null;
    });
    return ticking;
  }
  async function tickOnce() {
    const now = clock.now();
    const due = [...byId.values()].filter(
      (h) => h.provider.configured && [...h.tasks.values()].some(down) && probeDue(h.lastProbeAt, now, probeIntervalMs),
    );
    await Promise.all(due.map(probeOne));
  }

  return {
    usable(task) {
      const s = current.get(task) as TaskState;
      if (s.state === 'fallback') return [];
      const now = clock.now();
      return providers[task].filter((p) => taskHealthOf(p, task).health.status === 'available' && !saturated(healthOf(p), now));
    },
    state: statusOf,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    setCeiling(reached) {
      if (ceiling === reached) return;
      ceiling = reached;
      recompute();
    },
    async call(task, provider, run, accept, scope) {
      const h = healthOf(provider);
      const t = taskHealthOf(provider, task);
      const lane: Lane = scope === 'toasts' ? 'toasts' : 'main';
      const now = clock.now();
      // This process's share of the account rate (S7): an empty bucket sends nothing and leaves health
      // alone. Toast checks spend their own share only, so anonymous traffic cannot starve chat (N1).
      const granted = takeToken(h, lane, now);
      if (lane === 'main') trackThrottle(h, t, now, !granted);
      if (!granted) {
        logCall(provider.id, task, 0, { ok: false, kind: 'throttled' });
        return { ok: false, kind: 'throttled' };
      }
      const { answer: raw, ms, at } = await measure(run);
      const rejected = raw.ok && accept !== undefined && !accept(raw.value);
      logCall(provider.id, task, ms, raw, rejected);
      if (!raw.ok && raw.kind === 'saturated') {
        saturate(h, raw.retryAfterMs, at);
        return raw;
      }
      const rejectedRequest = !raw.ok && raw.kind === 'rejected-request';
      // Health judges the transport only: a rejected answer, a refused text or a refused request
      // (status 400 / 413 / 422, S6) is a healthy (and timed) sample; the caller never uses it.
      record(h, t, { at, ms, ok: raw.ok || raw.kind === 'refused' || rejectedRequest });
      if (t.health.status === 'available') trackRejects(h, t, at, rejectedRequest);
      return rejected ? { ok: false, kind: 'malformed' } : raw;
    },
    stats() {
      const now = clock.now();
      return [...byId.values()].flatMap((h) =>
        AI_TASKS.flatMap((task): ProviderStats[] => {
          const t = h.tasks.get(task);
          if (t === undefined) return [];
          const recent = inWindow(t.samples, now);
          const errors = recent.filter((x) => !x.ok).length;
          return [
            {
              provider: h.provider.id,
              task,
              status: t.health.status,
              ...(t.health.reason ? { reason: t.health.reason } : {}),
              calls: recent.length,
              p95Ms: p95(recent.map((x) => x.ms)),
              errorShare: recent.length === 0 ? 0 : errors / recent.length,
            },
          ];
        }),
      );
    },
    tick,
    start() {
      const timer = setInterval(() => {
        void tick().catch((err: unknown) => log.warn({ event: 'ai-probe-failed', err: err instanceof Error ? err.name : 'error' }));
      }, probeIntervalMs);
      timer.unref?.();
      return {
        stop: async () => {
          clearInterval(timer);
          await ticking;
        },
      };
    },
    reset() {
      for (const h of byId.values()) {
        h.lastProbeAt = null;
        h.tokens = fullTokens(h.provider.id);
        h.refilledAt = clock.now();
        h.saturatedUntil = null;
        for (const t of h.tasks.values()) {
          t.samples = [];
          t.rejects = [];
          t.rejectAlarmed = false;
          t.attempts = [];
          t.throttleAlarmed = false;
          t.probes = [];
          t.downSince = null;
          t.health = h.provider.configured ? AVAILABLE : NOT_CONFIGURED;
        }
      }
      ceiling = false;
      recompute(false);
    },
  };
}
