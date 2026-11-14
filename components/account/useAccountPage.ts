/** Хуки сторінки кабінету: місце чату для меню, перенаправлення гостя на вхід, поточний розділ за прокруткою. */

import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useState } from 'react';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { SECTIONS, type SectionId } from './accountSections';

/**
 * Місце чату макета (`#chat-slot`) для меню кабінету. Шукаємо після вставлення в DOM, до відмальовування
 * (`useLayoutEffect`): під час рендера після переходу з `/login/` макета ще немає в документі, і меню з’являлося
 * лише з наступним рендером — секунди потому (правка власника 2026-11-10).
 */
export function useChatSlot(chatColumn: boolean, signedIn: boolean) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- вузол макета видно лише після вставлення в DOM
    setSlot(chatColumn && signedIn ? document.getElementById(CHAT_SLOT_ID) : null);
  }, [chatColumn, signedIn]);
  return slot;
}

/** Гість — на вхід, з поверненням сюди. */
export function useGuestRedirect(hydrated: boolean, user: unknown) {
  const router = useRouter();
  useEffect(() => {
    if (!hydrated || user) return;
    rememberReturn(currentPath());
    router.replace('/login/');
  }, [hydrated, user, router]);
}

/** Поточний розділ — останній, чий заголовок дійшов до верхньої третини екрана. */
export function useActiveSection(user: unknown) {
  const [active, setActive] = useState<SectionId>('profile');
  useEffect(() => {
    const on = () => {
      let cur: SectionId = 'profile';
      for (const x of SECTIONS) {
        const el = document.getElementById(x.id);
        if (el && el.getBoundingClientRect().top <= window.innerHeight / 3) cur = x.id;
      }
      setActive(cur);
    };
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, [user]);
  return active;
}
