'use client';

/** «Новорічний пас» до запуску платежів: перелік переваг, ціна й позначка «продаж згодом». Без кнопки купівлі й посилань. */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { usePrefest } from './PrefestContext';
import p from './PassBlock.module.css';
import s from './prefest.module.css';

const ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5'] as const;

export function PassBlock() {
  const t = useTranslations('prefest.pass');
  const tSite = useTranslations('prelaunch.home');
  const { site } = usePrefest();
  return (
    <section className={cn(s.sec, s.wrap)} id="pass" aria-labelledby="pass-h">
      <div className={p.pass}>
        <div>
          <span className={p.badge}>
            <Icon name="ticket" size={16} />
            {t('badge')}
          </span>
          <h2 className={s.h2} id="pass-h">
            {t('title')}
          </h2>
          <p className={cn(s.intro, p.introTop)}>{t('intro')}</p>
          <ul className={p.list}>
            {ITEMS.map((k) => (
              <li key={k}>
                <Icon name="check" size={20} />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
        <div className={p.buy}>
          <div className={p.price}>
            <b>{t('price')}</b>
            <span>{t('priceNote')}</span>
          </div>
          <div className={p.soonbox}>
            <Icon name="clock" size={20} />
            {t('soon')}
          </div>
          <span className={p.fine}>{t('fine')}</span>
          {site ? (
            <NextLink className={s.link} href={site.href('/pass/')}>
              {tSite('passMore')} <span aria-hidden="true">›</span>
            </NextLink>
          ) : null}
        </div>
      </div>
    </section>
  );
}
