'use client';

/**
 * TvScreen (S-TV, C22): склад сторінки `/tv` — ліворуч великий плеєр (≥ 70% ширини) і таймлайн свята,
 * праворуч `TvSidebar`. Хедера, футера й чату немає; на відео нічого немає.
 *
 * Дані ефіру — з `useBroadcast()` (один `BroadcastController` у макеті `app/tv/layout.tsx`): ТВ показує те саме,
 * що головна, і сам переходить до наступної події. Плеєр — один `PlayerHost` макета над `PlayerSlot` цієї сторінки.
 * Сторінка реєструє присутність для штампа (`useStampGrant`, джерело `tv`): штамп з’являється в колонці сам.
 * Керування: стрілки, OK (Enter), «Назад»/Esc — вихід на головну (`useRemoteKeys`).
 */
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useRef, useState } from 'react';
import { eventTitle } from '@/components/live/Caption';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import { getData } from '@/lib/data/load';
import { festProgress } from '@/lib/live/homeData';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow } from '@/lib/time/TimeProvider';
import { remainingFest, tvEvents } from '@/lib/tv/tvData';
import { useRemoteKeys } from '@/lib/tv/useRemoteKeys';
import { useGuestStore } from '@/stores/guest';
import { TvKeyHints } from './TvKeyHints';
import { TvScene } from './TvScene';
import { TvSidebar } from './TvSidebar';
import { TvTimeline } from './TvTimeline';
import styles from './tv.module.css';

/** Що стоїть на місці плеєра, поки хост не показує відео. */
function PlayerFallback({ ready, current, view }: { ready: boolean; current: AirPlace | null; view: string | undefined }) {
  const setConsent = useGuestStore((s) => s.setConsent);
  const player = useOptionalPlayer();
  if (!ready || !current?.country) return <Skeleton variant="player" className="size-full" />;
  if (player?.selection?.kind === 'facebook-consent') {
    return <FacebookConsentCard onAllow={() => setConsent({ facebookVideo: true })} className="size-full" />;
  }
  return (
    <TvScene
      country={current.country}
      cityName={eventTitle(current.city)}
      midnightMs={current.event.midnightMs}
      variant={view === 'expected-scene' ? 'expected' : 'no-stream'}
    />
  );
}

export interface TvScreenProps {
  /** Примусово задати стан мережі й повного екрана (історії). */
  online?: boolean;
  fullscreen?: boolean;
}

export function TvScreen({ online, fullscreen }: TvScreenProps = {}) {
  const t = useTranslations('tv');
  const router = useRouter();
  const { ready, current, air } = useBroadcast();
  const now = useNow();
  const schedule = useGuestStore((s) => s.schedule);
  const rootRef = useRef<HTMLDivElement>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);

  // Присутність для штампа: ТВ показує подію поточного слота ефіру.
  const eventId = current?.event.id ?? null;
  useStampGrant(eventId ? { source: 'tv', eventIds: [eventId] } : null);

  const exit = useCallback(() => router.push('/'), [router]);
  const back = useCallback(() => {
    if (!timelineOpen) return false;
    setTimelineOpen(false);
    return true;
  }, [timelineOpen]);
  useRemoteKeys({ rootRef, onExit: exit, onBack: back, ready });

  const data = getData();
  const minute = Math.floor(now / 60_000) * 60_000;
  const events = useMemo(() => tvEvents(data, minute, schedule), [data, minute, schedule]);
  const fest = useMemo(() => festProgress(data, minute), [data, minute]);
  const rest = useMemo(() => remainingFest(data, minute), [data, minute]);

  const city = current?.city?.name.uk;
  const stream = air?.view === 'stream';
  const heading = !city ? t('pageHeadingNone') : stream ? t('pageHeading', { place: city }) : t('pageHeadingScene', { place: city });

  return (
    <div ref={rootRef} className={cn(styles.root)} data-tv-root="">
      <main id="main" tabIndex={-1} className={cn(styles.left, 'outline-none')}>
        <h1 className="sr-only">{heading}</h1>
        <div className={styles.playerArea}>
          <PlayerSlot id="main" className="h-full" fallback={<PlayerFallback ready={ready} current={current} view={air?.view} />} />
        </div>
        <div className={styles.lower}>
          <TvTimeline
            items={events}
            currentEventId={eventId}
            open={timelineOpen}
            onOpenChange={setTimelineOpen}
            zonesDone={fest.zonesDone}
            zonesTotal={fest.zonesTotal}
            remainingZones={rest.zones}
            endMs={rest.endMs}
            hints={<TvKeyHints />}
          />
        </div>
      </main>
      <TvSidebar online={online} fullscreen={fullscreen} />
    </div>
  );
}
