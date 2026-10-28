'use client';

/**
 * C9 ChatHiddenButton — чат сховано на десктопі (FR-053, макет `Desk-Chat-ShowButton`, варіант 1).
 * Пілюля «Показати чат» зі значком, підписом і жовтим лічильником у рядку назви поруч із таймером; висота 44 px.
 * Лічильник — повідомлення кімнати, що прийшли відтоді, як чат сховали (власні не рахуємо); «99+» від ста.
 * На телефоні «сховати» = згорнути вікно чату (`ChatDock`), окремої кнопки немає.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { RoomId } from '@/lib/data/types';
import { formatCount, useHiddenCount } from '@/stores/chat';

export interface ChatHiddenButtonProps {
  room: RoomId;
  onShow: () => void;
  className?: string;
}

export function ChatHiddenButton({ room, onShow, className }: ChatHiddenButtonProps) {
  const t = useTranslations('chat');
  const count = useHiddenCount(room);
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={count > 0 ? t('showChatUnread', { count }) : t('showChat')}
      data-chat-hidden-button="desktop"
      className={cn('t2f-focus t2f-show-chat', count === 0 && 't2f-show-chat-plain', className)}
    >
      <Icon name="message" size={20} strokeWidth={2} />
      <span>{t('showChat')}</span>
      {count > 0 ? (
        <span aria-hidden="true" className="t2f-show-chat-count">
          {formatCount(count)}
        </span>
      ) : null}
    </button>
  );
}
