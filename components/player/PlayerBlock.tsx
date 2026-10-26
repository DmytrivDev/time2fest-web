'use client';

/**
 * C1. PlayerBlock — блок плеєра: режим `broadcast` (головна, ефір) і `remote` (сторінка країни, пульт).
 *
 * `remote`: сторінка сама не переходить за ефіром (FR-024) — плеєр показує те, що обрала людина (ланцюжок задає сторінка);
 * після півночі відео лишається, у підписі «Запис» і «північ була 40 хв тому», рядок 3 — `met-and-next`;
 * «Подивитися північ ще раз» — лише коли джерело дає повтор (`source.replay`); у рядку дій «Ще трансляції».
 *
 * Частини: `VideoArea` (= `PlayerSlot`: хост плеєра з макета сідає над ним; на місці відео — сцена відліку,
 * картка Facebook чи скелетон, ніколи не поверх) · `Caption` (3 рядки за фазою `captionPhase`) · `ActionRow` ·
 * `StatusSlot` («Перемкнули на іншу трансляцію з цього місця») · `ScheduleHint` (FR-014).
 * `InFlowSlot` ставить сторінка одразу після блоку.
 *
 * Повертає фрагмент: слот плеєра має бути прямою дитиною `<main>`, інакше `position: sticky` на телефоні
 * (плеєр закріплений угорі) обмежиться висотою блоку.
 *
 * Дані ефіру — з `useBroadcast()` (`BroadcastController` у макеті); стан відео — з `PlayerProvider`.
 * Без провайдерів (історії) область відео задається пропом `videoArea`.
 */
import { useTranslations } from 'next-intl';
import { useId } from 'react';
import { ActionRow } from '@/components/live/ActionRow';
import { Caption, eventTitle } from '@/components/live/Caption';
import styles from '@/components/live/live.module.css';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { getData } from '@/lib/data/load';
import type { CaptionPhase } from '@/lib/engine/captionPhase';
import type { AirView } from '@/lib/engine/currentAirEvent';
import type { AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { useGuestStore } from '@/stores/guest';
import { CountdownScene } from './CountdownScene';
import { FacebookConsentCard } from './FacebookConsentCard';
import { PlayerSlot } from './PlayerSlot';

export type VideoAreaKind = 'video' | 'loading' | 'countdown-scene' | 'expected-scene' | 'facebook-consent';

export interface ScheduleHintData {
  /** Місто з графіка гостя (називний відмінок). */
  place: string;
  href: string;
}

export interface PlayerBlockProps {
  mode: 'broadcast' | 'remote';
  /** Час відомий (після синхронізації); до того — скелетони. */
  ready: boolean;
  phase: CaptionPhase | null;
  current: AirPlace | null;
  next: AirPlace | null;
  /** Що каже ефір про подію (`currentAirEvent().view`): потрібне, коли ланцюжок вичерпано. */
  airView?: AirView;
  onStayHere?: () => void;
  scheduleHint?: ScheduleHintData | null;
  /** Перевизначення області відео (історії, тести без `PlayerProvider`). */
  videoArea?: VideoAreaKind;
  /** «Перемкнули на іншу трансляцію з цього місця» (історії); у застосунку — з `PlayerProvider.lastSwitch`. */
  switched?: boolean;
  /** Часовий пояс глядача (історії, тести). */
  timeZone?: string;
  /** id заголовка блоку (фокус повертається сюди після закриття вікон). */
  titleId?: string;
  /** Пульт: назва вибраної трансляції в рядку 2 («Париж · Ейфелева вежа»). */
  title?: string;
  /** Пульт: «Ще трансляції» / «Записи». */
  onMoreStreams?: () => void;
  /** Пульт: «Подивитися північ ще раз». */
  onWatchAgain?: () => void;
  className?: string;
}

function useVideoArea(props: Pick<PlayerBlockProps, 'ready' | 'videoArea' | 'airView'>): {
  kind: VideoAreaKind;
  muted: boolean;
  switched: boolean;
} {
  const player = useOptionalPlayer();
  if (props.videoArea) return { kind: props.videoArea, muted: player?.muted ?? true, switched: false };
  if (!props.ready || !player || !player.selection) return { kind: 'loading', muted: true, switched: false };
  const sel = player.selection;
  const switched = !!player.lastSwitch && player.lastSwitch.eventId === player.eventId && !player.lastSwitch.exhausted;
  if (sel.kind === 'source' && player.videoId) return { kind: 'video', muted: player.muted, switched };
  if (sel.kind === 'facebook-consent') return { kind: 'facebook-consent', muted: true, switched };
  return { kind: props.airView === 'expected-scene' ? 'expected-scene' : 'countdown-scene', muted: true, switched: false };
}

function VideoFallback({ kind, current }: { kind: VideoAreaKind; current: AirPlace | null }) {
  const setConsent = useGuestStore((s) => s.setConsent);
  if (kind === 'video') return null;
  if (kind === 'loading' || !current?.country) {
    return (
      <div data-video-area="loading" className="size-full">
        <Skeleton variant="player" className="size-full" />
      </div>
    );
  }
  if (kind === 'facebook-consent') {
    return (
      <div data-video-area="facebook-consent" className="size-full">
        <FacebookConsentCard onAllow={() => setConsent({ facebookVideo: true })} className="size-full" />
      </div>
    );
  }
  const zone = getData().zonesById.get(current.event.zoneId);
  return (
    <div data-video-area={kind} className="size-full">
      <CountdownScene
        country={current.country}
        cityName={eventTitle(current.city)}
        midnightMs={current.event.midnightMs}
        offsetMinutes={zone?.offsetMinutes ?? 0}
        variant={kind === 'expected-scene' ? 'expected' : 'no-stream'}
      />
    </div>
  );
}

export function PlayerBlock({
  mode,
  ready,
  phase,
  current,
  next,
  airView,
  onStayHere,
  scheduleHint,
  videoArea,
  switched: switchedProp,
  timeZone,
  titleId: titleIdProp,
  title,
  onMoreStreams,
  onWatchAgain,
  className,
}: PlayerBlockProps) {
  const t = useTranslations('player');
  const common = useTranslations('common');
  const autoId = useId();
  const titleId = titleIdProp ?? `${autoId}-title`;
  const actions = useOptionalPlayerActions();
  const area = useVideoArea({ ready, videoArea, airView });
  const switched = switchedProp ?? area.switched;
  const chain = current ? getData().chainsByEventId.get(current.event.id) : undefined;
  const verified = area.kind === 'video' && !!chain?.sources.some((s) => s.verified);

  return (
    <>
      <PlayerSlot id="main" fallback={<VideoFallback kind={area.kind} current={current} />} />
      <section
        aria-labelledby={current && phase ? titleId : undefined}
        aria-busy={current && phase ? undefined : true}
        data-player-block={mode}
        data-video-area-kind={area.kind}
        className={cn(styles.pad, 'flex flex-col gap-3 pb-4 pt-3', className)}
      >
        {current && phase ? (
          <>
            <Caption
              phase={phase}
              current={{ midnightMs: current.event.midnightMs, city: current.city, country: current.country, href: current.href }}
              next={next ? { midnightMs: next.event.midnightMs, city: next.city, country: next.country, href: next.href } : null}
              live={area.kind === 'video'}
              verified={verified}
              timeZone={timeZone}
              titleId={titleId}
              mode={mode}
              {...(title !== undefined ? { title } : {})}
            />
            <ActionRow
              mode={mode}
              button={phase.button}
              onMoreStreams={onMoreStreams}
              onWatchAgain={onWatchAgain}
              recordings={phase.row1Right.kind === 'ago'}
              href={current.href}
              onStayHere={onStayHere}
              sound={{
                muted: area.muted,
                available: area.kind === 'video',
                onUnmute: () => actions?.unmute(),
                onMute: () => actions?.mute(),
              }}
            />
          </>
        ) : (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton variant="line" className="w-1/3" />
            <Skeleton variant="line" className="w-2/3" />
            <Skeleton variant="line" className="w-1/2" />
          </div>
        )}
        {switched ? <StatusMessage kind="info">{t('switchedSource')}</StatusMessage> : null}
        {scheduleHint ? (
          <p data-schedule-hint="" className="flex flex-wrap items-center gap-x-2 text-body text-text-secondary">
            <span>{t('scheduleHint', { place: scheduleHint.place })}</span>
            <Link variant="chevron" href={scheduleHint.href}>
              {common('goTo')}
            </Link>
          </p>
        ) : null}
      </section>
    </>
  );
}
