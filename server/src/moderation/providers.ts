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
  p95,
  PROBE_INTERVAL_MS,
  probeDue,
  probeStreak,
  SLOW_MS,
  TRANSLATION_SLOW_MS,
  type Health,
  type HealthReason,
  type HealthSample,
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
}

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
   * against health. A thrown error counts and returns as `http`.
   */
  call<T>(
    task: AiTask,
    provider: AiProvider,
    run: () => Promise<ProviderAnswer<T>>,
    accept?: (value: T) => boolean,
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
  health: Health;
  /** When it became unavailable (start of the probe run). */
  downSince: number | null;
  probes: HealthSample[];
}

interface ProviderHealth {
  provider: AiProvider;
  tasks: Map<AiTask, TaskHealth>;
  lastProbeAt: number | null;
}

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
}: ProviderLayerDeps): ProviderLayer {
  const byId = new Map<ProviderId, ProviderHealth>();
  for (const task of AI_TASKS) {
    for (const p of providers[task]) {
      let h = byId.get(p.id);
      if (h === undefined) {
        h = { provider: p, tasks: new Map(), lastProbeAt: null };
        byId.set(p.id, h);
      }
      if (!h.tasks.has(task)) {
        h.tasks.set(task, { task, samples: [], health: p.configured ? AVAILABLE : NOT_CONFIGURED, downSince: null, probes: [] });
      }
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
      return providers[task].filter((p) => taskHealthOf(p, task).health.status === 'available');
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
    async call(task, provider, run, accept) {
      const { answer: raw, ms, at } = await measure(run);
      const rejected = raw.ok && accept !== undefined && !accept(raw.value);
      logCall(provider.id, task, ms, raw, rejected);
      // Health judges the transport only: a rejected or refused answer is a healthy (and timed) sample.
      record(healthOf(provider), taskHealthOf(provider, task), { at, ms, ok: raw.ok || raw.kind === 'refused' });
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
        for (const t of h.tasks.values()) {
          t.samples = [];
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
