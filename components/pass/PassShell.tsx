'use client';

import { NotifDialog } from '@/components/notifications/NotifDialog';
import { createContext, useState, type ReactNode } from 'react';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { TimeMachineMount } from '@/components/dev/TimeMachineMount';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Footer } from '@/components/shell/Footer';
import { Header } from '@/components/shell/Header';
import { Menu } from '@/components/shell/Menu';
import { TimeProvider } from '@/lib/time/TimeProvider';
import { PaymentWatcher } from '@/components/checkout/PaymentWatcher';
import { ReturnNotice } from '@/components/checkout/ReturnNotice';
import { ApiRuntime } from '@/lib/api/ApiRuntime';

/**
 * Хедер + сторінка + футер для `/pass/` (і `/passport/` — `passCurrent={false}`): поза `(live)`, тож без плеєра й чату (як вхід), з машиною часу тестової
 * збірки (результат оплати) і «сторожем» підтвердження оплати.
 */
export type PassSidePanel = null | 'menu' | 'notif' | 'notif-settings';
/** Що стоїть на місці картки оформлення (десктоп, рішення власника 2026-11-09): меню, сповіщення чи саме оформлення (`null`). */
export const PassSideContext = createContext<{ panel: PassSidePanel; setPanel: (p: PassSidePanel) => void }>({ panel: null, setPanel: () => undefined });

export function PassShell({ children, passCurrent = true }: { children: ReactNode; passCurrent?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [panel, setPanel] = useState<PassSidePanel>(null);
  // Десктоп: картка оформлення — закріплена колонка праворуч (як чат), тож меню й сповіщення стають на її місце.
  const desktop = () => typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 1024px)').matches;
  const onMenu = () => (desktop() ? setPanel((p) => (p === 'menu' ? null : 'menu')) : setMenuOpen(true));
  const onNotif = () => (desktop() ? setPanel((p) => (p === 'notif' || p === 'notif-settings' ? null : 'notif')) : setNotifOpen((v) => !v));
  const user = useHeaderUser();
  const hasPass = useHeaderPass();
  return (
    <TimeProvider>
      <TimeMachineMount />
      <LiveAnnouncer>
        {/* Оплата пасу (шов E4): «сервер» оплат імітації й стеження вікна — як у макеті `(live)`. */}
        <ApiRuntime only={['checkout']} />
        <PaymentWatcher />
        <div className="flex min-h-dvh flex-col bg-background text-text">
          <SkipLinks targets={['content']} />
          <Header user={user} hasPass={hasPass} passCurrent={passCurrent} onMenuClick={onMenu} menuOpen={menuOpen || panel === 'menu'} onNotificationsClick={onNotif} />
          <Menu open={menuOpen} onOpenChange={setMenuOpen} signedIn={Boolean(user)} hasPass={hasPass} />
          <NotifDialog open={notifOpen} onOpenChange={setNotifOpen} />
          {/* Повернення з PayPro (`?order=`) і з Google — смуга під шапкою. */}
          <ReturnNotice profileStep="page" />
          <PassSideContext.Provider value={{ panel, setPanel }}>{children}</PassSideContext.Provider>
          <Footer />
        </div>
      </LiveAnnouncer>
    </TimeProvider>
  );
}
