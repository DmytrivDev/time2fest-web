'use client';

/**
 * Тости світу для смуги, згорнутого чату й «Підтримати» (рішення власника 2026-11-12): свої сказані тости
 * (`stores/toast`, цей пристрій) і — лише в тестовій та демо-збірці — імітовані тости інших глядачів
 * (`simulatedToasts`). У робочій збірці без своїх тостів список порожній — смуга показує «Тостів ще немає».
 * До готовності часу (сервер, гідратація) — порожньо, щоб розмітка збігалась.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { DOCK_TOAST_MS, stripView, type StripView, type ToastRecord } from '@/lib/toast/feed';
import { simulatedToasts } from '@/lib/toast/worldToasts';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useToastStore } from '@/stores/toast';

let simCache: ToastRecord[] | null = null;
/** Усі імітовані тости свята (рахуємо раз; далі — фільтр за часом). */
function allSimulated(): ToastRecord[] {
  if (!simCache) simCache = simulatedToasts(CHAT_SCRIPT, getData());
  return simCache;
}

let midnightsCache: Ms[] | null = null;
/** Північ кожного поясу за зростанням. */
export function zoneMidnights(): Ms[] {
  if (!midnightsCache) midnightsCache = getData().zones.map((z) => z.midnightMs).sort((a, b) => a - b);
  return midnightsCache;
}

export interface WorldToasts {
  ready: boolean;
  now: Ms;
  /** Уже сказані тости (свої й імітовані), за часом. */
  toasts: ToastRecord[];
  view: StripView;
  midnights: Ms[];
}

export function useWorldToasts(): WorldToasts {
  const ready = useTimeReady();
  const now = useNow();
  const said = useToastStore((s) => s.said);
  const second = Math.floor(now / 1000) * 1000;
  const toasts = useMemo(() => {
    if (!ready) return [];
    const sim = allSimulated().filter((t) => t.createdAt <= second);
    return [...sim, ...said.filter((t) => t.createdAt <= second)].sort((a, b) => a.createdAt - b.createdAt);
  }, [ready, said, second]);
  const midnights = zoneMidnights();
  const view = useMemo(() => stripView(toasts, second, midnights), [toasts, second, midnights]);
  return { ready, now: second, toasts, view, midnights };
}

/**
 * Новий тост для згорнутого чату на телефоні (дошка `Phone-Toast-New` · «Згорнутий чат · новий тост»): тост, що
 * з’явився після відкриття сторінки, ≈10 с (`DOCK_TOAST_MS`, реальний час) — потім знову «Розгорнути чат».
 * Тости, що вже були при відкритті (чи нахлинули після стрибка машини часу), не показуємо.
 */
export function useArrivingToast(toasts: readonly ToastRecord[], ready: boolean, now: Ms): ToastRecord | null {
  const known = useRef<Set<string> | null>(null);
  const [shown, setShown] = useState<ToastRecord | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (!known.current) {
      known.current = new Set(toasts.map((t) => t.id));
      return;
    }
    const fresh = toasts.filter((t) => !known.current!.has(t.id));
    for (const t of fresh) known.current.add(t.id);
    // Кілька за раз (стрибок часу) чи давній (свої тости, відновлені зі сховища) — не показуємо: це не «щойно».
    if (fresh.length === 1 && now - fresh[0]!.createdAt < 60_000) setShown(fresh[0]!);
  }, [toasts, ready, now]);
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setShown(null), DOCK_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [shown]);
  return shown;
}
