/**
 * LiveShell (ІНВ 4.1, plan.md 3): спільний макет `(live)` зі сталим плеєром.
 * Макет не перемонтовується між сторінками групи, тож ОДИН `PlayerHost` живе весь сеанс:
 * сторінки ставлять `PlayerSlot`, хост сідає над ним (`position: fixed`), iframe ніколи не переноситься в DOM.
 * Один `<main>` на сторінку; прихований `<h1>` ставить сама сторінка.
 */
import type { ReactNode } from 'react';
import { PlayerHost } from '@/components/player/PlayerHost';
import { LiveAnnouncer } from '@/components/primitives/a11y/LiveAnnouncer';
import { SkipLinks } from '@/components/primitives/a11y/SkipLinks';
import { Footer } from '@/components/shell/Footer';
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
      <CoralProvider>
        <PlayerProvider>
          <LiveAnnouncer>
            <OverlayManager>
              {/* Подія ефіру й фаза підпису — раз на макет: ланцюжок плеєра на головній, EngineScheduler (події шини). */}
              <BroadcastController>
              <SkipLinks targets={['content', 'chat']} />
              {/* TODO: current — з маршруту, коли з’являться сторінки країн. */}
              <ShellHeader current="home" />
              <div className={styles.shell}>
                <main id="main" tabIndex={-1} className={styles.main}>
                  {/* Один хост на весь макет; стоїть першим у <main>, тож у порядку Tab плеєр іде перед вмістом сторінки. */}
                  <PlayerHost />
                  {children}
                </main>
                {/* TODO(US1/US4): ChatPanel; ChatSlotPanel (P18) порталиться в #chat-slot. TODO: тимчасово відкривати колонку, коли чат сховано. */}
                <aside id="chat" aria-label="Чат" className={styles.chat}>
                  {/* id = CHAT_SLOT_ID з Panel.tsx (константу з клієнтського модуля в серверний макет не імпортуємо). */}
                  <div id="chat-slot" className={styles.chatSlot} />
                </aside>
              </div>
              <Footer />
              </BroadcastController>
            </OverlayManager>
          </LiveAnnouncer>
        </PlayerProvider>
      </CoralProvider>
    </TimeProvider>
  );
}
