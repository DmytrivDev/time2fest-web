/** Wire vocabulary of text moderation and AI state (SPEC-09). Types only: zod lives in `moderation.schemas.ts`. */

/** `POST /api/toasts/check` request body. */
export interface ToastCheckBody {
  text: string;
}

/** A rule issue found in a toast text: kind and the `[start, end)` range in UTF-16 units. */
export interface ToastIssueWire {
  kind: 'link' | 'contact' | 'word';
  start: number;
  end: number;
}

/** `POST /api/toasts/check` value: the first issue, or `null` when the text is clean. */
export interface ToastCheckValue {
  issue: ToastIssueWire | null;
}

export type AiTask = 'moderation' | 'translation';
export type AiState = 'available' | 'degraded' | 'fallback';
export type AiStateReason = 'unavailable' | 'slow' | 'ceiling' | 'not-configured';

export interface AiStatus {
  task: AiTask;
  state: AiState;
  reason?: AiStateReason;
}

export type ModerationDoorBody =
  | { op: 'reset' }
  | { op: 'setSpend'; period: 'night' | 'month'; usd: number }
  | { op: 'status' }
  | { op: 'verdict'; kind: 'message' | 'nick' | 'toast'; text: string };

export type ModerationDoorValue =
  | { op: 'reset' }
  | { op: 'setSpend'; period: 'night' | 'month'; usd: number }
  | { op: 'status'; statuses: AiStatus[] }
  | { op: 'verdict'; outcome: 'allow' | 'review' | 'block'; source: 'rules' | 'primary' | 'backup' | 'fallback'; reason?: string };
