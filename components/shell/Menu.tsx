'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { Dialog, RadioGroup, VisuallyHidden } from 'radix-ui';
import { useRef, type MouseEvent, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Logo } from '@/components/primitives/Logo';
import { Switch } from '@/components/primitives/Switch';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { useGuestStore } from '@/stores/guest';

export interface MenuLanguage {
  code: string;
  /** Назва мовою самого пункту (без прапора). */
  name: string;
}

export const MENU_LANGUAGES: MenuLanguage[] = [
  { code: 'uk', name: 'Українська' },
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
];

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Поточна сторінка. */
  current?: 'home' | 'countries';
  language?: string;
  languages?: MenuLanguage[];
  onLanguageChange?: (code: string) => void;
  /** Назва місця, відео з якого стоїть на паузі («Лондон»); без неї рядок паузи не показується. */
  pausedPlace?: string;
  hasPass?: boolean;
  signedIn?: boolean;
  /** «Увійти» гостя: сторінка входу або (`onSignIn`) вікно входу під трансляцією. */
  onSignIn?: () => void;
  /** «Новорічний пас»: сторінка `/pass/` або (`onPass`) вікно оформлення під трансляцією. */
  onPass?: () => void;
  /** Штампів на цьому пристрої (підпис «Мій паспорт»). */
  stampCount?: number;
  /** Керований «Зменшити рух» (історії, тести); без нього — стор гостя. */
  reducedMotion?: boolean;
  onReducedMotionChange?: (value: boolean) => void;
}

const TILE = 'inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-surface-raised';
const ROW =
  't2f-focus t2f-transition flex min-h-13 w-full items-center gap-3.5 rounded-lg px-3 py-2 text-start text-text hover:bg-surface-raised';

function RowBody({ icon, title, hint, highlight }: { icon: IconName; title: ReactNode; hint?: ReactNode; highlight?: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={cn(TILE, highlight && 'text-highlight')}>
        <Icon name={icon} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-strong">{title}</span>
        {hint ? <span className="text-caption text-text-muted">{hint}</span> : null}
      </span>
    </>
  );
}

function NavRow({
  href = '#',
  icon,
  title,
  hint,
  current,
  highlight,
  onNavigate,
}: {
  href?: string;
  icon: IconName;
  title: ReactNode;
  hint?: ReactNode;
  current?: boolean;
  highlight?: boolean;
  onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <li>
      <a href={href} aria-current={current ? 'page' : undefined} onClick={onNavigate} className={cn(ROW, current && 'bg-surface-raised')}>
        <RowBody icon={icon} title={title} hint={hint} highlight={highlight} />
        <Icon name="chevron-right" size={16} className="text-text-muted" />
      </a>
    </li>
  );
}

function Divider() {
  return <div aria-hidden="true" className="mx-3 my-1.5 h-px bg-border" />;
}

/**
 * Меню телефона (ІНВ C23 PhoneMenu; Phone-Menu.dc.html): окремий повноекранний екран (Radix Dialog) з власним
 * хедером. Мова — першою (RadioGroup з `lang`), далі пункти з іконками й «Увійти» для гостя.
 * Відео на паузі: рядок-пояснення з назвою місця; саму паузу й відновлення робить `ShellHeader`.
 * Коралової кнопки в меню немає.
 */
export function Menu({
  open,
  onOpenChange,
  current,
  language = 'uk',
  languages = MENU_LANGUAGES,
  onLanguageChange,
  pausedPlace,
  hasPass = false,
  signedIn = false,
  onSignIn,
  onPass,
  stampCount = 0,
  reducedMotion,
  onReducedMotionChange,
}: MenuProps) {
  const t = useTranslations('menu');
  const th = useTranslations('header');
  const stored = useGuestStore((s) => s.reducedMotion);
  const setStored = useGuestStore((s) => s.setReducedMotion);
  const motion = reducedMotion ?? stored;
  const close = () => onOpenChange(false);
  // Меню відкривається без Dialog.Trigger (кнопка — у хедері), тож Radix не знає, куди повернути фокус:
  // запам’ятовуємо елемент з фокусом до відкриття й повертаємо на нього після закриття (WCAG 2.4.3).
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          data-menu=""
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
          }}
          onCloseAutoFocus={(e) => {
            if (!returnFocus.current?.isConnected) return;
            e.preventDefault();
            returnFocus.current.focus();
          }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background text-text"
        >
          <header className="flex h-14 shrink-0 items-center gap-0.5 border-b border-border ps-4 pe-1">
            <Logo label={th('logoLabel')} className="me-auto" />
            <VisuallyHidden.Root asChild>
              <Dialog.Title>{t('title')}</Dialog.Title>
            </VisuallyHidden.Root>
            <Dialog.Close asChild>
              <IconButton icon="close" iconSize={20} aria-label={t('close')} className="rounded-full border border-text bg-border" />
            </Dialog.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-4">
            {pausedPlace ? (
              <div role="status" className="mx-2 mb-1 mt-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-caption text-text-secondary">
                <Icon name="pause" size={16} className="text-text-muted" />
                <span>{t('playerPaused', { place: pausedPlace })}</span>
              </div>
            ) : null}

            <section aria-labelledby="menu-language" className="px-3 pb-2 pt-3">
              <h3 id="menu-language" className="mb-2 flex items-center gap-2 text-label-sm text-text-secondary">
                <Icon name="globe" size={16} />
                {t('language')}
              </h3>
              <RadioGroup.Root
                aria-labelledby="menu-language"
                value={language}
                onValueChange={onLanguageChange}
                className="grid grid-cols-2 gap-2"
              >
                {languages.map((l) => (
                  <RadioGroup.Item
                    key={l.code}
                    value={l.code}
                    lang={l.code}
                    className="t2f-focus t2f-transition flex min-h-touch-min items-center justify-center gap-1.5 rounded-md border border-border-strong px-3 text-body text-text aria-checked:border-2 aria-checked:border-highlight aria-checked:bg-surface-raised aria-checked:text-body-strong"
                  >
                    <RadioGroup.Indicator asChild>
                      <Icon name="check" size={16} className="text-highlight" />
                    </RadioGroup.Indicator>
                    {l.name}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </section>

            <Divider />

            <nav aria-label={t('navLabel')}>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                <NavRow href="/" icon="home" title={t('home')} current={current === 'home'} onNavigate={close} />
                <NavRow href="/countries" icon="map" title={t('countries')} current={current === 'countries'} onNavigate={close} />
              </ul>
              <Divider />
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                <NavRow href="/schedule/" icon="calendar" title={t('schedule')} hint={hasPass ? undefined : t('scheduleHint')} onNavigate={close} />
                <NavRow href="/passport/" icon="passport" title={t('passport')} hint={t('passportHint', { count: stampCount })} onNavigate={close} />
                <NavRow
                  href="/pass/"
                  icon={hasPass ? 'ticket-check' : 'ticket'}
                  title={t('pass')}
                  hint={t('passHint')}
                  highlight
                  onNavigate={(e) => {
                    if (onPass) {
                      e.preventDefault();
                      onPass();
                    } else close();
                  }}
                />
                <NavRow icon="heart" title={t('support')} hint={t('supportHint')} onNavigate={close} />
              </ul>
              <Divider />
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                <NavRow icon="tv" title={t('partyMode')} onNavigate={close} />
                <NavRow icon="help" title={t('help')} onNavigate={close} />
                <li>
                  <Switch
                    label={
                      <span className="flex items-center gap-3.5">
                        <span aria-hidden="true" className={TILE}>
                          <Icon name="motion" size={18} />
                        </span>
                        <span className="text-body-strong text-text">{t('reduceMotion')}</span>
                      </span>
                    }
                    checked={motion}
                    onCheckedChange={(v) => {
                      setStored(v);
                      onReducedMotionChange?.(v);
                    }}
                    className="min-h-13 w-full justify-between px-3 py-2 hover:bg-surface-raised"
                  />
                </li>
              </ul>
            </nav>

            {signedIn ? null : (
              <div className="mx-1 mt-3 flex flex-col gap-2.5 rounded-lg bg-surface p-3">
                <p className="text-caption text-text-secondary">{t('signInHint')}</p>
                <Button variant="secondary" size="lg" asChild>
                  <NextLink
                    href="/login/"
                    onClick={(e) => {
                      if (onSignIn) {
                        e.preventDefault();
                        onSignIn();
                      } else {
                        rememberReturn(currentPath());
                        close();
                      }
                    }}
                  >
                    <Icon name="user" size={20} />
                    {t('signIn')}
                  </NextLink>
                </Button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
