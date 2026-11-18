'use client';

/**
 * «Тости» мовного дерева — наявна сторінка «Тости світу» (`/support/`, `components/support`) у її стані «до свята», у тій
 * самій сітці колонки, що на сайті: герой (малюнок, «до свята», «Тости світу», лід) із «Тости відкриються разом зі
 * святом», «Що таке тост» із трьома рівнями й що дає кожен (лише показ), картка пасу, «Питання й відповіді». Прибрано
 * лише колонку чату «Світ». Кнопки «Сказати тост» у стані «до свята» й так немає.
 */
import { useTranslations } from 'next-intl';
import { Faq } from '@/components/live/Faq';
import { usePrefest } from '@/components/prefest/PrefestContext';
import {
  Hero,
  OpensAt,
  PassCard,
  WhatIsToast,
  type HeroArtText,
} from '@/components/support/SupportParts';
import sp from '@/components/support/support.module.css';
import shell from '@/app/(live)/live-shell.module.css';
import { cn } from '@/components/primitives/cn';
import { PAGES } from '@/lib/prelaunch/href';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';

const FAQ = ['subscription', 'pass', 'refund', 'check'] as const;

function Body() {
  const t = useTranslations('supportPage');
  const ta = useTranslations('prelaunch.toasts.art');
  const { site } = usePrefest();
  const art: HeroArtText = {
    badge: ta('badge'),
    backNick: ta('backNick'),
    backText: ta('backText'),
    frontNick: ta('frontNick'),
    frontText: ta('frontText'),
  };
  const faq = FAQ.map((k) => ({ id: k, question: t(`faq.${k}Q`), answer: t(`faq.${k}A`) }));
  return (
    <div className={shell.shell}>
      <div className={shell.top}>
        <div className={cn(shell.main, sp.page)} data-season="before">
          <Hero season="before" art={art}>
            <OpensAt />
          </Hero>
          <WhatIsToast />
          <PassCard href={site ? site.href(PAGES.pass) : '/pass/'} />
          <Faq items={faq} columns={2} className={sp.faq} />
        </div>
      </div>
    </div>
  );
}

export function ToastsPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="toasts" page="S-PL-TOASTS">
      <Body />
    </SiteShell>
  );
}
