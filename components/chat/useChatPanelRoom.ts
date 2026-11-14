'use client';

/**
 * Кімната `ChatPanel`: яка зараз активна («Світ» / «Країна»), її id і підпис, доступність чату, стрічка кімнати з
 * урахуванням «тихого режиму» (пас).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useChatConnection, useRoomMessages } from '@/lib/api/hooks/chat';
import { isQuietHidden, quietHiddenCount } from '@/lib/chat/quiet';
import type { RoomId } from '@/lib/data/types';
import type { TimeSourceLike } from '@/lib/time/types';
import { useChatPref } from '@/stores/chatPrefs';
import { useChatUi } from '@/stores/chat';
import type { GuestStore } from '@/stores/guest';

export type RoomKey = 'world' | 'country';

export function useChatPanelRoom(o: {
  country?: { iso: string; name: string };
  startInWorld?: boolean;
  guest: GuestStore;
  source: TimeSourceLike;
}) {
  const { country, startInWorld, guest, source } = o;
  const t = useTranslations('chat');
  const { setLastRoom } = guest;
  const [roomKey, setRoomKey] = useState<RoomKey>(country && !startInWorld ? 'country' : 'world');
  const activeKey: RoomKey = roomKey === 'country' && !country ? 'world' : roomKey;
  const roomId: RoomId = activeKey === 'country' && country ? `country:${country.iso}` : 'world';
  const roomLabel = activeKey === 'country' && country ? t('roomCountryPicker', { country: country.name }) : t('roomWorld');

  useEffect(() => setLastRoom(roomId), [roomId, setLastRoom]);
  const available = useChatConnection(roomId) !== 'unavailable';
  // Чат повернувся: лічильник «нових» у згорнутому/схованому чаті рахуємо відтоді (рішення 2026-10-28).
  const wasAvailable = useRef(available);
  useEffect(() => {
    if (available && !wasAvailable.current && useChatUi.getState().hiddenAt !== null) {
      useChatUi.getState().markHidden(source.now());
    }
    wasAvailable.current = available;
  }, [available, source]);
  // Стрічка кімнати — сервіс чату (перемикач «Порожня кімната «Країна»» враховує адаптер `sim`).
  const roomMessages = useRoomMessages(roomId);
  // Тихий режим (пас): без банальних привітань і лічильників однакових привітань.
  const quiet = useChatPref('quiet');
  const myNick = guest.nick;
  const messages = useMemo(
    () => (quiet ? roomMessages.filter((m) => !isQuietHidden(m, myNick)) : roomMessages),
    [quiet, roomMessages, myNick],
  );
  const quietHidden = useMemo(() => (quiet ? quietHiddenCount(roomMessages, myNick) : 0), [quiet, roomMessages, myNick]);

  return { setRoomKey, activeKey, roomId, roomLabel, available, messages, quietHidden };
}
