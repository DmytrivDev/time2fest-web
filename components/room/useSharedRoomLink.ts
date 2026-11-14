'use client';

/** Посилання «Поділитися кімнатою» (`?w=`): відкриває ті самі вікна. Виокремлено з `RoomLive.tsx` (WP-F). */
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import type { Dataset } from '@/lib/data/types';
import { useGuestStore } from '@/stores/guest';
import { useRoomStore } from '@/stores/room';
import { parseRoomShare } from './roomShare';

export function useSharedRoomLink({ known, data, limit }: { known: boolean; data: Dataset; limit: number }) {
  const t = useTranslations('room.page');
  const announce = useAnnounce();
  const searchParams = useSearchParams();
  const sharedRef = useRef(false);
  /** Відкрито посилання з більшою кількістю вікон, ніж уміщує телефон: тиха смуга «видно два, решта — в посиланні». */
  const [sharedMore, setSharedMore] = useState<number | null>(null);
  useEffect(() => {
    if (sharedRef.current || !known) return;
    const raw = searchParams?.get('w');
    if (!raw) return;
    sharedRef.current = true;
    const list = parseRoomShare(raw, data);
    if (!list.length) return;
    useGuestStore.getState().setRoomWindows(list);
    useGuestStore.getState().setSoundSlot(0);
    useRoomStore.getState().setHostSlot(null);
    if (list.length > limit) {
      announce(t('sharedPhone', { count: list.length }));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- одноразово: посилання `?w=` розбирається, коли час відомий
      setSharedMore(list.length);
    }
  }, [known, searchParams, data, limit, announce, t]);
  return { sharedMore, setSharedMore };
}
