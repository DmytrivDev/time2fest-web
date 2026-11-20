/**
 * State of one AI task from the health of its two providers and the spend ceiling (SPEC-09
 * AC-20, AC-32; state diagram of the spec), ring 1: pure.
 *
 * - ceiling reached → `fallback` / `ceiling` (no request but probes);
 * - primary available → `available`;
 * - primary down, backup available → `degraded` with the primary's reason;
 * - both down → `fallback` with the primary's reason.
 * An unconfigured provider is down with reason `not-configured`.
 */
import type { AiState, AiStateReason } from '@time2fest/contracts';
import type { Health } from './health';

export interface TaskStateInput {
  primary: Health;
  backup: Health;
  ceiling: boolean;
}

export interface TaskState {
  state: AiState;
  reason?: AiStateReason;
}

function reasonOf(h: Health): AiStateReason {
  return h.reason ?? 'unavailable';
}

export function taskState({ primary, backup, ceiling }: TaskStateInput): TaskState {
  if (ceiling) return { state: 'fallback', reason: 'ceiling' };
  if (primary.status === 'available') return { state: 'available' };
  if (backup.status === 'available') return { state: 'degraded', reason: reasonOf(primary) };
  return { state: 'fallback', reason: reasonOf(primary) };
}

export function sameState(a: TaskState, b: TaskState): boolean {
  return a.state === b.state && a.reason === b.reason;
}
