'use client';

/**
 * Хто увійшов — для хедера й меню. На сервері й під час гідратації — гість (розмітка статичного експорту однакова),
 * далі — зі сховища акаунта. Ім'я — нік з чату, інакше частина email до «@».
 */
import { useSyncExternalStore } from 'react';
import type { HeaderUser } from '@/components/shell/Header';
import { useSession } from '@/lib/api/hooks/auth';
import { useGuestStore } from '@/stores/guest';

const noopSubscribe = () => () => undefined;

export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Пас того, хто увійшов, — «Пас ✓» у хедері (після гідратації, як і користувач). Джерело — сесія (сервіс входу). */
export function useHeaderPass(): boolean {
  const hydrated = useHydrated();
  const hasPass = useSession().session?.hasPass ?? false;
  return hydrated && hasPass;
}

export function useHeaderUser(): HeaderUser | null {
  const hydrated = useHydrated();
  const email = useSession().session?.user?.email ?? null;
  const nick = useGuestStore((s) => s.nick);
  // Прапор аватара — обраний у чаті/при реєстрації, інакше визначений за країною.
  const flag = useGuestStore((s) => s.flagCode ?? s.detectedFlag);
  if (!hydrated || !email) return null;
  return { name: nick?.trim() || email.split('@')[0] || email, flag };
}
