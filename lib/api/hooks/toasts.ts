'use client';

/**
 * Хуки домену «Тости» (`docs/backend/frontend-seam.md`, E4): стрічка опублікованих тостів через сервіс `toasts`.
 * Правила смуги, закріплення до наступної півночі й імена в привітанні — чисті функції `lib/toast/feed`; сезон тостів
 * (`canSayToast`, `lib/toast/season`) — теж чиста функція, спільна для хука й адаптера.
 */
import { applyToastEvent, type ToastEvent } from '../contracts/toasts';
import { createResource, useResource } from '../resource';
import { getService } from '../services';
import type { ToastRecord } from '@/lib/toast/feed';

const EMPTY: readonly ToastRecord[] = [];

export const toastFeed = createResource<readonly ToastRecord[], ToastEvent>(() => {
  const svc = getService('toasts');
  return { load: () => svc.list(), subscribe: (cb) => svc.subscribe(cb), reduce: applyToastEvent, peek: () => svc.peek?.() };
});

/** Усі відомі тости (за часом). Які з них «уже сказані» — вирішує споживач за часом сайту. */
export function useToastFeed(): readonly ToastRecord[] {
  return useResource(toastFeed).data ?? EMPTY;
}
