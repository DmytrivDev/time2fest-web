'use client';

/**
 * Згорнутий рядок закріпленого вікна чату («Розгорнути чат» + «N нових»; ≈10 с — новий тост замість підпису).
 * Частина `ChatDock`.
 */
import { useTranslations } from 'next-intl';
import type { Ref } from 'react';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import type { useArrivingToast } from '@/components/toast/useWorldToasts';
import { formatCount } from '@/stores/chat';
import tm from './toastMessage.module.css';

export function ChatDockCollapsed({
  buttonRef,
  roomLabel,
  count,
  replies,
  arriving,
  inert,
  onExpand,
}: {
  buttonRef: Ref<HTMLButtonElement>;
  roomLabel: string;
  count: number;
  replies: number;
  arriving: ReturnType<typeof useArrivingToast>;
  inert: boolean;
  onExpand: () => void;
}) {
  const t = useTranslations('chat');
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={false}
      aria-label={[
        count > 0 ? t('dockExpandLabelUnread', { room: roomLabel, count }) : t('dockExpandLabel', { room: roomLabel }),
        replies > 0 ? t('settings.repliedCount', { count: replies }) : '',
      ]
        .filter(Boolean)
        .join('. ')}
      className="t2f-focus t2f-dock-collapsed"
      inert={inert}
      onClick={onExpand}
      data-dock-expand=""
    >
      <span aria-hidden="true" className="t2f-dock-handle" />
      <span className="t2f-dock-row">
        <Icon name="chevron-up" size={20} strokeWidth={2} />
        {arriving ? (
          // Новий тост ≈10 с замість «Розгорнути чат» (дошка `Phone-Toast-New` · «Згорнутий чат · новий тост»).
          <span key={arriving.id} className={tm.dockToast} data-dock-toast={arriving.id}>
            <Flag code={arriving.flagCode} diameter={22} decorative />
            <span className={tm.dockNick}>{arriving.nick}</span>
            <span className={tm.dockText}>
              <EmojiText text={arriving.text} />
            </span>
            <span className="sr-only">{t('expand')}</span>
          </span>
        ) : (
          <>
            <span>{t('expand')}</span>
            <span className="flex-1" />
          </>
        )}
        {replies > 0 ? (
          <span aria-hidden="true" className="t2f-replied" data-row="replied">
            <Icon name="reply" size={14} strokeWidth={2} />
            {t('settings.replied')}
            {replies > 1 ? ` · ${formatCount(replies)}` : ''}
          </span>
        ) : null}
        <span aria-hidden="true" className="t2f-dock-pill" data-dock-pill="" data-zero={count === 0 ? 'true' : undefined}>
          {t('dockNewPill', { count: formatCount(count) })}
        </span>
      </span>
    </button>
  );
}
