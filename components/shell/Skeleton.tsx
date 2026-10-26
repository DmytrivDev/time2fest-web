import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import styles from './skeleton.module.css';

export interface PageSkeletonProps {
  /**
   * `embedded` — вміст усередині макета `(live)` (шапку, колонку чату й футер дає макет): `app/(live)/loading.tsx`.
   * `full` — вся сторінка, зокрема колонка чату на десктопі (історії, ізольований показ).
   */
  mode?: 'embedded' | 'full';
  className?: string;
}

/**
 * C24 `PageSkeleton` (Phone-Skeleton, Desk-Skeleton). Повторює розкладку головної: плеєр 16:9 (≥ 200 px, як справжній),
 * підпис, смуга дій, вкладки (лише телефон), блоки; на десктопі справа колонка чату. Розміри блоків збігаються зі
 * справжніми, тож перший екран не стрибає. Контейнер `aria-busy`; текст «Завантажуємо трансляцію» — для зчитувача
 * (`role="status"`); блоки приховані. Відблиск вимикається під «зменшити рух» (`.t2f-shine`, primitives.css).
 * Нічого не накладається на відео.
 */
export function PageSkeleton({ mode = 'embedded', className }: PageSkeletonProps) {
  const t = useTranslations('states');
  const full = mode === 'full';
  return (
    <div aria-busy="true" data-page-skeleton={mode} className={cn(full && styles.full, className)}>
      <div className="min-w-0 flex-1">
        <span role="status" className="sr-only">
          {t('loadingStream')}
        </span>
        <Skeleton variant="player" className={styles.player} />
        <div aria-hidden="true" className={cn('flex flex-col gap-3 px-4 pb-4 pt-3', styles.inset)}>
          <div className="flex items-center justify-between">
            <Skeleton variant="line" className="h-5 w-18" />
            <Skeleton variant="line" className="h-7 w-36" />
          </div>
          <Skeleton variant="line" className="h-6 w-56" />
          <Skeleton variant="line" className="w-64 max-w-full" />
          <div className="mt-1 flex gap-2">
            <Skeleton className="size-11 rounded-md" />
            <Skeleton className="h-11 w-44 rounded-md" />
            <span className="flex-1" />
            <Skeleton className="size-11 rounded-md" />
          </div>
        </div>
        {/* Вкладки «Події | Чат» — лише телефон і планшет-портрет. */}
        <div
          aria-hidden="true"
          className={cn('flex h-11 items-center border-y border-border', styles.tabs)}
        >
          <span className="flex flex-1 justify-center">
            <Skeleton variant="line" className="h-3.5 w-14" />
          </span>
          <span className="flex flex-1 justify-center">
            <Skeleton variant="line" className="h-3.5 w-14" />
          </span>
        </div>
        <div aria-hidden="true" className={cn('flex flex-col gap-4 p-4', styles.inset)}>
          <Skeleton variant="line" className="h-3.5 w-44" />
          <div className="flex flex-col gap-3 rounded-lg border border-border px-3 py-3.5">
            <Skeleton variant="line" className="h-5 w-48" />
            <div className="flex gap-2">
              <Skeleton variant="circle" className="h-11 w-36" />
              <Skeleton variant="circle" className="h-11 w-24" />
              <Skeleton variant="circle" className="h-11 w-20" />
            </div>
            <Skeleton className="h-11 rounded-md" />
          </div>
          <Skeleton variant="line" className="h-5 w-36" />
          <Skeleton className="h-32 rounded-md" />
        </div>
      </div>
      {full ? (
        <div
          aria-hidden="true"
          data-testid="skeleton-chat-column"
          className={cn('shrink-0 flex-col gap-4 rounded-lg border border-border p-3', styles.chat)}
        >
          <Skeleton variant="line" className="h-5 w-32" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} variant="chat-line" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
