'use client';

/**
 * Службові стани `Chat`: «чат недоступний», скелетони завантаження, порожня кімната.
 */
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { Flag } from '@/components/primitives/Flag';
import { Skeleton } from '@/components/primitives/Skeleton';

export function ChatUnavailable({
  onHide,
  onToEvents,
  collapseMode,
}: {
  onHide?: () => void;
  onToEvents?: () => void;
  collapseMode: boolean;
}) {
  const t = useTranslations('chat');
  return (
    <section
      role="status"
      aria-labelledby="chat-down-title"
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-8 text-center"
      data-row="unavailable"
    >
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full border border-border bg-surface text-text-secondary"
      >
        <svg width="1.625rem" height="1.625rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
          <path d="M4 5h16v11H9l-5 4z" />
          <path d="M12 8v3.5M12 13.6v.01" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </span>
      <h2 id="chat-down-title" className="m-0 max-w-75 text-lg leading-snug font-bold text-text">
        {t('unavailable')}
      </h2>
      <p className="m-0 max-w-75 text-body text-text-secondary">{t('unavailableNote')}</p>
      {onHide || onToEvents ? (
        <Button variant="secondary" className="mt-1" onClick={onHide ?? onToEvents}>
          {onHide ? (collapseMode ? t('collapse') : t('hide')) : t('toEvents')}
        </Button>
      ) : null}
    </section>
  );
}

export function ChatLoading() {
  const common = useTranslations('common');
  return (
    <div
      aria-busy="true"
      className="flex flex-1 flex-col justify-end gap-4 overflow-hidden px-3.5 py-3"
      data-row="loading"
    >
      <span className="sr-only" role="status">
        {common('loading')}
      </span>
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} variant="chat-line" />
      ))}
    </div>
  );
}

export function ChatEmpty({ emptyInfo }: { emptyInfo?: { flagCode?: string; sub?: ReactNode } }) {
  const t = useTranslations('chat');
  const emptyText = t('emptyCountry');
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-5 pb-4 pt-5 text-center" data-row="empty">
      {emptyInfo?.flagCode ? (
        <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-full border border-border bg-surface">
          <Flag code={emptyInfo.flagCode} size="md" decorative />
        </span>
      ) : null}
      <h2 className="m-0 text-lg leading-snug font-bold text-text">{emptyText}</h2>
      {emptyInfo?.sub ? <p className="m-0 text-caption text-text-secondary">{emptyInfo.sub}</p> : null}
    </div>
  );
}
