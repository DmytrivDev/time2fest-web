'use client';

/**
 * Головна мовного дерева — головна «до свята» (`components/prefest`, затверджений дизайн `home-prefest`) з правками
 * плану передстартового сайту (розділ 9) і рішень власника 2026-11-18. Шапка й підвал — мовного дерева.
 */
import { CountryCards } from '@/components/prefest/CountryCards';
import { MyMidnight } from '@/components/prefest/MyMidnight';
import { NightWalk } from '@/components/prefest/NightWalk';
import { PassBlock } from '@/components/prefest/PassBlock';
import { PrefestFaq } from '@/components/prefest/PrefestFaq';
import { PrefestHero } from '@/components/prefest/PrefestHero';
import { PrefestMap } from '@/components/prefest/PrefestMap';
import { ScheduleRail } from '@/components/prefest/ScheduleRail';
import { WhatIs } from '@/components/prefest/WhatIs';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';

export function HomePage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="home" page="S-PL-HOME" overlay>
      <PrefestHero />
      <ScheduleRail />
      <MyMidnight />
      <PrefestMap />
      <NightWalk />
      <WhatIs />
      {/* Пас — над «Як зустрічають Новий рік у світі» (рішення власника 2026-11-18). */}
      <PassBlock />
      <CountryCards />
      <PrefestFaq />
    </SiteShell>
  );
}
