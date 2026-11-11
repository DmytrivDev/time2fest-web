/**
 * Записи торішніх свят «наживо» (демо, рішення власника 2026-11-11): запис трансляції 2025/26 грає з тієї секунди, де
 * його північ збігається з віртуальною північчю поясу. Позицію рахує `recordingPosition`; плеєри (`youtubeApi`)
 * підставляють її при завантаженні відео, після стрибка часу (`onRecordingResync`) і коли відео розійшлося з годинником.
 */
import type { Ms } from '@/lib/data/types';

export interface RecordingSync {
  /** Північ події, мс UTC (віртуальний час). */
  midnightMs: Ms;
  /** Секунда запису, де настає північ. */
  midnightSec: number;
  /** Тривалість запису, с (кінець — повтор від відліку). */
  durationSec?: number;
}

/** Повтор минулої події — з цієї кількості секунд до півночі (відлік і салют). */
export const REPLAY_LEAD_SEC = 60;
/** Розбіжність із годинником, після якої плеєр перемотує. */
export const DRIFT_SEC = 8;

const byVideo = new Map<string, RecordingSync>();
let clock: () => Ms = () => Date.now();
const listeners = new Set<() => void>();

export function registerRecording(videoId: string, sync: RecordingSync): void {
  byVideo.set(videoId, sync);
}

export function setRecordingClock(now: () => Ms): void {
  clock = now;
}

export interface RecordingPosition {
  seconds: number;
  /** `live` — йде синхронно з північчю; `replay` — подія давно минула, запис з відліку. */
  mode: 'live' | 'replay';
}

/** Позиція запису `videoId` зараз; не запис — `undefined`. */
export function recordingPosition(videoId: string, now: Ms = clock()): RecordingPosition | undefined {
  const s = byVideo.get(videoId);
  if (!s) return undefined;
  const seconds = s.midnightSec + (now - s.midnightMs) / 1_000;
  if (seconds < 0) return { seconds: 0, mode: 'live' };
  if (s.durationSec !== undefined && seconds > s.durationSec - 5) {
    return { seconds: Math.max(0, s.midnightSec - REPLAY_LEAD_SEC), mode: 'replay' };
  }
  return { seconds, mode: 'live' };
}

/** Стрибок часу (машина часу): плеєри перемотують записи. */
export function notifyRecordingResync(): void {
  for (const l of listeners) l();
}

export function onRecordingResync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
