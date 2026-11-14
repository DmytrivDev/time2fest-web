/**
 * Надсилання повідомлення з `ChatPanel` (`useChatSend`) і повільний режим кімнати (`useChatSlowMode`).
 */
import { useCallback, useEffect, useRef } from 'react';
import { chatActions, chatDev, useSlowModeSeconds } from '@/lib/api/hooks/chat';
import { hasPassNow } from '@/lib/api/hooks/auth';
import { slowRemainingSec, validateSend, type SendContext, type SendError } from '@/lib/chat/send';
import type { RoomId } from '@/lib/data/types';
import type { TimeSourceLike } from '@/lib/time/types';
import { useChatUi } from '@/stores/chat';
import { useGuestStore, type GuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import type { ComposerError } from '@/components/chat/parts/Composer';

/** Повільний режим: загальна пауза, залишок до наступного повідомлення; тестовий перемикач додає системне повідомлення. */
export function useChatSlowMode(o: { roomId: RoomId; now: number; source: TimeSourceLike; slowForced: ReturnType<typeof useTestControls.getState>['slowForcedSec']; guest: GuestStore }) {
  const { roomId, now, source, slowForced, guest } = o;
  const slowTotal = useSlowModeSeconds(roomId, now);
  // Увімкнули повільний режим перемикачем — у кімнаті з’являється системне повідомлення, як на початку вікна сценарію.
  useEffect(() => {
    if (!slowForced) return;
    chatDev.forcedSlowNotice(roomId, source.now());
  }, [slowForced, roomId, source]);
  const slowRemaining = slowRemainingSec(guest.chat.sentAt, now, slowTotal);
  return { slowTotal, slowRemaining };
}

export function useChatSend(o: {
  roomId: RoomId;
  source: TimeSourceLike;
  replyTo: ReturnType<typeof useChatUi.getState>['replyTo'];
  recordSent: GuestStore['recordSent'];
  setReplyTo: ReturnType<typeof useChatUi.getState>['setReplyTo'];
  setDraft: ReturnType<typeof useChatUi.getState>['setDraft'];
  setError: (e: ComposerError) => void;
}) {
  const { roomId, source, replyTo, recordSent, setReplyTo, setDraft, setError } = o;
  const seq = useRef(0);

  /**
   * Відправлення; `override` — свіжі нік і прапор одразу після O-NICK (стан гостя ще не оновився). Поле перевіряє текст
   * саме (та сама `validateSend`, що в сервісі) — відповідь «нік потрібен» відкриває O-NICK без очікування сервера;
   * сервіс перевіряє ще раз (відмова — текст повертається в поле з тією ж причиною).
   */
  const trySend = useCallback(
    (text: string, override?: { nick: string; flagCode: string }): 'sent' | 'nick' | 'error' => {
      const nowMs = source.now();
      const store = useGuestStore.getState();
      const reply = replyTo && replyTo.room === roomId ? replyTo : null;
      const ctx: SendContext = {
        now: nowMs,
        guestId: store.id,
        nick: override?.nick ?? store.nick,
        flagCode: override?.flagCode ?? store.flagCode ?? store.detectedFlag,
        hasPass: hasPassNow(),
        canWrite: () => true,
        slowSeconds: chatActions.slowSeconds(roomId, nowMs),
        sentAt: store.chat.sentAt,
        available: chatActions.connection(roomId) !== 'unavailable' && !useTestControls.getState().offlineSimulated,
        ...(reply ? { replyTo: { id: reply.id, nick: reply.nick, excerpt: reply.excerpt } } : {}),
      };
      seq.current += 1;
      const req = { clientId: `${store.id}:${nowMs}:${seq.current}`, room: roomId, text };
      const showError = (error: SendError | string | undefined) => {
        if (error === 'link-forbidden') setError('link');
        else if (error === 'too-long') setError('too-long');
        else setError(null);
      };
      const bad = validateSend(req, ctx);
      if (bad) {
        showError(bad.error);
        return bad.error === 'nick-required' ? 'nick' : 'error';
      }
      // У `sim` повідомлення з’являється в стрічці ще до повернення з виклику (як раніше — одразу).
      void chatActions.send({ ...req, ...(reply ? { replyToId: reply.id } : {}) }).then((res) => {
        if (res.ok) return;
        setDraft(text);
        showError(res.error.reason);
      });
      recordSent(nowMs);
      setDraft('');
      setError(null);
      setReplyTo(null);
      return 'sent';
    },
    [source, roomId, replyTo, recordSent, setReplyTo, setDraft, setError],
  );

  return trySend;
}
