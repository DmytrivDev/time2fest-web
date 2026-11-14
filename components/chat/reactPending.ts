import { useSyncExternalStore } from 'react';

/**
 * Імітована затримка «надсилання» реакції (чип під повідомленням і меню «⋯» ділять її): поки йде, на чипі
 * крихітний індикатор і повторний клік ігнорується. Ключ — `<id повідомлення>:<реакція>`.
 */
export const REACT_PENDING_MS = 450;

const pending = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const reactKey = (messageId: string, reaction: string) => `${messageId}:${reaction}`;
export const isReactPending = (key: string) => pending.has(key);

/** Позначає ключ як «надсилається» на `REACT_PENDING_MS`. */
export function markReactPending(key: string): void {
  pending.add(key);
  emit();
  setTimeout(() => {
    pending.delete(key);
    emit();
  }, REACT_PENDING_MS);
}

export function useReactPending(key: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => pending.has(key),
    () => false,
  );
}
