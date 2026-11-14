'use client';

/**
 * Дії над повідомленням для `ChatPanel`: реакція, відповідь, видалення свого, скарга, звернення `@нік`.
 */
import { useTranslations } from 'next-intl';
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import { chatActions } from '@/lib/api/hooks/chat';
import { excerptOf } from '@/lib/chat/send';
import type { ChatMessage, ReactionId } from '@/lib/data/types';
import { useChatUi } from '@/stores/chat';
import { AUTHOR_WINDOW_ID } from './useChatPanelWindows';

export function useChatMessageActions(o: {
  focusField: () => void;
  setDraft: ReturnType<typeof useChatUi.getState>['setDraft'];
  setReplyTo: ReturnType<typeof useChatUi.getState>['setReplyTo'];
  setReported: Dispatch<SetStateAction<boolean>>;
}) {
  const { focusField, setDraft, setReplyTo, setReported } = o;
  const t = useTranslations('chat');
  const announce = useAnnounce();
  const overlay = useOverlay();

  const onReact = useCallback((m: ChatMessage, reaction: ReactionId, on: boolean) => void chatActions.react(m.room, m.id, reaction, on), []);
  const onReply = useCallback(
    (m: ChatMessage) => {
      if (!m.author) return;
      setReplyTo({ id: m.id, room: m.room, nick: m.author.nick, excerpt: excerptOf(m.text ?? '') });
      overlay.close(AUTHOR_WINDOW_ID);
      focusField();
    },
    [setReplyTo, overlay, focusField],
  );
  // Своє повідомлення: видалити назавжди (у стрічці лишається рядок «Твоє повідомлення видалено»), фокус — у поле.
  const onDelete = useCallback(
    (m: ChatMessage) => {
      void chatActions.remove(m.room, m.id);
      announce(t('deletedOwn'));
      focusField();
    },
    [announce, t, focusField],
  );
  const onReport = useCallback(
    (m?: ChatMessage) => {
      if (m) void chatActions.report(m.room, m.id);
      setReported(true);
      announce(t('reported'));
    },
    [announce, t, setReported],
  );

  const onMention = useCallback(
    (m: ChatMessage) => {
      const nick = m.author?.nick;
      if (!nick) return;
      setDraft((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${nick} `);
      overlay.close(AUTHOR_WINDOW_ID);
      focusField();
    },
    [overlay, focusField, setDraft],
  );

  return { onReact, onReply, onDelete, onReport, onMention };
}
