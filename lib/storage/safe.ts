/**
 * Безпечний доступ до `localStorage`/`sessionStorage`: будь-яка помилка (приватний режим,
 * заборонені cookies, переповнення, пошкоджений JSON) не ламає сайт — він працює без збереження.
 */
import type { PersistStorage, StorageValue } from 'zustand/middleware';

export type StorageKind = 'local' | 'session';

export function getStorage(kind: StorageKind): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function safeGet(kind: StorageKind, key: string): string | null {
  try {
    return getStorage(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function safeSet(kind: StorageKind, key: string, value: string): boolean {
  try {
    const s = getStorage(kind);
    if (!s) return false;
    s.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function safeRemove(kind: StorageKind, key: string): void {
  try {
    getStorage(kind)?.removeItem(key);
  } catch {
    // ігноруємо
  }
}

/** JSON-сховище для Zustand `persist`, де кожне читання й запис — у `try/catch`. */
export function safeJsonStorage<S>(kind: StorageKind): PersistStorage<S> {
  return {
    getItem(name) {
      const raw = safeGet(kind, name);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch {
        return null;
      }
    },
    setItem(name, value) {
      try {
        safeSet(kind, name, JSON.stringify(value));
      } catch {
        // ігноруємо
      }
    },
    removeItem(name) {
      safeRemove(kind, name);
    },
  };
}
