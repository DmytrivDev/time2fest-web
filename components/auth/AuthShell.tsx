'use client';

import { useState, type ReactNode } from 'react';
import { TimeMachineMount } from '@/components/dev/TimeMachineMount';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { useHeaderUser } from './session';

/**
 * Хедер + сторінка + футер для `/login/` і `/signup/`: поза `(live)`, тож без плеєра й чату (як `StaticShell`),
 * але з машиною часу тестової збірки (перемикачі входу) і хедером того, хто увійшов.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useHeaderUser();
  return (
    <TimeProvider>
      <TimeMachineMount />
      <div className="flex min-h-dvh flex-col bg-background text-text">
        <SkipLinks targets={['content']} />
        <Header user={user} signInCurrent onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <Menu open={menuOpen} onOpenChange={setMenuOpen} signedIn={Boolean(user)} />
        {children}
        <Footer className="mt-0" />
      </div>
    </TimeProvider>
  );
}
