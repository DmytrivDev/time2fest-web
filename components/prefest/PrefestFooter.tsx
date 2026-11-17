'use client';

/** Підвал головної «до свята»: лише посилання на відкриті сторінки й якорі цієї сторінки. */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Logo } from '@/components/primitives/Logo';
import { cn } from '@/components/primitives/cn';
import { SUPPORT_EMAIL } from '@/components/shell/Footer';
import ft from './PrefestFooter.module.css';
import s from './prefest.module.css';

type Key = 'countries' | 'schedule' | 'map' | 'about' | 'pass' | 'help' | 'terms' | 'privacy' | 'cookies';

const GROUPS: { title: 'groupFest' | 'groupAbout' | 'groupDocs'; links: { key: Key; href: string }[] }[] = [
  {
    title: 'groupFest',
    links: [
      { key: 'countries', href: '/countries/' },
      { key: 'schedule', href: '#schedule' },
      { key: 'map', href: '#map' },
    ],
  },
  {
    title: 'groupAbout',
    links: [
      { key: 'about', href: '/about/' },
      { key: 'pass', href: '#pass' },
      { key: 'help', href: '/help/' },
    ],
  },
  {
    title: 'groupDocs',
    links: [
      { key: 'terms', href: '/terms/' },
      { key: 'privacy', href: '/privacy/' },
      { key: 'cookies', href: '/cookies/' },
    ],
  },
];

export function PrefestFooter() {
  const t = useTranslations('prefest.footer');
  const h = useTranslations('prefest.header');
  return (
    <footer className={ft.ft}>
      <div className={s.wrap}>
        <div className={ft.cols}>
          <div className={ft.brand}>
            <Logo variant="footer" href="/before/" label={h('logoLabel')} />
            <p className={ft.tag}>{t('tagline')}</p>
            <a className={ft.mail} href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </div>
          {GROUPS.map((g) => (
            <div className={ft.col} key={g.title}>
              <h3>{t(g.title)}</h3>
              {g.links.map((l) =>
                l.href.startsWith('#') ? (
                  <a key={l.key} href={l.href}>
                    {t(l.key)}
                  </a>
                ) : (
                  <NextLink key={l.key} href={l.href}>
                    {t(l.key)}
                  </NextLink>
                ),
              )}
            </div>
          ))}
        </div>
        <div className={cn(ft.bottom)}>
          <span>{t('copyright')}</span>
          <span>{t('stockNote')}</span>
        </div>
      </div>
    </footer>
  );
}
