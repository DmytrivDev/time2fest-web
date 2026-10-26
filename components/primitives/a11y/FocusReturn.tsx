'use client';

/**
 * P31. FocusReturn — запам’ятовує елемент у фокусі, коли `active` стає `true`,
 * і повертає на нього фокус, коли `active` стає `false` (або компонент розмонтовується).
 * Для немодальних вікон, що не мають власного повернення (InFlowSlot, ChatSlotPanel `nonmodal`).
 */
import { useEffect, useRef, type ReactNode } from 'react';

export function useFocusReturn(active: boolean): void {
  const saved = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    saved.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const el = saved.current;
      saved.current = null;
      if (el && el.isConnected && typeof el.focus === 'function') el.focus({ preventScroll: true });
    };
  }, [active]);
}

export function FocusReturn({ active = true, children }: { active?: boolean; children?: ReactNode }) {
  useFocusReturn(active);
  return <>{children}</>;
}
