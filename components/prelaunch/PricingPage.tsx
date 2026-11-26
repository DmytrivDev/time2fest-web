'use client';

/**
 * «Ціни» мовного дерева (рішення власника 2026-11-26, для перевірки платіжного провайдера): що безплатно, що дає
 * Новорічний пас і скільки він коштує ($7 разово, на Новий рік 2026/27, без підписки), хто приймає оплату, як повернути
 * гроші. Лише наявні блоки сайту: заголовок і вступ у вигляді розділів головної, «Новорічний пас» головної
 * (`components/prefest/PassBlock`), «Питання й відповіді» у вигляді «Коротко про головне» (`PrefestFaqList`).
 * Назву платіжного партнера не показуємо, доки його не затверджено.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { PassBlock } from '@/components/prefest/PassBlock';
import { PrefestFaqList } from '@/components/prefest/PrefestFaq';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { SEASON_VALUES } from '@/lib/prelaunch/season';
import p from '@/components/prefest/prefest.module.css';
import type { SiteData } from '@/lib/prelaunch/site';
import { SITE } from './SiteFooter';
import { SiteShell } from './SiteShell';

const QUESTIONS = ['free', 'pass', 'once', 'seller', 'refund', 'when'] as const;

function Body() {
  const t = useTranslations('prelaunch.pricing');
  const { site } = usePrefest();
  const link = (href: string) => (chunks: React.ReactNode) =>
    site ? (
      <NextLink href={site.href(href)} className="underline underline-offset-2">
        {chunks}
      </NextLink>
    ) : (
      chunks
    );
  const rich = {
    refunds: link('/refunds/'),
    terms: link('/terms/'),
    mail: (chunks: React.ReactNode) => (
      <a href={`mailto:${SITE.email}`} className="underline underline-offset-2">
        {chunks}
      </a>
    ),
    email: SITE.email,
    ...SEASON_VALUES,
  };
  return (
    <>
      <section className={cn(p.sec, p.wrap)} aria-labelledby="pricing-h" data-block="pricing-head">
        <h1 className={p.h2} id="pricing-h">
          {t('title')}
        </h1>
        <p className={p.intro}>{t('lead')}</p>
      </section>
      <PassBlock />
      <PrefestFaqList
          className={cn(p.sec, p.wrap)}
          stacks
          title={t('faqTitle')}
          items={QUESTIONS.map((k) => ({
            id: k,
            question: t(`${k}Q`),
            answer: t.rich(`${k}A`, rich),
          }))}
        />
    </>
  );
}

export function PricingPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="pricing" page="S-PL-PRICING">
      <Body />
    </SiteShell>
  );
}
