'use client';

/**
 * Спільне для блоків головної «до свята»: модель даних (`lib/prefest/model`), «сторінка вже в браузері» (час
 * відвідувача відомий лише після гідратації — статичний експорт збирається в UTC) і тост для заглушок.
 */
import { createContext, useCallback, useContext, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { PrefestModel } from '@/lib/prefest/model';
import { cn } from '@/components/primitives/cn';
import s from './prefest.module.css';

interface PrefestContextValue {
  model: PrefestModel;
  toast: (text: string) => void;
}

const Ctx = createContext<PrefestContextValue | null>(null);

export function usePrefest(): PrefestContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefest: потрібен <PrefestProvider>');
  return v;
}

const noop = () => () => undefined;
/** `true` лише в браузері після гідратації: до того час і пояс відвідувача невідомі — показуємо нейтральну заглушку. */
export function useClientReady(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function PrefestProvider({ model, children }: { model: PrefestModel; children: ReactNode }) {
  const [text, setText] = useState('');
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((t: string) => {
    setText(t);
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 2600);
  }, []);
  return (
    <Ctx.Provider value={{ model, toast }}>
      {children}
      <div className={cn(s.toast, on && s.toastOn)} role="status" aria-live="polite">
        {text}
      </div>
    </Ctx.Provider>
  );
}
