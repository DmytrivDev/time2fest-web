/**
 * Provider layer (SPEC-09 AC-17 … AC-21, AC-32, AC-46, AC-47), ring 3. Keeps one health window per
 * provider (shared by moderation and translation, plan A7), derives each task's state, tells the
 * process subscribers about every actual change, raises the moderation alarms and probes the
 * providers that are down. Time only through the injected clock; ports arrive as parameters.
 *
 * Every call goes through `call`, which measures it, records the sample and writes one log line
 * with provider, task, latency, outcome and token counts — never the text, a subject, device or IP.
 */
import type { AiStatus, AiTask } from '@time2fest/contracts';
import {
  assess,
  AVAILABLE,
  inWindow,
  PROBE_INTERVAL_MS,
  probeDue,
  probeStreak,
  type Health,
  type HealthSample,
} from '../domain/moderation/health';
import { sameState, taskState, type TaskState } from '../domain/moderation/state';
import type { Alarm, Clock, Logger } from '../ports';
import type { AiProvider, ProviderAnswer } from './ports';

export const AI_TASKS: readonly AiTask[] = ['moderation', 'translation'];
const NOT_CONFIGURED: Health = { status: 'unavailable', reason: 'not-configured' };

export type ProviderId = AiProvider['id'];

export interface ProviderLayerDeps {
  /** Per task: `[primary, backup]`. The same provider may serve both tasks (one health window). */
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
   * rejected answer counts and returns as `malformed`. A thrown error counts and returns as `http`.
   */
  call<T>(
    task: AiTask,
    provider: AiProvider,
    run: () => Promise<ProviderAnswer<T>>,
    accept?: (value: T) => boolean,
  ): Promise<ProviderAnswer<T>>;
  /** Sends a probe to every configured provider that is down and due (every 10 s). */
  tick(): Promise<void>;
  /** Starts the `unref` probe timer. */
  start(): { stop(): Promise<void> };
  /** Test door: every configured provider available, ceiling lifted, windows emptied. */
  reset(): void;
}

interface ProviderHealth {
  provider: AiProvider;
  samples: HealthSample[];
  health: Health;
  /** When it became unavailable (start of the probe run). */
  downSince: number | null;
  probes: HealthSample[];
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
      if (!byId.has(p.id)) {
        byId.set(p.id, {
          provider: p,
          samples: [],
          health: p.configured ? AVAILABLE : NOT_CONFIGURED,
          downSince: null,
          probes: [],
          lastProbeAt: null,
        });
      }
    }
  }
  let ceiling = false;
  const listeners = new Set<StateListener>();

  const healthOf = (p: AiProvider): ProviderHealth => byId.get(p.id) as ProviderHealth;
  const compute = (task: AiTask): TaskState => {
    const [primary, backup] = providers[task];
    return taskState({ primary: healthOf(primary).health, backup: healthOf(backup).health, ceiling });
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

  function markDown(h: ProviderHealth, health: Health, now: number) {
    h.health = health;
    h.downSince = now;
    h.probes = [];
    h.lastProbeAt = null;
  }

  function record(h: ProviderHealth, sample: HealthSample) {
    // A late answer from a provider already down does not touch its probe run.
    if (h.health.status !== 'available') return;
    h.samples = inWindow([...h.samples, sample], sample.at);
    const verdict = assess(h.samples, sample.at);
    if (verdict.status === 'unavailable') {
      markDown(h, verdict, sample.at);
      recompute();
    }
  }

  function logCall(provider: ProviderId, task: AiTask | 'probe', ms: number, answer: ProviderAnswer<unknown>) {
    const usage = answer.ok ? answer.usage : undefined;
    log.info({
      event: 'ai-call',
      provider,
      task,
      ms,
      outcome: answer.ok ? 'ok' : answer.kind,
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
    if (h.health.status === 'available' || h.downSince === null) return;
    h.probes.push({ at, ms, ok: answer.ok });
    const streak = probeStreak(h.probes, h.downSince);
    if (streak.recovered) {
      h.health = AVAILABLE;
      h.samples = [];
      h.probes = [];
      h.downSince = null;
      h.lastProbeAt = null;
      recompute();
    } else {
      // Only the current run matters; older probes are dropped.
      h.probes = h.probes.filter((p) => p.at >= streak.from);
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
      (h) => h.provider.configured && h.health.status === 'unavailable' && probeDue(h.lastProbeAt, now, probeIntervalMs),
    );
    await Promise.all(due.map(probeOne));
  }

  return {
    usable(task) {
      const s = current.get(task) as TaskState;
      if (s.state === 'fallback') return [];
      return providers[task].filter((p) => healthOf(p).health.status === 'available');
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
      const answer = raw.ok && accept && !accept(raw.value) ? failure<typeof raw.value>('malformed') : raw;
      logCall(provider.id, task, ms, answer);
      record(healthOf(provider), { at, ms, ok: answer.ok });
      return answer;
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
        h.samples = [];
        h.probes = [];
        h.downSince = null;
        h.lastProbeAt = null;
        h.health = h.provider.configured ? AVAILABLE : NOT_CONFIGURED;
      }
      ceiling = false;
      recompute(false);
    },
  };
}
