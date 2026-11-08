'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { useOpenPassWindow } from '@/components/pass/PassWindow';
import { useOpenTipsWindow } from '@/components/tips/TipsWindow';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { getData } from '@/lib/data/load';
import { isCelebrating } from '@/lib/engine/celebration';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { usePlayer, usePlayerActions } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import { Header, type HeaderProps } from './Header';
import { Menu, MENU_LANGUAGES } from './Menu';
import { useOverlay } from './OverlayManager';

const LANGUAGE_WINDOW = 'O-LANGUAGE';
const SHORT: Record<string, string> = { uk: 'УКР', en: 'ENG', es: 'ESP', fr: 'FRA' };

export interface ShellHeaderProps extends Pick<HeaderProps, 'current' | 'hasPass' | 'user'> {
  /** Назва місця для рядка «трансляція на паузі» в меню. TODO(T063): з BroadcastController. */
  pausedPlace?: string;
}

/**
 * Хедер макета `(live)` з підключеним повноекранним меню (телефон, планшет) і панеллю мови (планшет-альбом, десктоп).
 * Відкриття меню ставить плеєр на паузу й закриває будь-яке відкрите вікно; закриття — продовжує, якщо відео грало.
 * «Підтримати», «Новорічний пас», «Увійти»: поки йде свято (від 2 год до першої півночі до останньої, рішення власника
 * 2026-11-08) — вікно на місці чату (телефон — шторка), щоб не йти з трансляцій; до й після свята — свої сторінки
 * (`/support/`, `/pass/`, `/login/` з поверненням сюди ж).
 */
export function ShellHeader({ current: currentProp, hasPass: hasPassProp, user: userProp, pausedPlace }: ShellHeaderProps) {
  const t = useTranslations('menu');
  // Поточний пункт навігації — з маршруту: «Країни» для списку й сторінок країн, інакше переданий.
  const pathname = usePathname();
  // Сторінки поза навігацією «Головна / Країни» (`/tv-info/`, `/schedule/`) — без підсвіченого пункту.
  const outside = ['/tv-info', '/schedule', '/support', '/rating', '/passport'].some((p) => pathname?.startsWith(p));
  const current = pathname?.startsWith('/countries') || pathname?.startsWith('/country/') ? 'countries' : outside ? undefined : currentProp;
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, setLanguage] = useState('uk');
  const overlay = useOverlay();
  const { status } = usePlayer();
  const { pause, play } = usePlayerActions();
  const resumeOnClose = useRef(false);
  const sessionUser = useHeaderUser();
  const user = userProp ?? sessionUser;
  const storedPass = useHeaderPass();
  const hasPass = hasPassProp ?? storedPass;
  const openAuthWindow = useOpenAuthWindow();
  const openPassWindow = useOpenPassWindow();
  const openTips = useOpenTipsWindow();
  const router = useRouter();
  const celebrating = isCelebrating(useNow({ granularity: 'minute' }), getData());

  const onSignInClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (celebrating) {
      e.preventDefault();
      openAuthWindow();
      return;
    }
    rememberReturn(currentPath());
  };
  // «Пас»: свято йде — оформлення вікном; інакше — сторінка пасу.
  const onPassClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (celebrating) {
      e.preventDefault();
      openPassWindow();
    }
  };
  const onMenuPass = () => {
    const wasPlaying = resumeOnClose.current;
    onMenuChange(false);
    if (wasPlaying) {
      openPassWindow();
      return;
    }
    router.push('/pass/');
  };
  // Меню ставить відео на паузу: «грало» — це стан до відкриття меню.
  const onMenuSignIn = () => {
    const wasPlaying = resumeOnClose.current;
    onMenuChange(false);
    if (wasPlaying) {
      openAuthWindow();
      return;
    }
    rememberReturn(currentPath());
    router.push('/login/');
  };

  const onMenuChange = (open: boolean) => {
    if (open) {
      overlay.close();
      // Десктоп: меню — панель на місці чату, відео видно й грає далі; телефон і планшет — на весь екран, відео на паузі.
      const desktop = typeof window !== 'undefined' && window.matchMedia?.('(min-width: 1200px)').matches;
      resumeOnClose.current = status === 'playing' && !desktop;
      if (resumeOnClose.current) pause();
    }
    setMenuOpen(open);
  };

  useEffect(() => {
    if (menuOpen || !resumeOnClose.current) return;
    resumeOnClose.current = false;
    play();
  }, [menuOpen, play]);

  const lang = MENU_LANGUAGES.find((l) => l.code === language) ?? MENU_LANGUAGES[0]!;
  const languageOpen = overlay.current?.id === LANGUAGE_WINDOW;

  const openLanguage = () => {
    if (languageOpen) {
      overlay.close(LANGUAGE_WINDOW);
      return;
    }
    overlay.open({
      id: LANGUAGE_WINDOW,
      kind: 'nonmodal',
      title: t('languageList'),
      content: (
        <RadioGroup
          label={t('languageList')}
          defaultValue={language}
          onValueChange={setLanguage}
          options={MENU_LANGUAGES.map((l) => ({ value: l.code, label: l.name, lang: l.code }))}
        />
      ),
    });
  };

  return (
    <>
      <Header
        current={current}
        hasPass={hasPass}
        user={user}
        language={{ code: SHORT[lang.code] ?? lang.code.toUpperCase(), name: lang.name }}
        onMenuClick={() => onMenuChange(true)}
        menuOpen={menuOpen}
        onLanguageClick={openLanguage}
        languageOpen={languageOpen}
        onSignInClick={onSignInClick}
        onPassClick={onPassClick}
        onSupportClick={celebrating ? () => openTips() : undefined}
      />
      <Menu
        open={menuOpen}
        onOpenChange={onMenuChange}
        current={current}
        hasPass={hasPass}
        signedIn={Boolean(user)}
        onSignIn={onMenuSignIn}
        onPass={onMenuPass}
        language={language}
        onLanguageChange={setLanguage}
        pausedPlace={pausedPlace}
      />
    </>
  );
}
