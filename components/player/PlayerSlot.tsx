'use client';

/**
 * PlayerSlot — порожнє місце потрібних розмірів (16:9, не менше 200×200 px) у потоці сторінки.
 * Плеєр не рендериться тут: `PlayerHost` з макета сідає над слотом (ІНВ 4.1).
 * `fallback` (сцена відліку, картка Facebook, скелетон) стоїть **на місці** плеєра, коли хост схований —
 * ніколи не поверх відео.
 */
import { useCallback, type ReactNode } from 'react';
import { useOptionalPlayer, useOptionalPlayerInternals } from '@/lib/player/PlayerProvider';
import type { PlayerSlotId } from '@/lib/player/types';

export interface PlayerSlotProps {
  id?: PlayerSlotId;
  /** Вміст на місці плеєра, поки хост не показує відео. */
  fallback?: ReactNode;
  className?: string;
}

export function PlayerSlot({ id = 'main', fallback, className }: PlayerSlotProps) {
  const internals = useOptionalPlayerInternals();
  const registerSlot = internals?.registerSlot;
  const videoId = useOptionalPlayer()?.videoId ?? null;
  const ref = useCallback((el: HTMLDivElement) => registerSlot?.(id, el), [id, registerSlot]);
  const showsVideo = id === 'main' && videoId !== null;

  return (
    <div
      ref={ref}
      data-player-slot={id}
      data-player-state={showsVideo ? 'video' : 'fallback'}
      className={[
        'relative aspect-video w-full min-h-player-min-height min-w-player-min-height overflow-hidden bg-surface',
        className ?? '',
      ].join(' ')}
    >
      {showsVideo ? null : fallback}
    </div>
  );
}
