'use client';

import { useState, type ReactNode } from 'react';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { TimeMachineMount } from '@/components/dev/TimeMachineMount';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { PassPaymentWatcher } from './PassPaymentWatcher';

/**
 * Хедер + сторінка + футер для `/pass/`: поза `(live)`, тож без плеєра й чату (як вхід), з машиною часу тестової
 * збірки (результат оплати) і «сторожем» підтвердження оплати.
 */
export function PassShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  return (
    <TimeProvider>
      <TimeMachineMount />
      <LiveAnnouncer>
        <PassPaymentWatcher />
        <div className="flex min-h-dvh flex-col bg-background text-text">
          <SkipLinks targets={['content']} />
          <Header user={user} hasPass={hasPass} passCurrent onMenuClick={() => setMenuOpen(true)} menuOpen={menuOpen} />
          <Menu open={menuOpen} onOpenChange={setMenuOpen} signedIn={Boolean(user)} hasPass={hasPass} />
          {children}
          <Footer className="mt-0" />
        </div>
      </LiveAnnouncer>
    </TimeProvider>
  );
}
