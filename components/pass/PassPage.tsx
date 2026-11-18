'use client';

/**
 * S-PASS — сторінка Новорічного пасу `/pass/` за дошками `S-PASS · …` (розділ «Купівля Новорічного пасу», v100):
 * Герой з квитком і ціною — першим, на рівні з карткою оформлення («На головну» прибрано, власник 2026-11-07), картка оформлення
 * (усі стани — `PassBuy`), «Що вмикається одразу після оплати» (плитки), «Питання й відповіді».
 * Телефон — одна колонка; десктоп (≥ 1024, дошки v102) — ліва колонка (герой, плитки, питання) і оформлення
 * в закріпленому сайдбарі праворуч, як чат на головній.
 */
import { NotificationsBody, NotifSettings } from '@/components/notifications/NotificationsBody';
import { IconButton } from '@/components/primitives/IconButton';
import { MenuBody } from '@/components/shell/Menu';
import { PassSideContext } from './PassShell';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useContext } from 'react';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { currentPath, rememberCodeSent, rememberReturn } from '@/lib/auth/returnTo';
import { useSession } from '@/lib/api/hooks/auth';
import { PassBuy, usePassView } from './PassBuy';
import { Faq, Hero } from './PassPageParts';
import { PassPerksShowcase } from './PassPerks';
import s from './pass.module.css';

/** Меню або сповіщення на місці картки оформлення (десктоп). */
function SidePanel() {
  const tm = useTranslations('menu');
  const tn = useTranslations('notif');
  const { panel, setPanel } = useContext(PassSideContext);
  const close = () => setPanel(null);
  const title = panel === 'menu' ? tm('title') : panel === 'notif-settings' ? tn('settingsTitle') : tn('title');
  return (
    <div className={s.side} data-block="pass-side" data-panel={panel ?? ''}>
      <div className={s.sideHead}>
        {panel === 'notif-settings' ? (
          <button type="button" onClick={() => setPanel('notif')} className={cn('t2f-focus', s.sideBack)}>
            <Icon name="chevron-left" size={18} />
            {tm('back')}
          </button>
        ) : null}
        <h2 className={s.sideTitle}>{title}</h2>
        <IconButton icon="close" iconSize={20} aria-label={tm('closeWindow')} onClick={close} />
      </div>
      <div className={s.sideBody}>
        {panel === 'menu' ? <MenuBody onClose={close} /> : null}
        {panel === 'notif' ? <NotificationsBody onSettings={() => setPanel('notif-settings')} onGo={close} /> : null}
        {panel === 'notif-settings' ? <NotifSettings /> : null}
      </div>
    </div>
  );
}

export function PassPage() {
  // Підписка на сесію (і синхронізація вкладок у `sim`) — поки сторінка відкрита.
  useSession();
  const t = useTranslations('pass.page');
  const router = useRouter();
  const view = usePassView();
  const { panel } = useContext(PassSideContext);
  // Після оплати змінюється лише картка оформлення (v102): герой — «✓ Активний», плитки й питання лишаються.
  const done = view === 'success' || view === 'active';
  const toLogin = () => {
    rememberReturn(currentPath());
    router.push('/login/');
  };
  return (
    <main id="content" tabIndex={-1} className={cn(s.main, 'focus:outline-none')} data-page="S-PASS" data-view={view}>
      <Hero active={done} />
      <section aria-label={t('buyTitle')} className={cn('t2f-chat-log t2f-slot-body', s.card)} data-block="pass-buy">
        {/* Десктоп: меню й сповіщення — на місці оформлення, як вікна на місці чату (власник 2026-11-09); закрити —
            оформлення повертається з усім уже введеним (воно лише сховане). */}
        {panel ? <SidePanel /> : null}
        <div hidden={!!panel}>
          <PassBuy
            variant="page"
            onSignIn={toLogin}
            onCodeSent={() => {
              rememberCodeSent();
              toLogin();
            }}
          />
        </div>
      </section>
      <PassPerksShowcase />
      <Faq />
    </main>
  );
}
