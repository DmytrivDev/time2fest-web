import { useEffect } from 'react';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useNow } from '@/lib/time/TimeProvider';

/**
 * Стан «чат сховано» (FR-053). Десктоп: колонка `#chat` позначається `data-chat-hidden="true"` і зникає з макета
 * (CSS `live-shell.module.css`), доки OverlayManager не відкриє її тимчасово під вікно з полем введення
 * (`data-chat-forced`). Телефон: вкладки «Чат» немає, є кнопка «Відкрити чат».
 */
export function useChatVisibility() {
  const column = useChatColumn();
  const hidden = useGuestStore((s) => s.chatHidden);
  const setChatHidden = useGuestStore((s) => s.setChatHidden);
  const markHidden = useChatUi((s) => s.markHidden);
  const now = useNow();

  useEffect(() => {
    const aside = typeof document !== 'undefined' ? document.getElementById('chat') : null;
    if (!aside) return;
    if (column && hidden) aside.setAttribute('data-chat-hidden', 'true');
    else aside.removeAttribute('data-chat-hidden');
    return () => aside.removeAttribute('data-chat-hidden');
  }, [column, hidden]);

  return {
    column,
    hidden,
    hide: () => {
      markHidden(now);
      setChatHidden(true);
    },
    show: () => {
      setChatHidden(false);
      markHidden(null);
    },
  };
}
