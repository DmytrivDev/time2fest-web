'use client';

/** Сторінка 404 мовного дерева: проста, з посиланнями на головну й країни. У збірці для домену стає `404.html` мови. */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest } from '@/components/prefest/PrefestContext';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import { PAGES } from '@/lib/prelaunch/href';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

function Body() {
  const t = useTranslations('prelaunch.notFound');
  const { site } = usePrefest();
  if (!site) return null;
  return (
    <div className={cn(p.wrap, s.nf)}>
      <span className={s.nfCode} aria-hidden="true">
        404
      </span>
      <h1 className={s.h1}>{t('title')}</h1>
      <p className={s.lead}>{t('text')}</p>
      <div className={cn(p.cta, s.nfCta)}>
        <NextLink className={cn(p.btn, p.btnCoral)} href={site.href(PAGES.home)}>
          {t('home')}
        </NextLink>
        <NextLink className={cn(p.btn, p.btnGhost)} href={site.href(PAGES.countries)}>
          {t('countries')}
        </NextLink>
      </div>
    </div>
  );
}

export function NotFoundPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} page="S-PL-404" langPath="/">
      <Body />
    </SiteShell>
  );
}
