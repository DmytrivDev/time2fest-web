'use client';

/**
 * «Новорічний пас» мовного дерева: лише інформація — що дає пас, ціна, порівняння, питання. Оформити не можна:
 * замість кнопки — «Продаж стане доступний згодом» (стан до запуску оплат, як у блоці головної).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { PAGES } from '@/lib/prelaunch/href';
import { SEASON_VALUES } from '@/lib/prelaunch/season';
import type { SiteData } from '@/lib/prelaunch/site';
import { Faq } from './Faq';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

const PERKS: { key: 'p1' | 'p2' | 'p3' | 'p4' | 'p5'; icon: IconName }[] = [
  { key: 'p1', icon: 'route' },
  { key: 'p2', icon: 'calendar-check' },
  { key: 'p3', icon: 'filter' },
  { key: 'p4', icon: 'passport' },
  { key: 'p5', icon: 'translate' },
];
const ROWS = ['c1', 'c2', 'c3', 'c4', 'c5'] as const;
const QUESTIONS = ['1', '2', '3', '4'] as const;

function Body() {
  const t = useTranslations('prelaunch.pass');
  const { site } = usePrefest();
  return (
    <>
      <div className={cn(p.wrap, s.head)}>
        <span className={s.badge}>
          <Icon name="ticket" size={16} />
          {t('badge')}
        </span>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.lead}>{t('lead')}</p>
        <div className={s.panel} data-block="pass-soon">
          <div className={s.price}>
            <b>{t('price')}</b>
            <span>{t('priceNote', SEASON_VALUES)}</span>
          </div>
          <div className={s.buy}>
            <div className={s.soonbox}>
              <Icon name="clock" size={20} />
              {t('soon')}
            </div>
            <span className={s.fine}>{t('soonText')}</span>
          </div>
        </div>
      </div>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="perks-h">
        <h2 className={p.h2} id="perks-h">
          {t('perksTitle')}
        </h2>
        <div className={cn(s.tiles, s.tiles5)}>
          {PERKS.map((x) => (
            <div className={s.tile} key={x.key}>
              <span className={s.ic}>
                <Icon name={x.icon} size={20} />
              </span>
              <h3>{t(`${x.key}Title`)}</h3>
              <p>{t(`${x.key}Text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="cmp-h">
        <h2 className={p.h2} id="cmp-h">
          {t('compareTitle')}
        </h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <td />
                <th scope="col">{t('without')}</th>
                <th scope="col">{t('with')}</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((k) => (
                <tr key={k}>
                  <th scope="row">{t(k)}</th>
                  <td>{t(`${k}Without`)}</td>
                  <td>{t(`${k}With`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="faq-h">
        <h2 className={p.h2} id="faq-h">
          {t('faqTitle')}
        </h2>
        <Faq items={QUESTIONS.map((k) => ({ q: t(`q${k}`), a: t(`a${k}`, SEASON_VALUES) }))} />
        {site ? (
          <p className={s.note}>
            <NextLink className={p.link} href={site.href(PAGES.toasts)}>
              {t('toastsLink')} <span aria-hidden="true">›</span>
            </NextLink>
          </p>
        ) : null}
      </section>
    </>
  );
}

export function PassPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="pass" page="S-PL-PASS">
      <Body />
    </SiteShell>
  );
}
