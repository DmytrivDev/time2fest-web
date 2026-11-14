'use client';

/** Плашка пасу в профілі кабінету: стан пасу, квитанція / «Що це», «Отримати» (під час святкування — вікно пасу). */

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useOpenPassWindow } from '@/components/pass/PassWindow';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { getData } from '@/lib/data/load';
import { isCelebrating } from '@/lib/engine/celebration';
import { useNow } from '@/lib/time/TimeProvider';
import s from './account.module.css';

export function PassPlaque({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('account.pass');
  const openPass = useOpenPassWindow();
  const celebrating = isCelebrating(useNow({ granularity: 'minute' }), getData());
  return (
    <div className={cn(s.plaque, hasPass ? s.plaqueOn : s.plaqueOff)} data-block="pass-plaque" data-pass={hasPass ? 'active' : 'inactive'}>
      <span aria-hidden="true" className={s.plaqueIcon}>
        <Icon name="ticket" size={22} />
      </span>
      <div className={s.plaqueText}>
        <div className={s.plaqueTitle}>
          {t('title')}
          <span className={cn(s.status, hasPass ? s.statusOn : s.statusOff)}>{hasPass ? t('active') : t('inactive')}</span>
        </div>
        <p className={s.plaqueHint}>{hasPass ? t('activeText') : t.rich('inactiveText', { b: (x) => <b>{x}</b> })}</p>
      </div>
      <div className={s.plaqueActs}>
        {hasPass ? (
          <>
            {/* TODO(квитанція): посилання на квитанцію PayPro — поки сторінка «Оплата й повернення». */}
            <NextLink href="/payments/" className={cn('t2f-focus', s.link)}>
              {t('receipt')}
            </NextLink>
            <NextLink href="/pass/" className={cn('t2f-focus t2f-transition', s.btn, s.line)}>
              {t('what')}
            </NextLink>
          </>
        ) : (
          <>
            <NextLink href="/pass/" className={cn('t2f-focus', s.link, s.under)}>
              {t('more')}
            </NextLink>
            <NextLink
              href="/pass/"
              onClick={(e) => {
                if (!celebrating) return;
                e.preventDefault();
                openPass();
              }}
              className={cn('t2f-focus t2f-transition', s.btn, s.gold)}
            >
              {t('get')}
            </NextLink>
          </>
        )}
      </div>
    </div>
  );
}
