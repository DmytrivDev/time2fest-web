/**
 * Період тостів для React (рішення власника 2026-11-13, правило — `lib/toast/season`): `useToastSeason()` —
 * «до свята / свято йде / після»; `useCanToast()` — чи показувати входи «Сказати тост» (шапка, смуга, келих у чаті,
 * картка штампа, рядок тосту в пасі). До готовності часу (сервер, гідратація) — `null` / `false`: входів немає, розмітка
 * збігається.
 * `WhenCanToast` — те саме для шапки, що живе й там, де годинника сайту немає (службові сторінки, 404): тоді свій
 * `TimeProvider`, як у годинника «Машини часу».
 */
import type { ReactNode } from 'react';
import { getData } from '@/lib/data/load';
import { canSayToast, toastSeason, type ToastSeason } from '@time2fest/rules/time';
import { TimeProvider, useHasTime, useNow, useTimeReady } from '@/lib/time/TimeProvider';

export function useToastSeason(): ToastSeason | null {
  const ready = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  return ready ? toastSeason(now, getData()) : null;
}

export function useCanToast(): boolean {
  const ready = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  return ready && canSayToast(now, getData());
}

function Gate({ children }: { children: ReactNode }) {
  return useCanToast() ? children : null;
}

/** Показує `children`, лише поки свято йде. */
export function WhenCanToast({ children }: { children: ReactNode }) {
  const hasTime = useHasTime();
  return hasTime ? (
    <Gate>{children}</Gate>
  ) : (
    <TimeProvider>
      <Gate>{children}</Gate>
    </TimeProvider>
  );
}
