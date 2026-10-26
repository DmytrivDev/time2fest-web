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
import { CoralProvider } from '@/lib/overlay/coral';
import { PlayerProvider } from '@/lib/player/PlayerProvider';
import { TimeProvider } from '@/lib/time/TimeProvider';
import styles from './live-shell.module.css';

export default function LiveLayout({ children }: { children: ReactNode }) {
  return <LiveShell>{children}</LiveShell>;
}

function LiveShell({ children }: { children: ReactNode }) {
  return (
    <TimeProvider>
      {/* TODO(T044): OverlayManager (одне вікно за раз, розміщення Sheet / ChatSlotPanel / InFlowSlot) — поки лише CoralProvider. */}
      <CoralProvider>
        <PlayerProvider>
          <LiveAnnouncer>
            {/* TODO(T045): <EngineScheduler /> — перепади стану двигунів → події шини. */}
            {/* TODO(T063): <BroadcastController /> (lib/engine/BroadcastController.tsx) — подія ефіру й фаза підпису раз на макет; задає ланцюжок плеєра через usePlayerActions().setChain. */}
            <SkipLinks targets={['content', 'chat']} />
            {/* TODO(T064): <Header /> */}
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
            {/* TODO(T064): <Footer /> */}
          </LiveAnnouncer>
        </PlayerProvider>
      </CoralProvider>
    </TimeProvider>
  );
}
