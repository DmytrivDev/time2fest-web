'use client';

/**
 * Меню передстартового сайту — те саме бічне вікно й ті самі рядки, що меню сайту свята (`components/shell/Menu`,
 * `SideDialog`, стилі `menu.module.css`; рішення власника 2026-11-19): мови одним рядом угорі (English · Español ·
 * Français · Українська), далі пункти з плиткою-значком і підписом. Лише те, що є на передстартовому сайті: сторінки,
 * пошта й соцмережі одним рядом значків (документи — лише в підвалі) — без входу, паспорта, графіка, кімнати перегляду, режиму вечірки й рейтингу.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import ms from '@/components/shell/menu.module.css';
import { SideDialog } from '@/components/shell/SideDialog';
import type { Locale } from '@/i18n/locales';
import { isPageEnabled, localeHref, PAGES, type PageKey } from '@/lib/prelaunch/href';
import { rememberLocale, useLocaleLinks } from './LangSwitch';
import { SocialLinks } from './SocialIcon';
import s from './site.module.css';

function Row({
  href,
  icon,
  title,
  hint,
  highlight,
  current,
  external,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  highlight?: boolean;
  current?: boolean;
  external?: boolean;
  onNavigate?: () => void;
}) {
  const inner = (
    <>
      <span aria-hidden="true" className={cn(ms.tile, highlight && ms.tileGold)}>
        {icon}
      </span>
      <span className={ms.rowText}>
        <span className={ms.rowTitle}>{title}</span>
        {hint ? <span className={ms.rowHint}>{hint}</span> : null}
      </span>
      <Icon name={external ? 'external' : 'chevron-right'} size={16} className={ms.chev} />
    </>
  );
  return (
    <li>
      {external ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('t2f-focus t2f-transition', ms.row)}
        >
          {inner}
        </a>
      ) : (
        <NextLink
          href={href}
          aria-current={current ? 'page' : undefined}
          onClick={onNavigate}
          className={cn('t2f-focus t2f-transition', ms.row)}
        >
          {inner}
        </NextLink>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={ms.section}>
      <h3 className={ms.sectionTitle}>{title}</h3>
      <ul className={ms.list}>{children}</ul>
    </section>
  );
}

const icon = (name: IconName) => <Icon name={name} size={18} />;

/** Мови в порядку меню сайту (англійська, іспанська, французька, українська; рішення власника 2026-11-08). */
const MENU_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'uk', name: 'Українська' },
] as const;

const SITE_ROWS: readonly { key: PageKey; icon: IconName }[] = [
  { key: 'home', icon: 'home' },
  { key: 'countries', icon: 'map' },
  { key: 'pass', icon: 'ticket' },
  { key: 'pricing', icon: 'card' },
];

export function SiteMenu({
  open,
  onOpenChange,
  locale,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  current?: PageKey | undefined;
}) {
  const t = useTranslations('menu');
  const th = useTranslations('prelaunch.header');
  const links = useLocaleLinks();
  const close = () => onOpenChange(false);
  const hrefOf = (code: string) => links.find((l) => l.locale === code)?.href;

  return (
    <SideDialog open={open} onOpenChange={onOpenChange} title={t('title')}>
      <div className={cn(ms.content, s.menuContent)} data-menu-body="">
        {/* Мова — угорі одним рядом, як у меню сайту; тут це посилання на ту саму сторінку іншою мовою. */}
        <div role="group" aria-label={t('language')} className={ms.langs}>
          {MENU_LANGUAGES.map((l) => {
            const href = hrefOf(l.code);
            if (!href) return null;
            const on = l.code === locale;
            return (
              <a
                key={l.code}
                href={href}
                hrefLang={l.code}
                lang={l.code}
                aria-current={on ? 'true' : undefined}
                data-state={on ? 'checked' : 'unchecked'}
                onClick={() => rememberLocale(l.code as Locale)}
                className={cn('t2f-focus t2f-transition', ms.lang, s.menuLang)}
              >
                {l.name}
              </a>
            );
          })}
        </div>

        <nav aria-label={t('navLabel')}>
          <Section title={t('sectionSite')}>
            {SITE_ROWS.filter((r) => isPageEnabled(r.key)).map((r) => (
              <Row
                key={r.key}
                href={localeHref(locale, PAGES[r.key])}
                icon={icon(r.icon)}
                title={th(r.key)}
                highlight={r.key === 'pass'}
                current={current === r.key}
                onNavigate={close}
              />
            ))}
          </Section>
        </nav>
        {/* Документи — лише в підвалі; пошта й соцмережі — одним рядом значків (рішення власника перед доменом). */}
        <SocialLinks className={s.menuSocial} />
      </div>
    </SideDialog>
  );
}
