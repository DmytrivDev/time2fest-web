'use client';

/**
 * Скелетон сторінки «Країни й міста» (правка власника 2026-11-04): той самий верх, що після завантаження (заголовок,
 * підзаголовок, на телефоні «Мапа | Список», пошук, фільтр), і рядки поясів тієї самої висоти (58 px десктоп, 76 px
 * телефон). Рядків — досить, щоб перший екран був заповнений до низу. Розміри — у `countryList.module.css`.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import styles from './countryList.module.css';

const ROWS = 14;

/** Лише рядки поясів (поки сторінка чекає на час). */
export function ZoneRowsSkeleton() {
  return (
    <div aria-hidden="true" className={styles.skRows}>
      {Array.from({ length: ROWS }, (_, i) => (
        <Skeleton key={i} variant="block" className={styles.skRow} />
      ))}
    </div>
  );
}

/** Уся сторінка (`app/(live)/countries/loading.tsx`). */
export function CountriesSkeleton() {
  const t = useTranslations('countries');
  const tCommon = useTranslations('common');
  return (
    <div aria-busy="true" data-countries-skeleton="" className={styles.page}>
      <span role="status" className="sr-only">
        {tCommon('loading')}
      </span>
      <header className={styles.head}>
        <div className="min-w-0 flex-1">
          <h1 className="text-headline-md text-text">{t('title')}</h1>
          <Skeleton variant="line" className={styles.skSubtitle} />
        </div>
      </header>
      <Skeleton variant="block" className={cn(styles.skView, styles.phoneOnly)} />
      <div aria-hidden="true" className={styles.toolbar}>
        <Skeleton variant="block" className={styles.skSearch} />
        <Skeleton variant="block" className={styles.skFilter} />
        <Skeleton variant="block" className={cn(styles.skSeg, styles.deskOnly)} />
      </div>
      <ZoneRowsSkeleton />
    </div>
  );
}
