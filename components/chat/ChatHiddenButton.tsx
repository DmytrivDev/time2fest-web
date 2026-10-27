'use client';

/**
 * C9 ChatHiddenButton — чат сховано (FR-053).
 * Десктоп: «Показати чат 99+» біля блоку плеєра; телефон: «Відкрити чат 99+» у рядку дій. Лічильник — повідомлення кімнати,
 * що прийшли відтоді, як чат сховали (власні не рахуємо); «99+» від ста.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import type { RoomId } from '@/lib/data/types';
import { formatCount, useHiddenCount } from '@/stores/chat';

export interface ChatHiddenButtonProps {
  /** `desktop` — «Показати чат», `phone` — «Відкрити чат». */
  placement: 'desktop' | 'phone';
  room: RoomId;
  onShow: () => void;
  className?: string;
}

export function ChatHiddenButton({ placement, room, onShow, className }: ChatHiddenButtonProps) {
  const t = useTranslations('chat');
  const count = useHiddenCount(room);
  return (
    // Макет `Desk-Cookies-Wide`: secondary, іконка повідомлення, лічильник на border-фоні.
    <Button
      type="button"
      variant="secondary"
      iconLeft="message"
      onClick={onShow}
      className={cn('ps-3.5 pe-3', className)}
      data-chat-hidden-button={placement}
    >
      {placement === 'desktop' ? t('showChat') : t('show')}
      {count > 0 ? (
        <>
          <span
            aria-hidden="true"
            className="inline-flex h-5.5 items-center rounded-full bg-border px-1.75 text-label-badge-chat font-bold text-text"
          >
            {formatCount(count)}
          </span>
          <span className="sr-only">{t('unreadCount', { count })}</span>
        </>
      ) : null}
    </Button>
  );
}
