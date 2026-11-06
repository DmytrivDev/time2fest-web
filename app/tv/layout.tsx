/**
 * TvShell (S-TV, ІНВ 4.1): макет режиму вечірки `/tv`. Окремий від `(live)`, тож перехід у `/tv` перемонтовує плеєр
 * (дозволено): без хедера, футера й чату. ТІ САМІ `TimeProvider`, `PlayerProvider` і `BroadcastController`
 * (він же монтує `EngineScheduler`), що в `app/(live)/layout.tsx`: ТВ показує той самий ефір, що головна.
 * ОДИН `PlayerHost` на макет: сторінка ставить `PlayerSlot`, хост сідає над ним (`position: fixed`).
 * `data-surface="tv"` (контур фокуса 4 px, primitives.css) ставить сам екран вечірки (`TvScreen`): на телефоні `/tv` —
 * звичайна інформаційна сторінка сайту.
 */
import type { ReactNode } from 'react';
import { PlayerHost } from '@/components/player/PlayerHost';
import { BroadcastController } from '@/lib/player/BroadcastController';
import { PlayerProvider } from '@/lib/player/PlayerProvider';
import { TimeProvider } from '@/lib/time/TimeProvider';
import './tv-focus.css';

export default function TvLayout({ children }: { children: ReactNode }) {
  return <TvShell>{children}</TvShell>;
}

function TvShell({ children }: { children: ReactNode }) {
  return (
    <TimeProvider>
      <PlayerProvider>
        <BroadcastController>
          <div className="bg-background text-text">
            <PlayerHost />
            {children}
          </div>
        </BroadcastController>
      </PlayerProvider>
    </TimeProvider>
  );
}
