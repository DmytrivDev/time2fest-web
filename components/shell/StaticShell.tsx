'use client';

import { useState, type ReactNode } from 'react';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Footer } from './Footer';
import { Header } from './Header';
import { Menu } from './Menu';

/**
 * Хедер + `<main id="main">` + футер для сторінок поза `(live)`: 404, помилка. Без плеєра, чату й менеджера вікон —
 * тому меню відкривається локально, а плеєра для паузи немає. Працює і без провайдерів (global-error).
 */
export function StaticShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex min-h-dvh flex-col bg-background text-text">
      <SkipLinks targets={['content']} />
      <Header onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />
      <Menu open={menuOpen} onOpenChange={setMenuOpen} />
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
