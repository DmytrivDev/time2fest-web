'use client';

/** «Про проєкт» мовного дерева: що таке Time2Fest, як це буде 31 грудня, що безплатно, що є вже зараз, контакти. Без входу й оплат. */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { PAGES } from '@/lib/prelaunch/href';
import type { SiteData } from '@/lib/prelaunch/site';
import { SITE } from './SiteFooter';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

const HOW: { key: 'how1' | 'how2' | 'how3' | 'how4'; icon: IconName }[] = [
  { key: 'how1', icon: 'broadcast' },
  { key: 'how2', icon: 'chat' },
  { key: 'how3', icon: 'stamp' },
  { key: 'how4', icon: 'glass' },
];
const TEXTS = ['free', 'now', 'who'] as const;

function Body() {
  const t = useTranslations('prelaunch.about');
  const { site } = usePrefest();
  return (
    <>
      <div className={cn(p.wrap, s.head)}>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.lead}>{t('lead')}</p>
      </div>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="what-h">
        <div className={s.prose}>
          <h2 id="what-h" className={p.h2}>
            {t('whatTitle')}
          </h2>
          <p>{t('whatText')}</p>
        </div>
      </section>

      <section className={cn(p.wrap, s.sec)} aria-labelledby="how-h">
        <h2 className={p.h2} id="how-h">
          {t('howTitle')}
        </h2>
        <div className={cn(s.tiles, s.tiles4)}>
          {HOW.map((x) => (
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

      <section className={cn(p.wrap, s.sec)}>
        <div className={s.prose}>
          {TEXTS.map((k) => (
            <div key={k}>
              <h2>{t(`${k}Title`)}</h2>
              <p>{t(`${k}Text`)}</p>
            </div>
          ))}
          <h2>{t('contactTitle')}</h2>
          <p>
            {t('contactText')} <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
          </p>
        </div>
        {site ? (
          <div className={cn(p.cta, s.stay)}>
            <NextLink className={cn(p.btn, p.btnCoral)} href={site.href('/#schedule')}>
              {t('seeSchedule')}
            </NextLink>
            <NextLink className={cn(p.btn, p.btnGhost)} href={site.href(PAGES.countries)}>
              {t('seeCountries')}
            </NextLink>
          </div>
        ) : null}
      </section>
    </>
  );
}

export function AboutPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="about" page="S-PL-ABOUT">
      <Body />
    </SiteShell>
  );
}
