/**
 * LiveShell (ІНВ 4.1, plan.md 3): спільний макет `(live)` зі сталим плеєром.
 * Макет не перемонтовується між сторінками групи, тож ОДИН `PlayerHost` живе весь сеанс:
 * сторінки ставлять `PlayerSlot`, хост сідає над ним (`position: absolute` у `.shell`; закріплений на телефоні й
 * лише телефонний закріплений плеєр — `fixed`), iframe ніколи не переноситься в DOM.
 * Один `<main>` на сторінку; прихований `<h1>` ставить сама сторінка.
 */
import type { ReactNode } from 'react';
import { TimeMachineMount } from '@/components/dev/TimeMachineMount';
import { PlayerHost } from '@/components/player/PlayerHost';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { CookieFooter, CookieLayer } from '@/components/offers/CookieLayer';
import { PassPaymentWatcher } from '@/components/pass/PassPaymentWatcher';
import { ScheduleToast } from '@/components/schedule/ScheduleToast';
import { TipsPaymentWatcher } from '@/components/tips/TipsPaymentWatcher';
import { OfflineNotice } from '@/components/shell/Offline';
import { OverlayManager } from '@/components/shell/OverlayManager';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { CoralProvider } from '@/lib/overlay/coral';
import { BroadcastController } from '@/lib/player/BroadcastController';
import { PlayerProvider } from '@/lib/player/PlayerProvider';
import { TimeProvider } from '@/lib/time/TimeProvider';
import styles from './live-shell.module.css';

export default function LiveLayout({ children }: { children: ReactNode }) {
  return <LiveShell>{children}</LiveShell>;
}

function LiveShell({ children }: { children: ReactNode }) {
  return (
    <TimeProvider>
      <TimeMachineMount />
      <CoralProvider>
        <PlayerProvider>
          <LiveAnnouncer>
            <OverlayManager>
              {/* Подія ефіру й фаза підпису — раз на макет: ланцюжок плеєра на головній, EngineScheduler (події шини). */}
              <BroadcastController>
              <SkipLinks targets={['content', 'chat']} />
              {/* Оплата пасу «чекає підтвердження» — підтверджується й при закритому вікні. */}
              <PassPaymentWatcher />
              {/* Чайові «чекають підтвердження» — так само. */}
              <TipsPaymentWatcher />
              {/* Згода на cookies: у DOM одразу після посилань-пропусків (кут/смуга; у потоці — на сторінці з плеєром). */}
              <CookieLayer />
              {/* «Додано в графік · Повернути» — знизу колонки, ховається над відео (рішення власника 2026-11-06). */}
              <ScheduleToast />
              {/* TODO: current — з маршруту, коли з’являться сторінки країн. */}
              <ShellHeader current="home" />
              {/* Немає мережі: одна смуга в потоці (не поверх відео); відлік іде далі, зникає сама. */}
              <OfflineNotice />
              {/* `.shell` — position: relative: PlayerHost стоїть у ньому абсолютно над слотом (прокрутка без JS). */}
              <div className={styles.shell}>
                <div className={styles.top}>
                  <main id="main" tabIndex={-1} className={styles.main}>
                    {/* Один хост на весь макет; стоїть першим у <main>, тож у порядку Tab плеєр іде перед вмістом сторінки. */}
                    <PlayerHost />
                    {children}
                  </main>
                  {/* ChatPanel порталиться в #chat-slot; ChatSlotPanel (P18) — теж. */}
                  <aside id="chat" aria-label="Чат" className={styles.chat}>
                    {/* id = CHAT_SLOT_ID з Panel.tsx (константу з клієнтського модуля в серверний макет не імпортуємо). */}
                    <div id="chat-slot" className={styles.chatSlot} />
                  </aside>
                </div>
                {/* Секції на всю ширину під обома колонками (мапа поясів на головній); id = WIDE_SLOT_ID (Panel.tsx). */}
                <div id="page-wide" className={styles.wide} />
              </div>
              <CookieFooter />
              </BroadcastController>
            </OverlayManager>
          </LiveAnnouncer>
        </PlayerProvider>
      </CoralProvider>
    </TimeProvider>
  );
}
