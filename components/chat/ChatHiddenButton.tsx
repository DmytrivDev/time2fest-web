'use client';

/**
 * C9 ChatHiddenButton — чат сховано (FR-053).
 * Десктоп: «Показати чат 99+» біля блоку плеєра; телефон: «Відкрити чат 99+» у рядку дій. Лічильник — повідомлення кімнати,
 * що прийшли відтоді, як чат сховали (власні не рахуємо); «99+» від ста.
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
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
    <Button type="button" variant="tonal" compact iconLeft="smile" onClick={onShow} className={className} data-chat-hidden-button={placement}>
      {placement === 'desktop' ? t('showChat') : t('show')}
      {count > 0 ? (
        <>
          <span aria-hidden="true" className="rounded-full bg-highlight px-1.5 text-label-badge-chat text-on-highlight">
            {formatCount(count)}
          </span>
          <span className="sr-only">{t('unreadCount', { count })}</span>
        </>
      ) : null}
    </Button>
  );
}
