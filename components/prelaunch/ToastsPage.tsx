'use client';

/**
 * «Тости» мовного дерева: лише інформація — що таке тост, три рівні ($2 / $5 / $10) і що дає кожен, правила.
 * Вікна оплати немає: «Продаж стане доступний згодом».
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { PAGES } from '@/lib/prelaunch/href';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

const STEPS: { key: 'h1' | 'h2' | 'h3'; icon: IconName }[] = [
  { key: 'h1', icon: 'pencil' },
  { key: 'h2', icon: 'glass' },
  { key: 'h3', icon: 'users' },
];
const BENEFITS = ['b1', 'b2', 'b3', 'b4'] as const;
/** Скільки переваг (з початку переліку) входить у рівень. */
const TIERS: { key: 't2' | 't5' | 't10'; included: number }[] = [
  { key: 't2', included: 1 },
  { key: 't5', included: 2 },
  { key: 't10', included: 4 },
];
const RULES = ['r1', 'r2', 'r3'] as const;

function Body() {
  const t = useTranslations('prelaunch.toasts');
  const { site } = usePrefest();
  return (
    <>
      <div className={cn(p.wrap, s.head)}>
        <span className={s.badge}>
          <Icon name="glass" size={16} />
          {t('badge')}
        </span>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.lead}>{t('lead')}</p>
      </div>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="tiers-h">
        <h2 className={p.h2} id="tiers-h">
          {t('tiersTitle')}
        </h2>
        <div className={s.tiles}>
          {TIERS.map((tier, i) => (
            <div
              className={cn(s.tile, s.tier, i === TIERS.length - 1 && s.tierTop)}
              key={tier.key}
              data-tier={tier.key}
            >
              <h3>{t(`${tier.key}Name`)}</h3>
              <span className={s.tierPrice}>{t(`${tier.key}Price`)}</span>
              <ul className={s.checks}>
                {BENEFITS.map((b, n) => {
                  const on = n < tier.included;
                  return (
                    <li key={b} className={on ? undefined : s.off}>
                      <Icon
                        name={on ? 'check' : 'minus'}
                        size={18}
                        aria-label={on ? t('included') : t('notIncluded')}
                      />
                      <span>{t(b)}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
        <div className={s.panel} data-block="toast-soon">
          <div className={s.soonbox}>
            <Icon name="clock" size={20} />
            {t('soon')}
          </div>
          <span className={s.fine}>{t('soonText')}</span>
        </div>
      </section>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="how-h">
        <h2 className={p.h2} id="how-h">
          {t('howTitle')}
        </h2>
        <div className={s.tiles}>
          {STEPS.map((x) => (
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

      <section className={cn(p.wrap, s.sec)} aria-labelledby="rules-h">
        <h2 className={p.h2} id="rules-h">
          {t('rulesTitle')}
        </h2>
        <ul className={cn(s.checks, s.prose)}>
          {RULES.map((r) => (
            <li key={r}>
              <Icon name="check" size={18} />
              <span>{t(r)}</span>
            </li>
          ))}
        </ul>
        {site ? (
          <p className={s.note}>
            <NextLink className={p.link} href={site.href(PAGES.pass)}>
              {t('passLink')} <span aria-hidden="true">›</span>
            </NextLink>
          </p>
        ) : null}
      </section>
    </>
  );
}

export function ToastsPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="toasts" page="S-PL-TOASTS">
      <Body />
    </SiteShell>
  );
}
