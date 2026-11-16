'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { useHeaderPass, useHeaderUser } from '@/components/auth/session';
import { useOpenPassWindow } from '@/components/pass/PassWindow';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useNotifications } from '@/lib/api/hooks/notifications';
import { getData } from '@/lib/data/load';
import { isCelebrating } from '@time2fest/rules/time';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { useNow } from '@/lib/time/TimeProvider';
import { Header, type HeaderProps } from './Header';
import { TimeMachineBody } from '@/components/dev/TimeMachineBody';
import { NotificationsBody, NotifSettings } from '@/components/notifications/NotificationsBody';
import { IS_DEMO_BUILD } from '@/lib/env';
import { MenuBody } from './Menu';
import { PASSPORT_HREF } from '@/components/stamp/StampBlock';
import { scrollToStampCard, useStampCelebration } from './useStampCelebration';
import ms from './menu.module.css';
import { useOverlay } from './OverlayManager';

/** Вікно меню (`OverlayManager`). */
export const MENU_WINDOW_ID = 'O-MENU';
/** Демо: вікно «Машини часу». */
export const TIME_WINDOW_ID = 'O-TIME';
/** Вікно сповіщень. */
export const NOTIF_WINDOW_ID = 'O-NOTIF';

export type ShellHeaderProps = Pick<HeaderProps, 'current' | 'hasPass' | 'user'>;

/**
 * Хедер макета `(live)`; меню — вікно O-MENU через `OverlayManager` (на місці чату / шторка), мова — лише в меню (2026-11-08).
 * Меню відео не перекриває, тож на паузу його не ставить.
 * «Новорічний пас», «Увійти»: поки йде свято (від 2 год до першої півночі до останньої, рішення власника 2026-11-08) —
 * вікно на місці чату (телефон — шторка), щоб не йти з трансляцій; до й після свята — свої сторінки (`/pass/`, `/login/`
 * з поверненням сюди ж). «Сказати тост» — лише поки свято йде (рішення власника 2026-11-13, `useCanToast`): вікно тосту;
 * до й після свята кнопки немає.
 * Свято штампа (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header`, 2026-11-12): `useStampCelebration` — черга, відкладення
 * на час повного екрана й прихованої вкладки; клік по золотій шапці — до картки штампу під плеєром (немає картки — паспорт).
 * Поки свято попереду чи грає, дзвіночок не показує нових сповіщень — +1 наприкінці.
 */
export function ShellHeader({ current: currentProp, hasPass: hasPassProp, user: userProp }: ShellHeaderProps) {
  // Поточний пункт навігації — з маршруту: «Країни» для списку й сторінок країн, інакше переданий.
  const pathname = usePathname();
  // Сторінки поза навігацією «Головна / Країни» (`/tv-info/`, `/schedule/`) — без підсвіченого пункту.
  const outside = ['/tv-info', '/schedule', '/support', '/rating', '/passport', '/account'].some((p) => pathname?.startsWith(p));
  const current = pathname?.startsWith('/countries') || pathname?.startsWith('/country/') ? 'countries' : outside ? undefined : currentProp;
  const t = useTranslations('menu');
  const overlay = useOverlay();
  const sessionUser = useHeaderUser();
  const user = userProp ?? sessionUser;
  const storedPass = useHeaderPass();
  const hasPass = hasPassProp ?? storedPass;
  const openAuthWindow = useOpenAuthWindow();
  const openPassWindow = useOpenPassWindow();
  // «Сказати тост» — лише під час свята, вікном (тост — головний платний продукт, рішення 2026-11-12 і 2026-11-13).
  const openToast = useOpenToastWindow();
  const celebrating = isCelebrating(useNow({ granularity: 'minute' }), getData());
  const menuOpen = overlay.current?.id === MENU_WINDOW_ID;
  const tn = useTranslations('notif');
  const td = useTranslations('demoTime');
  const router = useRouter();

  const cel = useStampCelebration({ guest: !user });
  const { items: notifItems } = useNotifications();
  const heldCount = cel.holdFrom === null ? null : notifItems.reduce((n, x) => n + (!x.read && x.createdAt < cel.holdFrom! ? 1 : 0), 0);
  const onActivateCelebration = () => {
    // Шапка відпливає вгору з-під миші — наведення більше не тримає паузу (pointerleave при прокрутці не приходить).
    cel.setHold('hover', false);
    if (!scrollToStampCard(cel.reduced)) router.push(PASSPORT_HREF);
  };

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

  // Меню — вікно O-MENU, як «Сказати тост» чи вхід (власник 2026-11-08): десктоп — на місці чату, телефон — шторка до відео.
  // Відео не перекривається, тож пауза не потрібна. «Увійти» й «Мій графік» без пасу під час свята — вікном на тому ж місці.
  const toggleMenu = () => {
    if (menuOpen) {
      overlay.close(MENU_WINDOW_ID);
      return;
    }
    openMenu();
  };
  const openMenu = () => {
    const close = () => overlay.close(MENU_WINDOW_ID);
    overlay.open({
      id: MENU_WINDOW_ID,
      kind: 'form',
      chrome: 'board',
      title: t('title'),
      content: (
        <div className={ms.window}>
          <MenuBody
            current={current}
            hasPass={hasPass}
            signedIn={Boolean(user)}
            onSignIn={celebrating ? () => openAuthWindow() : undefined}
            onPass={celebrating ? () => openPassWindow() : undefined}
            onClose={close}
            keepOpenOnNavigate
          />
        </div>
      ),
    });
  };
  // Демо: «Машина часу» — годинник у шапці; вікно на місці чату (телефон — шторка), як меню.
  const timeOpen = overlay.current?.id === TIME_WINDOW_ID;
  const toggleTimeMachine = () => {
    if (timeOpen) overlay.close(TIME_WINDOW_ID);
    else overlay.open({ id: TIME_WINDOW_ID, kind: 'form', chrome: 'board', title: td('title'), content: <TimeMachineBody /> });
  };

  // Сповіщення — вікно O-NOTIF (рішення власника 2026-11-09): десктоп — на місці чату, телефон — шторка до відео;
  // «Налаштувати» — другий рівень того ж вікна з «‹ Назад».
  const openNotifList = () => {
    const close = () => overlay.close(NOTIF_WINDOW_ID);
    overlay.open({
      id: NOTIF_WINDOW_ID,
      kind: 'form',
      chrome: 'board',
      title: tn('title'),
      content: <NotificationsBody onSettings={openNotifSettings} onGo={close} />,
    });
  };
  const openNotifSettings = () => {
    overlay.open({
      id: NOTIF_WINDOW_ID,
      kind: 'form',
      chrome: 'board',
      title: tn('settingsTitle'),
      onBack: openNotifList,
      content: <NotifSettings />,
    });
  };
  const toggleNotif = () => {
    if (overlay.current?.id === NOTIF_WINDOW_ID) overlay.close(NOTIF_WINDOW_ID);
    else openNotifList();
  };

  return (
    <Header
      current={current}
      hasPass={hasPass}
      user={user}
      onMenuClick={toggleMenu}
      onNotificationsClick={toggleNotif}
      menuOpen={menuOpen}
      onSignInClick={onSignInClick}
      onPassClick={onPassClick}
      onToastClick={() => openToast()}
      onTimeMachineClick={IS_DEMO_BUILD ? toggleTimeMachine : undefined}
      timeMachineOpen={timeOpen}
      notifications={heldCount ?? undefined}
      celebration={
        cel.celebration
          ? { celebration: cel.celebration, phase: cel.phase, reduced: cel.reduced, paused: cel.paused, guest: !user, onActivate: onActivateCelebration }
          : null
      }
      onCelebrationHold={cel.setHold}
      avatarGlow={cel.glow}
    />
  );
}
