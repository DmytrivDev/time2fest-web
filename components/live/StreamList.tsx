'use client';

/** Телефон за шириною вікна (до 768 px): для компонентів, яким потрібна інша розмітка, а не лише CSS. */
import { useSyncExternalStore } from 'react';

const PHONE_QUERY = '(max-width: 767.98px)';

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getPhone = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false);
export function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, getPhone, () => false);
}
