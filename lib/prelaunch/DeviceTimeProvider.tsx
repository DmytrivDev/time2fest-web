'use client';

/**
 * Годинник передстартового сайту: лише годинник пристрою відвідувача, без синхронізації з сервером і без «машини
 * часу». У збірці для домену (`pnpm build:prelaunch`) цей модуль стоїть на місці `@/lib/time/TimeProvider`
 * (`resolveAlias` у `next.config.ts`), тож код машини часу й тестового інтерфейсу `window.__t2f` у збірку не потрапляє.
 * Назви й поведінка — ті самі, що в `lib/time/TimeProvider` для джерела `createDeviceTimeSource()`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createClock, type Clock } from '@/lib/time/clock';
import { createDeviceTimeSource } from '@/lib/time/deviceTimeSource';
import type { TimeSourceLike } from '@/lib/time/types';

export interface TimeProviderProps {
  children: ReactNode;
  source?: TimeSourceLike;
  /** Є лише заради сумісності назв: у передстартовій збірці віртуального часу немає. */
  override?: unknown;
}

interface TimeContextValue {
  source: TimeSourceLike;
  clock: Clock;
}

const TimeContext = createContext<TimeContextValue | null>(null);

export function TimeProvider({ children, source }: TimeProviderProps) {
  const [state] = useState(() => {
    const s = source ?? createDeviceTimeSource();
    return { source: s, clock: createClock(s) };
  });
  useEffect(() => {
    state.source.start?.();
    return () => state.source.stop?.();
  }, [state]);
  return <TimeContext.Provider value={state}>{children}</TimeContext.Provider>;
}

function useTimeContext(): TimeContextValue {
  const ctx = useContext(TimeContext);
  if (!ctx) throw new Error('useNow/useTimeSource: потрібен <TimeProvider>');
  return ctx;
}

const serverSnapshot = () => 0;

export interface UseNowOptions {
  granularity?: 'second' | 'minute';
}

export function useNow(opts?: UseNowOptions): number {
  const { clock } = useTimeContext();
  const minute = opts?.granularity === 'minute';
  const getSnapshot = minute
    ? () => Math.floor(clock.getSnapshot() / 60_000) * 60_000
    : clock.getSnapshot;
  return useSyncExternalStore(clock.subscribe, getSnapshot, serverSnapshot);
}

export function useTimeSource(): TimeSourceLike {
  return useTimeContext().source;
}

export function useClock(): Clock {
  return useTimeContext().clock;
}

/** «Машини часу» в передстартовій збірці немає. */
export function useTimeMachine(): null {
  return null;
}

export function useHasTime(): boolean {
  return useContext(TimeContext) !== null;
}

export function useTimeReady(): boolean {
  const { source } = useTimeContext();
  const subscribe = useCallback((l: () => void) => source.subscribe(l), [source]);
  return useSyncExternalStore(
    subscribe,
    () => source.ready,
    () => false,
  );
}
