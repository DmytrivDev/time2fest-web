'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { Logo } from '@/components/primitives/Logo';
import { Switch } from '@/components/primitives/Switch';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import s from './footer.module.css';

export interface FooterProps {
  /** Керований режим (історії, тести); без нього «Зменшити рух» читається й пишеться в стор гостя. */
  reducedMotion?: boolean;
  onReducedMotionChange?: (value: boolean) => void;
  /** Відкрити налаштування cookies (B-COOKIES); без обробника — посилання на сторінку Cookies. */
  onCookiesClick?: () => void;
  className?: string;
}

const EMAIL = 'support@time2fest.com';
/** Соцмережі — адреси з’являться, коли заведемо акаунти; доти посилання інертні (як «Допомога»). */
const SOCIAL: { name: string; icon: IconName; href: string }[] = [
  { name: 'Telegram', icon: 'telegram', href: '#' },
  { name: 'Instagram', icon: 'instagram', href: '#' },
];

type Item = { key: string; href: string } | { key: 'cookies'; href: null };
const GROUPS: { key: 'groupFest' | 'groupYou' | 'groupHelp'; items: Item[] }[] = [
  {
    key: 'groupFest',
    items: [
      { key: 'countries', href: '/countries/' },
      { key: 'schedule', href: '/schedule/' },
      { key: 'rating', href: '/rating/' },
      { key: 'party', href: '/tv/' },
    ],
  },
  {
    key: 'groupYou',
    items: [
      { key: 'passport', href: '/passport/' },
      { key: 'pass', href: '/pass/' },
      { key: 'support', href: '/support/' },
      { key: 'signIn', href: '/login/' },
    ],
  },
  {
    key: 'groupHelp',
    items: [
      { key: 'help', href: '#' },
      { key: 'rules', href: '/rules/' },
      { key: 'payments', href: '/payments/' },
      { key: 'cookies', href: null },
    ],
  },
];
const LEGAL = [
  { key: 'terms', href: '/terms/' },
  { key: 'privacyShort', href: '/privacy/' },
  { key: 'cookiesShort', href: '/cookies/' },
] as const;

const noopSubscribe = () => () => undefined;

/**
 * Футер за дошкою `Desk-Footer-New`, варіант B (рішення власника 2026-11-08): бренд (лого, речення, пошта підтримки,
 * соцмережі) і три низькі колонки «Свято», «Твоє», «Довідка»; унизу — ©, «Зроблено в Україні» з круглим прапором,
 * Умови · Конфіденційність · Cookies, попередження про спалахи й «Зменшити рух» (ІНВ C23). Вибору мови немає — лише в шапці.
 * Телефон: колонки — плавні акордеони. Поточна сторінка підсвічена; «Увійти» ховається, коли вже увійшли.
 */
export function Footer({ reducedMotion, onReducedMotionChange, onCookiesClick, className }: FooterProps) {
  const t = useTranslations('footer');
  const stored = useGuestStore((st) => st.reducedMotion);
  const setStored = useGuestStore((st) => st.setReducedMotion);
  const checked = reducedMotion ?? stored;
  const pathname = usePathname();
  // Вхід читається лише на клієнті — до гідратації «Увійти» є завжди, тож розмітка збігається.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const signedIn = useAuthStore((st) => st.user) !== null && hydrated;
  const here = (href: string) => (href !== '#' && pathname?.startsWith(href.replace(/\/$/, '')) ? 'page' : undefined);

  return (
    <footer className={cn(s.footer, className)}>
      <div className={s.inner}>
        <div className={s.top}>
          <div className={s.brand}>
            <Logo label={t('logoLabel')} />
            <p className={s.about}>{t('about')}</p>
            <div className={s.contact}>
              <a href={`mailto:${EMAIL}`} aria-label={`${t('emailLabel')}: ${EMAIL}`} className={cn('t2f-focus', s.mail)}>
                <Icon name="mail" size={16} />
                {EMAIL}
              </a>
              <ul aria-label={t('socialLabel')} className={s.social}>
                {SOCIAL.map((x) => (
                  <li key={x.name}>
                    <a href={x.href} aria-label={x.name} className={cn('t2f-focus t2f-transition', s.socialBtn)}>
                      <Icon name={x.icon} size={16} />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <nav aria-label={t('navLabel')} className={s.cols}>
            {GROUPS.map((g) => (
              <Group key={g.key} title={t(g.key)}>
                {g.items
                  .filter((it) => !(it.key === 'signIn' && signedIn))
                  .map((it) => (
                    <li key={it.key}>
                      {it.href === null ? (
                        onCookiesClick ? (
                          <button type="button" onClick={onCookiesClick} className={cn('t2f-focus t2f-transition', s.link)}>
                            {t('cookies')}
                          </button>
                        ) : (
                          <NextLink href="/cookies/" className={cn('t2f-focus t2f-transition', s.link)}>
                            {t('cookies')}
                          </NextLink>
                        )
                      ) : (
                        <NextLink href={it.href} aria-current={here(it.href)} className={cn('t2f-focus t2f-transition', s.link)}>
                          {t(it.key)}
                        </NextLink>
                      )}
                    </li>
                  ))}
              </Group>
            ))}
          </nav>
        </div>

        <div className={s.bottom}>
          <p className={s.copy}>
            {t('copyright', { year: 2026 })} · {t('madeIn')}
            <span className={s.ua} aria-hidden="true" />
          </p>
          <ul aria-label={t('docsLabel')} className={s.legal}>
            {LEGAL.map((x) => (
              <li key={x.key}>
                <NextLink href={x.href} aria-current={here(x.href)} className={cn('t2f-focus t2f-transition', s.legalLink)}>
                  {t(x.key)}
                </NextLink>
              </li>
            ))}
          </ul>
          <span className={s.spacer} aria-hidden="true" />
          <p className={s.flash}>
            <Icon name="zap" size={14} />
            {t('flashWarning')}
          </p>
          <div className={s.motion}>
            <Switch
              compact
              labelSide="end"
              label={t('reduceMotion')}
              checked={checked}
              onCheckedChange={(v) => {
                setStored(v);
                onReducedMotionChange?.(v);
              }}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Колонка: на десктопі — заголовок і список; на телефоні — плавний акордеон (той самий список). */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={s.group}>
      <h2 className={s.title}>{title}</h2>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} className={cn('t2f-focus', s.trigger)}>
        {title}
        <Icon name="chevron-down" size={16} className={s.chev} />
      </button>
      <div id={id} className={s.reveal} data-open={open}>
        <ul className={s.list}>{children}</ul>
      </div>
    </div>
  );
}
