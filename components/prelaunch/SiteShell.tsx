'use client';

/** Оболонка сторінки мовного дерева: дані мовою сторінки, шапка, вміст, підвал, підказка мови. */
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import p from '@/components/prefest/prefest.module.css';
import type { PageKey } from '@/lib/prelaunch/href';
import type { SiteData } from '@/lib/prelaunch/site';
import { LangHint } from './LangHint';
import { LangPathContext } from './LangSwitch';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SiteProvider } from './SiteProvider';
import { OverlayManager } from '@/components/shell/OverlayManager';
import s from './site.module.css';

/** «Перейти до вмісту» мовою сторінки: перше в порядку Tab, видно лише у фокусі (як `SkipLinks` сайту). */
function SkipLink() {
  const t = useTranslations('a11y');
  return (
    <a
      href="#content"
      className="t2f-focus fixed left-2 top-2 z-50 -translate-y-24 rounded-md bg-surface-raised px-4 py-3 text-label-button text-text focus:translate-y-0"
    >
      {t('skipToContent')}
    </a>
  );
}

export function SiteShell({
  site,
  current,
  page,
  overlay = false,
  langPath,
  children,
}: {
  site: SiteData;
  current?: PageKey;
  /** Позначка сторінки для перевірок і знімків (`data-page`). */
  page: string;
  /** Шапка поверх першого екрана (головна). */
  overlay?: boolean;
  children: ReactNode;
  langPath?: string;
}) {
  return (
    <SiteProvider site={site}>
      {/* Шторки (вибір поясу країни на телефоні): без чату на сторінці менеджер показує звичайну `Sheet`. */}
      <OverlayManager>
        <LangPathContext.Provider value={langPath ?? null}>
          <div className={cn(p.page, s.page)} data-page={page} data-locale={site.locale}>
            <SkipLink />
            <SiteHeader locale={site.locale} current={current} overlay={overlay} />
            <main
              id="content"
              tabIndex={-1}
              className={cn('focus:outline-none', !overlay && s.main)}
            >
              {children}
            </main>
            <SiteFooter locale={site.locale} />
            <LangHint locale={site.locale} />
          </div>
        </LangPathContext.Provider>
      </OverlayManager>
    </SiteProvider>
  );
}
