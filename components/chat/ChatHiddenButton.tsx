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
import { formatCount, useHiddenCount, useRepliesToMe } from '@/stores/chat';

export interface ChatHiddenButtonProps {
  room: RoomId;
  onShow: () => void;
  className?: string;
}

export function ChatHiddenButton({ room, onShow, className }: ChatHiddenButtonProps) {
  const t = useTranslations('chat');
  const count = useHiddenCount(room);
  const replies = useRepliesToMe();
  const label = [count > 0 ? t('showChatUnread', { count }) : t('showChat'), replies > 0 ? t('settings.repliedCount', { count: replies }) : '']
    .filter(Boolean)
    .join('. ');
  return (
    <button
      type="button"
      onClick={onShow}
      aria-label={label}
      data-chat-hidden-button="desktop"
      className={cn('t2f-focus t2f-show-chat', count === 0 && 't2f-show-chat-plain', className)}
    >
      <Icon name="message" size={20} strokeWidth={2} />
      <span>{t('showChat')}</span>
      {replies > 0 ? (
        <span aria-hidden="true" className="t2f-replied" data-row="replied">
          <Icon name="reply" size={14} strokeWidth={2} />
          {formatCount(replies)}
        </span>
      ) : null}
      {count > 0 ? (
        <span aria-hidden="true" className="t2f-show-chat-count">
          {formatCount(count)}
        </span>
      ) : null}
    </button>
  );
}
