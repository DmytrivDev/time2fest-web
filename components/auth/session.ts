'use client';

/**
 * Хто увійшов — для хедера й меню. На сервері й під час гідратації — гість (розмітка статичного експорту однакова),
 * далі — зі сховища акаунта. Ім'я — нік з чату, інакше частина email до «@».
 */
import { useSyncExternalStore } from 'react';
import type { HeaderUser } from '@/components/shell/Header';
import { useAuthStore, useAuthTabSync } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';

const noopSubscribe = () => () => undefined;

export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Пас на цьому пристрої — «Пас ✓» у хедері (після гідратації, як і користувач). */
export function useHeaderPass(): boolean {
  const hydrated = useHydrated();
  const hasPass = useGuestStore((s) => s.hasPass);
  return hydrated && hasPass;
}

export function useHeaderUser(): HeaderUser | null {
  useAuthTabSync();
  const hydrated = useHydrated();
  const email = useAuthStore((s) => s.user?.email ?? null);
  const nick = useGuestStore((s) => s.nick);
  if (!hydrated || !email) return null;
  return { name: nick?.trim() || email.split('@')[0] || email };
}
