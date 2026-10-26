'use client';

/**
 * Правило однієї коралової кнопки (принцип IV, ІНВ 5.3, FR-064).
 * Вікно (картка пропозиції, штамп, форма «Першого ряду»…), що має власну коралову кнопку,
 * реєструє її через `useRegisterCoral()`; поки така реєстрація є, `useCoralWindowOpen()` дає `true`,
 * і кнопка звуку стає нейтральною. Без провайдера — `false` і нічого не реєструється.
 */
import { createContext, useContext, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';

export interface CoralStore {
  claim(id: string): void;
  release(id: string): void;
  ids(): readonly string[];
  subscribe(listener: () => void): () => void;
}

export function createCoralStore(): CoralStore {
  let ids: readonly string[] = [];
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  return {
    claim(id) {
      if (ids.includes(id)) return;
      ids = [...ids, id];
      emit();
    },
    release(id) {
      if (!ids.includes(id)) return;
      ids = ids.filter((x) => x !== id);
      emit();
    },
    ids: () => ids,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const CoralContext = createContext<CoralStore | null>(null);

export function CoralProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createCoralStore);
  return <CoralContext.Provider value={store}>{children}</CoralContext.Provider>;
}

const EMPTY: readonly string[] = [];
const noopSubscribe = () => () => undefined;

function useClaims(): readonly string[] {
  const store = useContext(CoralContext);
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.ids : () => EMPTY,
    () => EMPTY,
  );
}

/**
 * Реєструє коралову кнопку цього компонента, поки `active`.
 * `hasForeignCoral` — чи є на екрані інша зареєстрована коралова кнопка.
 */
export function useCoralClaim(active = true): { hasForeignCoral: boolean } {
  const store = useContext(CoralContext);
  const id = useId();
  useEffect(() => {
    if (!store || !active) return;
    store.claim(id);
    return () => store.release(id);
  }, [store, id, active]);
  const claims = useClaims();
  return { hasForeignCoral: claims.some((c) => c !== id) };
}

/** Вікно з власною кораловою кнопкою: викликати в компоненті вікна, поки воно відкрите. */
export function useRegisterCoral(active = true): void {
  useCoralClaim(active);
}

/** `true`, поки відкрите вікно з власною кораловою кнопкою (кнопка звуку — нейтральна). */
export function useCoralWindowOpen(): boolean {
  return useClaims().length > 0;
}
