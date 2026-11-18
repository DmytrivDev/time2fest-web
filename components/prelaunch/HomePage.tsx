'use client';

/**
 * Головна мовного дерева — головна «до свята» (`components/prefest`) з правками плану передстартового сайту
 * (розділ 9) і блоком «Лишайся на зв’язку». Шапка й підвал — мовного дерева.
 */
import { useTranslations } from 'next-intl';
import { CountryCards } from '@/components/prefest/CountryCards';
import { MyMidnight } from '@/components/prefest/MyMidnight';
import { NightWalk } from '@/components/prefest/NightWalk';
import { PassBlock } from '@/components/prefest/PassBlock';
import { PrefestFaq } from '@/components/prefest/PrefestFaq';
import { PrefestHero } from '@/components/prefest/PrefestHero';
import { PrefestMap } from '@/components/prefest/PrefestMap';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { ScheduleRail } from '@/components/prefest/ScheduleRail';
import { WhatIs } from '@/components/prefest/WhatIs';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { downloadIcs } from '@/lib/prefest/ics';
import type { SiteData } from '@/lib/prelaunch/site';
import { SITE } from './SiteFooter';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

/** «Лишайся на зв’язку» (рішення власника 2026-11-18): календар і посилання на соцмережі; без збору пошти. */
function StayInTouch() {
  const t = useTranslations('prelaunch.home');
  const hero = useTranslations('prefest.hero');
  const { model } = usePrefest();
  return (
    <section className={cn(p.sec, p.wrap)} aria-labelledby="stay-h">
      <div className={cn(s.panel, s.stay)}>
        <div>
          <h2 id="stay-h">{t('stayTitle')}</h2>
          <p>{t('stayText')}</p>
          {SITE.social.length ? (
            <>
              <p>{t('staySocial')}</p>
              <ul className={s.social}>
                {SITE.social.map((x) => (
                  <li key={x.url}>
                    <a href={x.url} rel="noopener noreferrer" target="_blank">
                      {x.name}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <button
          type="button"
          className={cn(p.btn, p.btnCoral)}
          onClick={() =>
            downloadIcs(
              {
                uid: 'time2fest-first-midnight-2027',
                title: hero('calendarTitle'),
                description: hero('calendarText'),
                startMs: model.firstMidnightMs,
              },
              'time2fest-new-year.ics',
            )
          }
        >
          <Icon name="calendar-add" size={20} />
          {hero('addCalendar')}
        </button>
      </div>
    </section>
  );
}

export function HomePage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="home" page="S-PL-HOME" overlay>
      <PrefestHero />
      <ScheduleRail />
      <MyMidnight />
      <PrefestMap />
      <NightWalk />
      <WhatIs />
      <CountryCards />
      <PassBlock />
      <PrefestFaq />
      <StayInTouch />
    </SiteShell>
  );
}
