'use client';

/**
 * React-контекст часу: одне джерело (`TimeSource` або «машина часу») і один спільний
 * секундний годинник на весь сайт. Компоненти читають час лише через `useNow()`.
 */
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { ISO } from '@/lib/data/types';
import { seedDemoOnce } from '@/lib/demo/seed';
import { notifyRecordingResync, setRecordingClock } from '@/lib/player/recordingSync';
import { IS_DEMO_BUILD, IS_TEST_BUILD } from '@/lib/env';
import { createClock, type Clock } from './clock';
import { createAppTimeSource } from './params';
import { installTestApi } from './testApi';
import { TimeMachine } from './timeMachine';
import type { TimeSourceLike } from './types';

export interface TimeOverride {
  at: ISO | number;
  speed?: number;
  /** Заморожений кадр (= `speed: 0`). */
  frozen?: boolean;
}

export interface TimeProviderProps {
  children: ReactNode;
  /** Для Storybook і тестів: віртуальний час замість серверного. */
  override?: TimeOverride;
  /** Для тестів: готове джерело часу. */
  source?: TimeSourceLike;
}

interface TimeContextValue {
  source: TimeSourceLike;
  machine: TimeMachine | null;
  clock: Clock;
}

const TimeContext = createContext<TimeContextValue | null>(null);

interface Setup {
  source: TimeSourceLike;
  machine: TimeMachine | null;
  activate: () => () => void;
}

function setup(props: Pick<TimeProviderProps, 'override' | 'source'>): Setup {
  if (props.source) {
    const source = props.source;
    return {
      source,
      machine: source instanceof TimeMachine ? source : null,
      activate: () => {
        source.start?.();
        return () => source.stop?.();
      },
    };
  }
  if (props.override) {
    const { at, speed, frozen } = props.override;
    const machine = new TimeMachine({
      at: typeof at === 'number' ? at : Date.parse(at),
      speed: frozen ? 0 : (speed ?? 1),
    });
    return { source: machine, machine, activate: () => () => undefined };
  }
  // Демо: стартовий стан гостя (5 зустрінутих міст) — до першого ефекту, щоб стежач сповіщень побачив штампи як давні.
  if (IS_DEMO_BUILD && typeof window !== 'undefined') seedDemoOnce();
  return createAppTimeSource();
}

export function TimeProvider({ children, override, source }: TimeProviderProps) {
  const [state] = useState(() => {
    const s = setup({ override, source });
    return { ...s, clock: createClock(s.source) };
  });

  useEffect(() => {
    // Записи свят (демо) грають за цим годинником; стрибок машини часу перемотує їх.
    setRecordingClock(() => state.source.now());
    const offJump = state.machine?.subscribe(notifyRecordingResync);
    const deactivate = state.activate();
    const uninstall = IS_TEST_BUILD && state.machine ? installTestApi(state.machine) : undefined;
    return () => {
      offJump?.();
      deactivate();
      uninstall?.();
    };
  }, [state]);

  return (
    <TimeContext.Provider value={{ source: state.source, machine: state.machine, clock: state.clock }}>
      {children}
    </TimeContext.Provider>
  );
}

function useTimeContext(): TimeContextValue {
  const ctx = useContext(TimeContext);
  if (!ctx) throw new Error('useNow/useTimeSource: потрібен <TimeProvider>');
  return ctx;
}

const serverSnapshot = () => 0;

export interface UseNowOptions {
  /** 'second' (за замовчуванням) — кожен такт; 'minute' — лише при зміні хвилини (значення округлене вниз до хвилини). */
  granularity?: 'second' | 'minute';
}

/**
 * Серверний час у мс, оновлюється раз на секунду від одного спільного годинника.
 * Під час статичного рендерингу й гідратації повертає `0` (час ще невідомий) —
 * див. `useTimeReady()`.
 */
export function useNow(opts?: UseNowOptions): number {
  const { clock } = useTimeContext();
  const minute = opts?.granularity === 'minute';
  const getSnapshot = minute ? () => Math.floor(clock.getSnapshot() / 60_000) * 60_000 : clock.getSnapshot;
  return useSyncExternalStore(clock.subscribe, getSnapshot, serverSnapshot);
}

/** Джерело часу (`now()`, `status`, `ready`, `speed`, `subscribe`). */
export function useTimeSource(): TimeSourceLike {
  return useTimeContext().source;
}

/** Спільний годинник (для планувальників, що працюють поза рендерингом). */
export function useClock(): Clock {
  return useTimeContext().clock;
}

/** «Машина часу», якщо вона діє (тестова збірка або `override`), інакше `null`. */
export function useTimeMachine(): TimeMachine | null {
  return useTimeContext().machine;
}

/** `true`, коли час відомий: після гідратації й першої синхронізації (або резерву). */
export function useTimeReady(): boolean {
  const { source } = useTimeContext();
  const subscribe = useCallback((l: () => void) => source.subscribe(l), [source]);
  return useSyncExternalStore(subscribe, () => source.ready, () => false);
}
