'use client';

/**
 * Клієнтський кеш одного «живого» ресурсу (`docs/backend/frontend-seam.md`, принцип «сервер — джерело правди, клієнт —
 * кеш»): завантажити раз, далі тримати свіжим realtime-подіями сервісу. Свідомо крихітний — без бібліотеки запитів.
 *
 * - Перший підписник (компонент через `useResource`) підключає джерело: спершу realtime, потім `load()`.
 * - Останній відписався — realtime закривається, а дані лишаються (показуємо їх при наступному монтуванні й тихо
 *   оновлюємо). Тому перехід між макетами не блимає порожнім станом.
 * - `mutate` — оптимістична зміна кешу до відповіді сервісу; на відмову хук робить `refresh()` (правда — у сервера).
 * - Подія до першого `load()` без даних пропускається: `load()` і так поверне стан сервера після неї.
 */
import { useSyncExternalStore } from 'react';
import type { ApiError, ApiResult, Unsubscribe } from './result';

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ResourceState<T> {
  readonly status: ResourceStatus;
  readonly data: T | undefined;
  readonly error: ApiError | null;
}

export interface ResourceSource<T, E> {
  load(): Promise<ApiResult<T>>;
  /** Realtime-події ресурсу; немає — лише завантаження. */
  subscribe?(onEvent: (event: E) => void): Unsubscribe;
  /** Як подія змінює дані (дельта чи повний знімок). */
  reduce?(data: T, event: E): T;
}

export interface Resource<T> {
  getSnapshot(): ResourceState<T>;
  subscribe(listener: () => void): Unsubscribe;
  /** Перечитати з сервісу (після відмови мутації, після відновлення з’єднання). */
  refresh(): Promise<void>;
  /** Оптимістично змінити дані в кеші (без даних — нічого). */
  mutate(fn: (data: T) => T): void;
  /** Тести й заміна сервісу: забути дані й відключитись. */
  reset(): void;
}

const IDLE: ResourceState<never> = { status: 'idle', data: undefined, error: null };
const all = new Set<Resource<unknown>>();

/** `source` викликається при кожному підключенні — так тест, що підмінив сервіс, отримує свіжий ресурс. */
export function createResource<T, E = never>(source: () => ResourceSource<T, E>): Resource<T> {
  let state: ResourceState<T> = IDLE;
  const listeners = new Set<() => void>();
  let current: ResourceSource<T, E> | null = null;
  let closeRealtime: Unsubscribe | null = null;
  /** Номер підключення: відповідь старого `load()` після `reset()` не пишеться. */
  let epoch = 0;

  const set = (next: ResourceState<T>) => {
    state = next;
    listeners.forEach((l) => l());
  };

  const refresh = async () => {
    const src = current ?? source();
    const mine = epoch;
    if (state.status !== 'ready') set({ ...state, status: 'loading' });
    const res = await src.load();
    if (mine !== epoch) return;
    if (res.ok) set({ status: 'ready', data: res.value, error: null });
    // Відмова при вже завантажених даних — лишаємо дані, лише запам’ятовуємо помилку.
    else set({ status: state.data === undefined ? 'error' : 'ready', data: state.data, error: res.error });
  };

  const connect = () => {
    current = source();
    const src = current;
    closeRealtime =
      src.subscribe?.((event) => {
        if (state.data === undefined || !src.reduce) return;
        const next = src.reduce(state.data, event);
        // `reduce` повернув те саме — нічого не змінилось, споживачів не чіпаємо (знімки раз на секунду).
        if (next !== state.data) set({ ...state, data: next });
      }) ?? null;
    void refresh();
  };

  const disconnect = () => {
    closeRealtime?.();
    closeRealtime = null;
    current = null;
  };

  const resource: Resource<T> = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) connect();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) disconnect();
      };
    },
    refresh,
    mutate(fn) {
      if (state.data === undefined) return;
      set({ ...state, data: fn(state.data) });
    },
    reset() {
      epoch += 1;
      disconnect();
      state = IDLE;
      if (listeners.size) connect();
      listeners.forEach((l) => l());
    },
  };
  all.add(resource as Resource<unknown>);
  return resource;
}

/** Скинути всі ресурси (заміна сервісів у тестах, `setServicesForTest`). */
export function resetAllResources(): void {
  all.forEach((r) => r.reset());
}

const serverSnapshot = () => IDLE;

/** Стан ресурсу в компоненті. На сервері й під час гідратації — `idle` (розмітка статичного експорту однакова). */
export function useResource<T>(resource: Resource<T>): ResourceState<T> {
  return useSyncExternalStore(resource.subscribe, resource.getSnapshot, serverSnapshot as () => ResourceState<T>);
}
