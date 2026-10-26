/**
 * Згода на cookies (B-COOKIES, FR-065): запис вибору в `guest.consent` + перевірка, що він справді збережений.
 * Якщо сховище недоступне (приватний режим), вибір діє, поки сторінка відкрита, а банер показує
 * тихий рядок «Не вдалося зберегти вибір» і «Спробувати ще» (стан «вибір не збережено»).
 * Також тут — реєстр «хостів у потоці»: сторінка з місцем під плеєром повідомляє, що може показати смугу сама.
 */
import { useSyncExternalStore } from 'react';
import type { GuestConsent } from '@/lib/data/types';
import { safeGet } from '@/lib/storage/safe';
import { GUEST_STORAGE_KEY, useGuestStore } from '@/stores/guest';

export type ConsentPatch = Partial<Omit<GuestConsent, 'necessary' | 'answered'>>;

export const ACCEPT_ALL: Required<ConsentPatch> = { analytics: true, marketing: true, facebookVideo: true };
export const NECESSARY_ONLY: Required<ConsentPatch> = { analytics: false, marketing: false, facebookVideo: false };

type Listener = () => void;

function createValueStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      for (const l of [...listeners]) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

const failedStore = createValueStore<ConsentPatch | null>(null);
const hostsStore = createValueStore<number>(0);

/** Читає збережений стан гостя з `localStorage` і порівнює з тим, що мало записатися. */
export function isConsentPersisted(patch: ConsentPatch): boolean {
  const raw = safeGet('local', GUEST_STORAGE_KEY);
  if (!raw) return false;
  try {
    const consent = (JSON.parse(raw) as { state?: { consent?: Partial<GuestConsent> } }).state?.consent;
    if (!consent || consent.answered !== true) return false;
    return (Object.keys(patch) as (keyof ConsentPatch)[]).every((k) => consent[k] === patch[k]);
  } catch {
    return false;
  }
}

/** Записує вибір; `false` — не вдалося зберегти (вибір усе одно діє в цьому сеансі). */
export function applyConsent(patch: ConsentPatch): boolean {
  useGuestStore.getState().setConsent(patch);
  const ok = isConsentPersisted(patch);
  failedStore.set(ok ? null : patch);
  return ok;
}

export function retryConsent(): boolean {
  const patch = failedStore.get();
  return patch ? applyConsent(patch) : true;
}

export function useConsentSaveFailed(): boolean {
  return useSyncExternalStore(failedStore.subscribe, () => failedStore.get() !== null, () => false);
}

/** Для тестів. */
export function resetCookieFlow(): void {
  failedStore.set(null);
  hostsStore.set(0);
}

/** Сторінка з `InFlowSlot` реєструється: якщо вільного кута немає, смугу покаже вона (на місці штампа). */
export function registerInflowHost(): () => void {
  hostsStore.set(hostsStore.get() + 1);
  return () => hostsStore.set(Math.max(0, hostsStore.get() - 1));
}

export function useHasInflowHost(): boolean {
  return useSyncExternalStore(hostsStore.subscribe, () => hostsStore.get() > 0, () => false);
}
