'use client';

import { NotifDialog } from '@/components/notifications/NotifDialog';
import { useState, type ReactNode } from 'react';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { Footer } from './Footer';
import { Header } from './Header';
import { Menu } from './Menu';

/**
 * Хедер + `<main id="main">` + футер для сторінок поза `(live)`: 404, помилка. Без плеєра, чату й менеджера вікон —
 * тому меню відкривається локально, а плеєра для паузи немає. Працює і без провайдерів (global-error).
 */
export function StaticShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <SkipLinks targets={['content']} />
      <Header user={user} hasPass={hasPass} onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} onNotificationsClick={() => setNotifOpen((v) => !v)} />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
      <NotifDialog open={notifOpen} onOpenChange={setNotifOpen} />
      <main
        id="main"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center focus:outline-none"
      >
        {children}
      </main>
      <Footer />
    </div>
  );
}
