'use client';

/**
 * C1. PlayerBlock — блок плеєра: режим `broadcast` (головна, ефір) і `remote` (сторінка країни, пульт).
 *
 * `remote`: сторінка сама не переходить за ефіром (FR-024) — плеєр показує те, що обрала людина (ланцюжок задає сторінка);
 * після півночі відео лишається, у підписі «Запис» і «північ була 40 хв тому», рядок 3 — `met-and-next`;
 * «Подивитися північ ще раз» — лише коли джерело дає повтор (`source.replay`); у рядку дій «Обрати трансляцію» (як на головній).
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
 *
 * Головне святкування (рішення власника 2026-11-13): поки не почалось — заглушка «Трансляція очікується» (час і відлік —
 * лише коли початок відомий) з кнопкою «Дивитися, що вже йде ↓» (`onWatchLive`), якщо в поясі щось іде наживо. Назва під
 * плеєром — завжди тієї трансляції, що грає (чи на яку чекає заглушка), з її прапором. Людина сама обрала іншу трансляцію
 * поясу, а головне почалось — у тому самому рядку, що й підказка про штамп, «Головне святкування почалось · Перемкнути»
 * (`mainLive`): без нового рядка, висота рядка та сама.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useId, type ReactNode } from 'react';
import { useShareStream } from '@/components/live/useShareStream';
import { ActionRow, type CountdownModeControl, type RemoteStreams } from '@/components/live/ActionRow';
import { Caption, eventTitle } from '@/components/live/Caption';
import home from '@/components/live/home.module.css';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Link } from '@/components/primitives/Link';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { useHasStamp } from '@/lib/api/hooks/passport';
import { useStreamChain, useStreamChains } from '@/lib/api/hooks/live';
import { getData } from '@/lib/data/load';
import type { ScheduledEvent, StreamSource } from '@/lib/data/types';
import type { CaptionPhase } from '@time2fest/rules/time';
import type { AirView } from '@/lib/engine/currentAirEvent';
import { countryHref } from '@/lib/live/countryHref';
import type { AirPlace } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { stampHintActive } from '@/lib/stamp/stampCelebration';
import { useGuestStore } from '@/stores/guest';
import { useCoralWindowOpen } from '@/lib/overlay/coral';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { disableSceneSound, enableSceneSound, useSceneSound } from '@/lib/scene/sceneAudio';
import { CountdownScene } from './CountdownScene';
import { FacebookConsentCard } from './FacebookConsentCard';
import { PlayerSlot } from './PlayerSlot';

export type VideoAreaKind = 'video' | 'loading' | 'countdown-scene' | 'expected-scene' | 'facebook-consent' | 'waiting';

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
  /** Пульт: трансляції країни й поясу для «Обрати трансляцію». */
  streams?: RemoteStreams;
  /** Календарик у «Обрати трансляцію» — «Додати в графік». */
  onToggleSchedule?: (eventId: string) => void;
  /** Пульт: перемикач «Відео | Відлік» (без нього перемикача немає — країна без трансляцій). */
  countdownMode?: CountdownModeControl;
  /** Пульт: «Подивитися північ ще раз». */
  onWatchAgain?: () => void;
  /** «Зараз дивляться люди з N країн» у рядку 1 підпису (від 768 px). */
  watchers?: number;
  /**
   * Сторінка нараховує штамп за подію плеєра (ефір, сторінка країни): останні 60 с до півночі — підказка «Будь тут
   * опівночі — отримаєш штамп: …» (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header`, 2026-11-12), якщо штампа ще немає.
   */
  stampHint?: boolean;
  /** Праворуч від таймера (від 768 px): «Показати чат», коли чат сховано (`Desk-Cookies-Wide`). */
  captionAside?: ReactNode;
  /** Телефон, вкладка «Чат» (`Phone-Chat`): підпис одним рядком зі звуком, без рядка дій. */
  bar?: boolean;
  /**
   * Телефон, головна (`Phone-Chat-Dock`): під закріпленим плеєром — липкий рядок «Лондон · до півночі 00:22:15 · Наживо»
   * зі звуком, далі `belowBar`, далі блок назви без таймера й без кнопки звуку.
   */
  dock?: boolean;
  /**
   * Телефон (`dock`): смуга одразу під липким рядком часу. Тут жила смуга «Перший ряд» (прибрано 2026-11-12); сюди ж
   * стане смуга тостів (`TOAST-STRIP-SLOT`). Поки сторінки нічого не передають.
   */
  belowBar?: ReactNode;
  /** Заглушка головного святкування: «Дивитися, що вже йде ↓» — у поясі зараз щось іде наживо (2026-11-13). */
  onWatchLive?: () => void;
  /** «Головне святкування почалось · Перемкнути» (2026-11-13): місто головного святкування й перемикання на нього. */
  mainLive?: { place: string; onSwitch(): void } | null;
  className?: string;
}

function useVideoArea(props: Pick<PlayerBlockProps, 'ready' | 'videoArea' | 'airView'>): {
  kind: VideoAreaKind;
  muted: boolean;
  switched: boolean;
  /** `waiting`: трансляція, на яку чекаємо (назва й початок; `null` — початок невідомий). */
  waiting?: { title: string; startsAt: number | null };
} {
  const player = useOptionalPlayer();
  const chains = useStreamChains();
  if (props.videoArea) return { kind: props.videoArea, muted: player?.muted ?? true, switched: false };
  if (!props.ready || !player || !player.selection) return { kind: 'loading', muted: true, switched: false };
  const sel = player.selection;
  const switched = !!player.lastSwitch && player.lastSwitch.eventId === player.eventId && !player.lastSwitch.exhausted;
  if (sel.kind === 'source' && player.videoId) return { kind: 'video', muted: player.muted, switched };
  if (sel.kind === 'facebook-consent') return { kind: 'facebook-consent', muted: true, switched };
  if (sel.kind === 'waiting') {
    const src = chains.get(player.eventId ?? '')?.sources.find((s) => s.id === sel.source.id);
    return {
      kind: 'waiting',
      muted: true,
      switched: false,
      waiting: { title: src?.title.uk ?? '', startsAt: Date.parse(sel.source.startsAt ?? '') || null },
    };
  }
  return { kind: props.airView === 'expected-scene' ? 'expected-scene' : 'countdown-scene', muted: true, switched: false };
}

function VideoFallback({
  kind,
  current,
  countdownMode = false,
  waiting,
  onWatchLive,
}: {
  kind: VideoAreaKind;
  current: AirPlace | null;
  countdownMode?: boolean;
  waiting?: { title: string; startsAt: number | null };
  onWatchLive?: () => void;
}) {
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
        variant={kind === 'waiting' ? 'waiting' : countdownMode ? 'mode' : kind === 'expected-scene' ? 'expected' : 'no-stream'}
        {...(kind === 'waiting' && waiting ? { waitingFor: waiting, onWatchLive } : {})}
      />
    </div>
  );
}

/**
 * Що справді грає в плеєрі (чи на що чекає заглушка): подія й джерело. Підпис під плеєром описує саме це (2026-11-13:
 * після вибору іншої трансляції поясу назва лишалась «Париж · Ейфелева вежа»).
 */
function usePlaying(): { event: ScheduledEvent; source: StreamSource } | null {
  const player = useOptionalPlayer();
  const chains = useStreamChains();
  const sel = player?.selection;
  if (!player?.eventId || !sel || sel.kind === 'countdown-scene') return null;
  const data = getData();
  const event = data.eventsById.get(player.eventId);
  const source = chains.get(player.eventId)?.sources.find((s) => s.id === sel.source.id);
  return event && source ? { event, source } : null;
}

/** Звук у рядку `Phone-Chat`: ціль 44, видимий квадрат 36, коралова, поки звук вимкнено. */
function BarSound({ muted, available, onUnmute, onMute }: { muted: boolean; available: boolean; onUnmute(): void; onMute(): void }) {
  const t = useTranslations('player');
  const foreignCoral = useCoralWindowOpen();
  const on = available && !muted;
  const variant = !available || on ? 'secondary' : foreignCoral ? 'neutral' : 'coral';
  return (
    <button
      type="button"
      data-variant={variant}
      disabled={!available}
      aria-label={!available ? t('soundUnavailable') : on ? t('soundIsOn') : t('soundOn')}
      data-sound={!available ? 'unavailable' : on ? 'on' : 'off'}
      onClick={() => (on ? onMute() : onUnmute())}
      className={cn('t2f-focus t2f-press rounded-md', home.barSound)}
    >
      <span aria-hidden="true" className={home.barSoundInner}>
        <Icon name={on ? 'speaker' : 'speaker-off'} size={18} strokeWidth={2} />
      </span>
    </button>
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
  streams,
  countdownMode,
  onToggleSchedule,
  onWatchAgain,
  watchers,
  stampHint = false,
  captionAside,
  bar = false,
  dock = false,
  belowBar,
  onWatchLive,
  mainLive,
  className,
}: PlayerBlockProps) {
  const t = useTranslations('player');
  const common = useTranslations('common');
  const autoId = useId();
  const titleId = titleIdProp ?? `${autoId}-title`;
  const actions = useOptionalPlayerActions();
  const area = useVideoArea({ ready, videoArea, airView });
  const switched = switchedProp ?? area.switched;
  const chain = useStreamChain(current?.event.id);
  const verified = area.kind === 'video' && !!chain?.sources.some((s) => s.verified);

  // Ефір (головна): підпис — тієї трансляції, що грає (її місто, прапор і назва), якщо вона тієї самої півночі.
  const playing = usePlaying();
  const playingHere = mode === 'broadcast' && !!playing && !!current && playing.event.midnightMs === current.event.midnightMs;
  const shown = playingHere && playing.event.id !== current?.event.id ? playing.event : null;
  const shownCountry = shown ? getData().countriesByIso.get(shown.countryIso) : undefined;
  // Зсув пояса — для року, що настав опівночі (підпис після півночі: «Новий рік 2027»).
  const offsetOf = (zoneId: string) => getData().zonesById.get(zoneId)?.offsetMinutes;
  const place = current
    ? shown
      ? {
          midnightMs: shown.midnightMs,
          city: getData().citiesById.get(shown.cityId),
          country: shownCountry,
          href: shownCountry ? countryHref(shownCountry, { eventId: shown.id }) : null,
          offsetMinutes: offsetOf(shown.zoneId),
        }
      : { midnightMs: current.event.midnightMs, city: current.city, country: current.country, href: current.href, offsetMinutes: offsetOf(current.event.zoneId) }
    : null;
  const captionTitle = title ?? (playingHere ? playing.source.title.uk : undefined);
  const nextPlace = next ? { midnightMs: next.event.midnightMs, city: next.city, country: next.country, href: next.href } : null;
  // Без відео (сцена відліку) кнопка звуку керує звуком сцени: куранти й салют опівночі (власник 2026-11-11).
  const sceneSoundOn = useSceneSound();
  const scene = area.kind === 'countdown-scene' || area.kind === 'expected-scene';
  const sound = scene
    ? { muted: !sceneSoundOn, available: true, onUnmute: enableSceneSound, onMute: disableSceneSound }
    : { muted: area.muted, available: area.kind === 'video', onUnmute: () => actions?.unmute(), onMute: () => actions?.mute() };
  const barSound = <BarSound {...sound} />;
  // «Поділитися» — іконка в підписі (п. 16): те саме вікно, що в «⋯»; адреса — сторінка країни поточної події.
  const share = useShareStream({ href: current?.href ?? null, place: mode === 'remote' ? (title ?? '') : (current?.city?.name.uk ?? '') });
  // Підказка про штамп — остання хвилина відліку до півночі події плеєра, поки штампа за неї немає.
  const stamped = useHasStamp(current?.event.id);
  const r1 = phase?.row1Right;
  const hintCountry =
    stampHint && current?.country && r1?.kind === 'countdown' && stampHintActive(r1.ms, stamped) ? current.country.name.uk : null;
  // «Головне святкування почалось · Перемкнути»: в останні 60 с до півночі рядок належить підказці про штамп.
  const notice = mainLive && !hintCountry ? mainLive : null;
  const announce = useAnnounce();
  const noticePlace = notice ? notice.place : null;
  useEffect(() => {
    if (noticePlace !== null) announce(t('mainLiveAnnounce', { place: noticePlace }));
  }, [noticePlace, announce, t]);

  return (
    <>
      <PlayerSlot
        id="main"
        fallback={<VideoFallback kind={area.kind} current={current} countdownMode={!!countdownMode?.countdown} waiting={area.waiting} onWatchLive={onWatchLive} />}
      />
      {dock ? (
        <section aria-label={t('barLabel')} data-player-bar="" data-dock-above="" className={home.stickyBar}>
          {place && phase ? (
            <Caption
              phase={phase}
              current={place}
              next={nextPlace}
              live={area.kind === 'video'}
              timeZone={timeZone}
              mode={mode}
              variant="bar"
              lead={barSound}
              watchers={watchers}
              stampHint={hintCountry}
              notice={notice}
              srRow3={false}
              {...(captionTitle !== undefined ? { title: captionTitle } : {})}
            />
          ) : (
            <div className={home.bar} aria-hidden="true">
              <Skeleton variant="line" className="w-2/3" />
            </div>
          )}
        </section>
      ) : null}
      {dock ? belowBar : null}
      <section
        aria-labelledby={current && phase ? titleId : undefined}
        aria-busy={current && phase ? undefined : true}
        data-player-block={mode}
        data-video-area-kind={area.kind}
        {...(bar ? { 'data-dock-above': '' } : {})}
        className={cn(bar && !dock ? undefined : home.block, className)}
      >
        {current && phase ? (
          <>
            <Caption
              phase={phase}
              current={place ?? { midnightMs: current.event.midnightMs, city: current.city, country: current.country, href: current.href }}
              next={next ? { midnightMs: next.event.midnightMs, city: next.city, country: next.country, href: next.href } : null}
              live={area.kind === 'video'}
              verified={verified}
              timeZone={timeZone}
              titleId={titleId}
              mode={mode}
              watchers={watchers}
              stampHint={hintCountry}
              notice={notice}
              aside={captionAside}
              onShare={bar ? undefined : share}
              shareInTitle={mode === 'remote'}
              variant={dock ? 'title' : bar ? 'bar' : 'full'}
              lead={
                bar ? <BarSound {...sound} /> : null
              }
              {...(captionTitle !== undefined ? { title: captionTitle } : {})}
            />
            {bar ? null : (
            <ActionRow
              hideSound={dock}
              mode={mode}
              button={phase.button}
              streams={streams}
              countdownMode={countdownMode}
              onToggleSchedule={onToggleSchedule}
              sharePlace={title}
              onWatchAgain={onWatchAgain}
              href={current.href}
              onStayHere={onStayHere}
              sound={sound}
            />
            )}
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
