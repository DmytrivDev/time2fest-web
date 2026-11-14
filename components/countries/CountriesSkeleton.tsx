'use client';

/**
 * Скелетон сторінки «Країни й міста» (правки власника 2026-11-04/05): той самий верх, що після завантаження, і рядки поясів
 * тієї самої висоти (58 px десктоп, 76 px телефон). Рядків — досить, щоб перший екран був заповнений до низу.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Skeleton } from '@/components/primitives/Skeleton';
import { EventFilter } from '@/components/live/EventFilter';
import styles from './countryList.module.css';
import nn from '@/components/live/nowNext.module.css';
import { useHasPass } from '@/lib/api/hooks/auth';

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

/**
 * Підзаголовок до завантаження часу: смужки з відступом від заголовка — дві на телефоні, одна на десктопі (як справжній
 * текст); висота блоку — як у тексту, тож після завантаження нічого не стрибає (правка власника 2026-11-05).
 */
export function SubtitleSkeleton() {
  return (
    <div aria-hidden="true" className={styles.skSub}>
      <Skeleton variant="line" className={styles.skSubLine} />
      <Skeleton variant="line" className={cn(styles.skSubLine, styles.skSubLine2)} />
    </div>
  );
}

/**
 * Уся сторінка (`app/(live)/loading.tsx` → `LiveLoading`, і `countries/loading.tsx`). Розмітка верху — та сама, що в
 * `CountryList` (CSS розкладає її однаково). Переклади приходять разом із першою сторінкою, тож заголовок, «Мапа | Список»,
 * пошук і фільтр — справжні одразу; скелетом — підзаголовок і рядки поясів, бо їм потрібен час.
 */
export function CountriesSkeleton() {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const hasPass = useHasPass();
  const noop = () => undefined;
  return (
    <div aria-busy="true" data-countries-skeleton="" className={styles.page}>
      <span role="status" className="sr-only">
        {tCommon('loading')}
      </span>
      <header className={styles.head}>
        <div className="min-w-0 flex-1">
          <h1 className="text-headline-md text-text">{t('title')}</h1>
          <SubtitleSkeleton />
        </div>
      </header>
      <div aria-hidden="true" inert className={styles.toolbar}>
        <div className={styles.search}>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input readOnly tabIndex={-1} placeholder={t('searchLabel')} className={styles.searchInput} />
        </div>
        <div className={styles.controls}>
          <EventFilter value="all" onValueChange={noop} scheduleLocked={!hasPass} className={cn(styles.filter, styles.filterResp)} />
          <div className={cn(nn.filter, styles.viewCtl)}>
            <span className={nn.seg} data-state="off">
              {tNav('mapShort')}
            </span>
            <span className={nn.seg} data-state="on">
              {tNav('list')}
            </span>
          </div>
        </div>
      </div>
      <ZoneRowsSkeleton />
    </div>
  );
}
