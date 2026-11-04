'use client';

/**
 * Скелетон сторінки «Країни й міста» (правки власника 2026-11-04/05): той самий верх, що після завантаження, і рядки поясів
 * тієї самої висоти (58 px десктоп, 76 px телефон). Рядків — досить, щоб перший екран був заповнений до низу.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Skeleton } from '@/components/primitives/Skeleton';
import { useGuestStore } from '@/stores/guest';
import { EventFilter } from './EventFilter';
import styles from './countryList.module.css';
import nn from './nowNext.module.css';

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
 * Уся сторінка (`app/(live)/countries/loading.tsx`). Переклади приходять разом із першою сторінкою (кореневий макет), тож
 * заголовок, підзаголовок, «Мапа | Список», пошук і фільтр — справжні одразу (правка власника 2026-11-05); скелетом — лише
 * рядки поясів, бо їм потрібен час. Підзаголовок — без дати й часу (з’являться після завантаження), тієї самої висоти.
 */
export function CountriesSkeleton() {
  const t = useTranslations('countries');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const hasPass = useGuestStore((g) => g.hasPass);
  const noop = () => undefined;
  return (
    <div aria-busy="true" data-countries-skeleton="" className={styles.page}>
      <span role="status" className="sr-only">
        {tCommon('loading')}
      </span>
      <header className={styles.head}>
        <div className="min-w-0 flex-1">
          <h1 className="text-headline-md text-text">{t('title')}</h1>
          <p className={cn('m-0 text-body text-text-secondary', styles.subtitle)}>{t('subtitleStatic')}</p>
        </div>
      </header>
      <div aria-hidden="true" inert className={cn(nn.filter, styles.filterPhone, styles.phoneOnly)}>
        <span className={nn.seg} data-state="off">
          {tNav('mapShort')}
        </span>
        <span className={nn.seg} data-state="on">
          {tNav('list')}
        </span>
      </div>
      <div aria-hidden="true" inert className={styles.toolbar}>
        <div className={styles.search}>
          <Icon name="search" size={18} className={styles.searchIcon} />
          <input readOnly tabIndex={-1} placeholder={t('searchLabel')} className={styles.searchInput} />
        </div>
        <div className={cn(styles.controls, styles.controlsPhone)}>
          {/* Телефон — без іконок (як `stack`), десктоп — з іконками; розмір екрана тут ще невідомий — обидва, CSS. */}
          <EventFilter
            value="all"
            onValueChange={noop}
            scheduleLocked={!hasPass}
            stack
            className={cn(styles.filter, styles.skFilterReal, styles.phoneOnly)}
          />
          <EventFilter
            value="all"
            onValueChange={noop}
            scheduleLocked={!hasPass}
            className={cn(styles.filter, styles.deskOnly)}
          />
          <span className={styles.deskOnly}>
            <SegmentedControl
              label={t('viewLabel')}
              semantics="pressed"
              value="list"
              onValueChange={noop}
              options={[
                { value: 'map', label: tNav('mapShort') },
                { value: 'list', label: tNav('list') },
              ]}
            />
          </span>
        </div>
      </div>
      <ZoneRowsSkeleton />
    </div>
  );
}
