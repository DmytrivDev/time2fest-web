'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { RadioGroup } from '@/components/primitives/RadioGroup';
import { usePlayer, usePlayerActions } from '@/lib/player/PlayerProvider';
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
 */
export function ShellHeader({ current: currentProp, hasPass, user, pausedPlace }: ShellHeaderProps) {
  const t = useTranslations('menu');
  // Поточний пункт навігації — з маршруту: «Країни» для списку й сторінок країн, інакше переданий.
  const pathname = usePathname();
  const current = pathname?.startsWith('/countries') || pathname?.startsWith('/country/') ? 'countries' : currentProp;
  const [menuOpen, setMenuOpen] = useState(false);
  const [language, setLanguage] = useState('uk');
  const overlay = useOverlay();
  const { status } = usePlayer();
  const { pause, play } = usePlayerActions();
  const resumeOnClose = useRef(false);

  const onMenuChange = (open: boolean) => {
    if (open) {
      overlay.close();
      resumeOnClose.current = status === 'playing';
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
      />
      <Menu
        open={menuOpen}
        onOpenChange={onMenuChange}
        current={current}
        hasPass={hasPass}
        signedIn={Boolean(user)}
        language={language}
        onLanguageChange={setLanguage}
        pausedPlace={pausedPlace}
      />
    </>
  );
}
