'use client';

/** Підвал мовного дерева (на основі `PrefestFooter`): лише сторінки передстартового сайту, пошта, мови, соцмережі. */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import siteJson from '@/data/prelaunch/site.json';
import { Logo } from '@/components/primitives/Logo';
import { cn } from '@/components/primitives/cn';
import ft from '@/components/prefest/PrefestFooter.module.css';
import p from '@/components/prefest/prefest.module.css';
import { LOCALE_NAMES, type Locale } from '@/i18n/locales';
import { localeHref, PAGES, type PageKey } from '@/lib/prelaunch/href';
import { isRouteEnabled } from '@/lib/prelaunch/pages.mjs';
import { rememberLocale, useLocaleLinks } from './LangSwitch';
import s from './site.module.css';

export const SITE = siteJson as { email: string; social: { name: string; url: string }[] };

type FootKey = PageKey | 'schedule' | 'map';
const GROUPS: {
  title: 'groupFest' | 'groupAbout' | 'groupDocs';
  links: { key: FootKey; path: string }[];
}[] = [
  {
    title: 'groupFest',
    links: [
      { key: 'countries', path: PAGES.countries },
      { key: 'schedule', path: '/#schedule' },
      { key: 'map', path: '/#map' },
    ],
  },
  {
    title: 'groupAbout',
    links: [
      { key: 'pass', path: PAGES.pass },
      { key: 'toasts', path: PAGES.toasts },
    ],
  },
  {
    title: 'groupDocs',
    links: [
      { key: 'terms', path: PAGES.terms },
      { key: 'privacy', path: PAGES.privacy },
      { key: 'cookies', path: PAGES.cookies },
    ],
  },
];

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = useTranslations('prelaunch.footer');
  const h = useTranslations('prelaunch.header');
  const langs = useLocaleLinks();
  return (
    <footer className={ft.ft}>
      <div className={p.wrap}>
        <div className={ft.cols}>
          <div className={ft.brand}>
            <Logo variant="footer" href={localeHref(locale, PAGES.home)} label={h('logoLabel')} />
            <p className={ft.tag}>{t('tagline')}</p>
            <a className={ft.mail} href={`mailto:${SITE.email}`}>
              {SITE.email}
            </a>
            {SITE.social.length ? (
              <ul className={s.social} aria-label={t('socialLabel')}>
                {SITE.social.map((x) => (
                  <li key={x.url}>
                    <a href={x.url} rel="noopener noreferrer" target="_blank">
                      {x.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {GROUPS.map((g) => (
            <div className={ft.col} key={g.title}>
              <p className={s.footTitle}>{t(g.title)}</p>
              {g.links.filter((l) => l.path.includes('#') || isRouteEnabled(l.path)).map((l) => (
                <NextLink key={l.key} href={localeHref(locale, l.path)}>
                  {t(l.key)}
                </NextLink>
              ))}
            </div>
          ))}
        </div>
        <div className={cn(ft.bottom)}>
          <span>{t('copyright')}</span>
          <ul className={s.footLangs} aria-label={t('languageLabel')}>
            {langs.map((l) => (
              <li key={l.locale}>
                <a
                  href={l.href}
                  hrefLang={l.locale}
                  lang={l.locale}
                  aria-current={l.locale === locale ? 'true' : undefined}
                  onClick={() => rememberLocale(l.locale)}
                >
                  {LOCALE_NAMES[l.locale]}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
