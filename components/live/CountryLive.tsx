'use client';

/**
 * Сторінка країни, пульт (S-COUNTRY, ІНВ 4.3; T092).
 *
 * Каркас — як на головній (рішення 2026-11-05, `as-built-home-countries-2026-11-05.md`):
 * Телефон (зверху вниз): відео · липкий рядок «місто · відлік» зі звуком · смуга «Перший ряд» (`dockBar`) · назва й рядок дій
 * («Обрати трансляцію ›», «⋯») · штамп, пропозиції, вікна моменту · CountryHeader (крихти, графік) · «Дивляться люди з N
 * країн» · «Міста й трансляції», «Трансляції в цьому поясі» (після півночі — «Зараз і далі»), «Як святкувати», «Питання й
 * відповіді». Чат «Країна» / «Світ» — закріплене вікно внизу (`ChatDock`).
 * Десктоп: CountryHeader · PlayerBlock (рядок дій: «Обрати трансляцію ›», кімната, вечірка, «⋯») · штамп, пропозиції,
 * вікна моменту · «Перший ряд» · ті самі блоки; права колонка макета — чат (sticky); сховано — «Показати чат» біля таймера.
 *
 * Плеєр: сторінка сама НЕ переходить за ефіром (FR-024). Ланцюжок задається лише двічі: один раз після відкриття
 * (якщо вже грає подія цієї країни — після «Лишитися тут ›» — нічого не чіпаємо, відео не перезапускається) і на дію
 * людини (дотик до рядка трансляції, чип поясу, «Подивитися північ ще раз»). Час ланцюжок не змінює.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { CountryHeader } from '@/components/live/CountryHeader';
import { Faq, type FaqItem } from '@/components/live/Faq';
import { HowToCard } from '@/components/live/HowToCard';
import { NowNext } from '@/components/live/NowNext';
import { StreamList, ZoneStreamsBlock } from '@/components/live/StreamList';
import { StampBlock } from '@/components/live/StampBlock';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useAddToRoom } from '@/components/room/useRoomViewport';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { OverlayInFlowOutlet, useChatColumn } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, LoadedZone, Ms, RoomId, ScheduledEvent } from '@/lib/data/types';
import { captionPhase } from '@/lib/engine/captionPhase';
import { STAMP_DELAY } from '@/lib/engine/config';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { eventStatus } from '@/lib/engine/eventStatus';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { formatClock, viewerZoneLabel } from '@/lib/i18n/time';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { simulatedViewers } from '@/lib/presence/viewers';
import { festProgress, nowNextItems } from '@/lib/live/homeData';
import {
  countryMainEvent,
  countryStreamRows,
  countryZones,
  defaultZoneId,
  zoneStreamRows,
  type StreamRowData,
} from '@/lib/live/countryData';
import { countryHref, type AirPlace } from '@/lib/player/BroadcastController';
import {
  useOptionalPlayer,
  useOptionalPlayerActions,
  type PlayerChainInput,
} from '@/lib/player/PlayerProvider';
import type { PlayerSource } from '@/lib/player/types';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { eventTitle } from './Caption';
import home from './home.module.css';
import styles from './live.module.css';
import { FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { firstRowEventForCountry } from '@/lib/firstrow/pick';

const PLAYER_TITLE_ID = 'player-title';
const STREAMS_ID = 'country-streams';

function placeOf(data: Dataset, event: ScheduledEvent | undefined | null): AirPlace | null {
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  return {
    event,
    city: data.citiesById.get(event.cityId),
    country,
    href: country ? countryHref(country) : null,
  };
}

function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  return preferredSourceId ? { eventId, sources, preferredSourceId } : { eventId, sources };
}

/** Наступна подія розкладу після півночі `event` (для «· далі: …» у пульті): подія наступного слота ефіру. */
function nextAfter(data: Dataset, event: ScheduledEvent, now: Ms): ScheduledEvent | null {
  const slot = airSlots(data).find((s) => s.midnightMs > event.midnightMs);
  return slot
    ? (pickSlotEvent(now, slot.events, data.countriesByIso, data.chainsByEventId)?.event ?? null)
    : null;
}

/** «UTC+3», «UTC−3:30». */
function utcLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return offsetMinutes === 0
    ? 'UTC+0'
    : `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function zoneChip(data: Dataset, iso: string, zone: LoadedZone): { id: string; label: string } {
  const city = data.citiesById.get(countryMainEvent(data, iso, zone.id)?.cityId ?? '');
  return {
    id: zone.id,
    label: city
      ? `${utcLabel(zone.offsetMinutes)} · ${city.name.uk}`
      : utcLabel(zone.offsetMinutes),
  };
}

export function CountryLive({ iso }: { iso: string }) {
  const tc = useTranslations('country');
  const tChat = useTranslations('chat');
  const tPlayer = useTranslations('player');
  const data = getData();
  const country = data.countriesByIso.get(iso)!;
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const chatColumn = useChatColumn();
  const ready = useTimeReady();
  const now = useNow();
  const known = ready && now > 0;
  const minute = Math.floor(now / 60_000) * 60_000;

  const zones = useMemo(() => countryZones(data, country), [data, country]);
  // Прийшли з ефіру («Лишитися тут ›»), а плеєр уже грає подію цієї країни — її пояс і лишаємо.
  const adopted = player?.eventId ? data.eventsById.get(player.eventId) : undefined;
  const [zoneId, setZoneId] = useState<string | null>(() =>
    adopted && adopted.countryIso === iso ? adopted.zoneId : defaultZoneId(data, country),
  );
  const mainEvent = zoneId ? countryMainEvent(data, iso, zoneId) : undefined;

  // Подія, яку людина сама обрала в «Трансляціях у цьому поясі» (інша країна з тією самою північчю).
  const [pickedEventId, setPickedEventId] = useState<string | null>(null);
  const playing = player?.eventId ? data.eventsById.get(player.eventId) : undefined;
  const playingOurs = !!playing && (playing.countryIso === iso || playing.id === pickedEventId);

  // Один раз після того, як час відомий: задати ланцюжок, якщо плеєр не грає подію цієї країни. Далі — лише дії людини.
  const initRef = useRef(false);
  useEffect(() => {
    if (!known || !actions || initRef.current) return;
    initRef.current = true;
    if (playing && playing.countryIso === iso && player?.selection) return;
    if (mainEvent) actions.setChain(chainInput(data, mainEvent.id));
  }, [known, actions, playing, iso, player, mainEvent, data]);

  const shownEvent: ScheduledEvent | undefined = playingOurs ? playing : mainEvent;
  const current = placeOf(data, shownEvent);
  const selection = player?.selection ?? null;
  const currentSource =
    selection && selection.kind !== 'countdown-scene' && player?.eventId === shownEvent?.id
      ? data.chainsByEventId
          .get(shownEvent?.id ?? '')
          ?.sources.find((s) => s.id === selection.source.id)
      : undefined;
  const currentStreamId = currentSource?.id ?? null;

  const next = useMemo(
    () => (shownEvent ? placeOf(data, nextAfter(data, shownEvent, minute)) : null),
    [data, shownEvent, minute],
  );
  const phase =
    known && shownEvent
      ? captionPhase(now, shownEvent, 'remote', next?.event ?? null, {
          hasReplay: !!currentSource?.replay,
        })
      : null;
  const expected = useMemo(
    () =>
      shownEvent
        ? (data.chainsByEventId.get(shownEvent.id)?.sources ?? []).some(
            (s) => sourceStatus(s, minute) === 'expected',
          )
        : false,
    [data, shownEvent, minute],
  );

  // Присутність для штампа: головна подія вибраного поясу й подія, що грає (FR-060, `presenceSource: 'country'`).
  const presenceIds = useMemo(
    () => [...new Set([mainEvent?.id, shownEvent?.id].filter((x): x is string => !!x))],
    [mainEvent, shownEvent],
  );
  useStampGrant(presenceIds.length ? { source: 'country', eventIds: presenceIds } : null);
  useChatSimulator(useMemo(() => ['world', `country:${iso}`] as RoomId[], [iso]));
  useMomentWindows();
  // Пропозиції пасу й чайових (offer:show) і стан введення для рушія пропозицій.
  const passWindows = useOfferWindows();
  const hasPass = useGuestStore((s) => s.hasPass);
  const getPass = useGetPass();

  const countryRows = useMemo(
    () => (zoneId ? countryStreamRows(data, iso, zoneId, minute) : []),
    [data, iso, zoneId, minute],
  );
  const zoneRows = useMemo(
    () => (zoneId ? zoneStreamRows(data, zoneId, iso, minute) : []),
    [data, iso, zoneId, minute],
  );
  const recording = !!shownEvent && known && eventStatus(now, shownEvent) === 'recording';
  const after = !!mainEvent && known && now >= mainEvent.midnightMs + STAMP_DELAY;

  const select = useCallback(
    (row: StreamRowData) => {
      setPickedEventId(row.eventId);
      actions?.setChain(chainInput(data, row.eventId, row.id));
    },
    [actions, data],
  );
  const changeZone = useCallback(
    (id: string) => {
      setZoneId(id);
      const ev = countryMainEvent(data, iso, id);
      if (ev) actions?.setChain(chainInput(data, ev.id));
    },
    [actions, data, iso],
  );
  const addRoom = useAddToRoom();
  // «+»: трансляція йде в кімнату (`stores/room`), головне вікно — те, що грає зараз; далі відкривається кімната (US3).
  const addToRoom = useCallback(
    (row: StreamRowData) =>
      addRoom(
        { sourceId: row.id, eventId: row.eventId },
        currentSource && shownEvent ? { sourceId: currentSource.id, eventId: shownEvent.id } : null,
      ),
    [addRoom, currentSource, shownEvent],
  );

  const watchAgain = useCallback(() => {
    const replay = currentSource?.replay;
    if (!replay || !shownEvent) return;
    if (!replay.videoId) {
      window.open(replay.url, '_blank', 'noopener');
      return;
    }
    const src: PlayerSource = {
      id: `${currentSource.id}:replay`,
      platform: 'youtube',
      videoId: replay.videoId,
      url: replay.url,
      order: 0,
      status: 'live',
      embeddable: true,
      isLive: true,
      alwaysOn: true,
    };
    actions?.setChain({ eventId: shownEvent.id, sources: [src] });
  }, [actions, currentSource, shownEvent]);

  // «Обрати трансляцію ›» (як на головній): трансляції країни, далі решта поясу — у будь-якому стані.
  const pickerRows = useMemo(() => [...countryRows, ...zoneRows], [countryRows, zoneRows]);
  const streams = useMemo(
    () => ({
      rows: pickerRows,
      countryIso: iso,
      midnightMs: mainEvent?.midnightMs ?? 0,
      onPick: select,
    }),
    [pickerRows, iso, mainEvent, select],
  );

  // Графік: запис «країна + пояс» (той самий, що в календариків головної); без пасу — вікно пасу.
  const scheduleIds = useMemo(
    () => (mainEvent ? countryZoneEvents(mainEvent.id) : []),
    [mainEvent],
  );
  const inSchedule = useGuestStore((g) => scheduleIds.some((id) => g.schedule.includes(id)));
  const toggleSchedule = useCallback(() => {
    if (mainEvent) passWindows.requestSchedule(mainEvent.id);
  }, [mainEvent, passWindows]);
  const viewers = useMemo(() => simulatedViewers(data), [data]);

  const faqItems: FaqItem[] = (['when', 'stamp', 'switch', 'room'] as const).map((id) => ({
    id,
    question: tc(`faq.items.${id}.q`),
    answer: tc(`faq.items.${id}.a`, { time: mainEvent ? formatClock(mainEvent.midnightMs) : '' }),
  }));

  const schedule = useGuestStore((s) => s.schedule);
  const nowNext = useMemo(
    () => (recording ? nowNextItems(data, minute, schedule) : []),
    [recording, data, minute, schedule],
  );
  const progress = useMemo(() => festProgress(data, minute), [data, minute]);
  const zoneLabel = viewerZoneLabel();

  const header = mainEvent ? (
    <CountryHeader
      country={country}
      midnightMs={mainEvent.midnightMs}
      after={after}
      zones={zones.length > 1 ? zones.map((z) => zoneChip(data, iso, z)) : undefined}
      selectedZoneId={zoneId ?? undefined}
      onZoneChange={changeZone}
      inSchedule={inSchedule}
      onToggleSchedule={toggleSchedule}
      className={cn(styles.pad, chatColumn ? 'pb-4' : 'pt-2')}
    />
  ) : null;

  const events = (
    <div className="flex flex-col gap-8 pb-8">
      <div id={STREAMS_ID} className={cn(styles.pad, 'flex scroll-mt-4 flex-col gap-6')}>
        <StreamList
          countryName={country.name.uk}
          streams={countryRows}
          currentStreamId={currentStreamId}
          onSelect={select}
          onAddToRoom={addToRoom}
        />
        {recording ? null : (
          <ZoneStreamsBlock
            streams={zoneRows}
            currentStreamId={currentStreamId}
            midnightMs={mainEvent?.midnightMs ?? 0}
            onSelect={select}
            onAddToRoom={addToRoom}
          />
        )}
      </div>
      {recording ? (
        <NowNext
          items={nowNext}
          zoneLabel={zoneLabel}
          layout={chatColumn ? 'carousel' : 'stack'}
          progress={progress}
          onToggleSchedule={passWindows.requestSchedule}
          scheduleLocked={!hasPass}
          onScheduleLocked={passWindows.openPassInfoBoard}
          onGetPass={() => getPass()}
          className={styles.pad}
        />
      ) : null}
      <HowToCard
        country={country.name.uk}
        traditions={country.howTo.traditions}
        gallery={country.howTo.gallery}
        text={country.howTo.text}
        variant="full"
        className={styles.pad}
      />
      <Faq items={faqItems} className={styles.pad} />
    </div>
  );

  const chatSlot =
    chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const vis = useChatVisibility();
  const chatRoom: RoomId = `country:${iso}`;
  const { collapse } = useChatDockControls();
  const panel = (className?: string) => (
    <ChatPanel
      country={{ iso, name: country.name.uk }}
      eventId={mainEvent?.id ?? null}
      cityName={current?.city?.name.uk}
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );
  const title = currentSource?.title.uk ?? (current ? eventTitle(current.city) : '');
  const firstRowEvent = firstRowEventForCountry(data, iso);
  // Слот «Першого ряду» сторінки країни (US5): телефон — смуга під липким рядком (`dockBar`), як на головній.
  const firstRow = (dockBar: boolean) =>
    firstRowEvent ? (
      <div data-first-row-slot="">
        <FirstRowModule event={firstRowEvent} dockBar={dockBar} />
      </div>
    ) : null;
  // Штамп (окремий блок) і вікна моменту (оцінка, пропозиції) — одразу під рядком дій плеєра, як на головній.
  const inflow = (
    <>
      <StampBlock eventId={mainEvent?.id ?? null} />
      <OfferBlock />
      <div data-moment-slot="">
        <OverlayInFlowOutlet label={tPlayer('inFlowLabel')} />
      </div>
    </>
  );

  return (
    <>
      <h1 className="sr-only">{tc('pageHeading', { country: country.name.uk })}</h1>
      {chatColumn ? header : null}
      <PlayerBlock
        mode="remote"
        ready={known && (!playing || playingOurs)}
        phase={phase}
        current={current}
        next={next}
        airView={expected ? 'expected-scene' : 'countdown-scene'}
        title={title}
        streams={streams}
        onWatchAgain={watchAgain}
        titleId={PLAYER_TITLE_ID}
        watchers={viewers.length}
        captionAside={
          chatColumn && vis.hidden ? <ChatHiddenButton room={chatRoom} onShow={vis.show} /> : null
        }
        dock={!chatColumn}
        belowBar={known ? firstRow(true) : null}
      />

      {chatColumn ? (
        <>
          <div className={cn(home.column, 'pt-4')}>
            {inflow}
            {firstRow(false)}
          </div>
          <div className="pt-6">{events}</div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
        </>
      ) : (
        <>
          <div className={cn('px-4', home.phoneInflow)}>{inflow}</div>
          {header}
          <p className={cn(styles.pad, home.watchers, 'pt-3')}>
            <Icon name="globe" size={14} strokeWidth={2} />
            {tPlayer('watchersShort', { count: viewers.length })}
          </p>
          <div className="pt-6">{events}</div>
          <ChatDock
            room={`country:${iso}`}
            roomLabel={tChat('roomCountryPicker', { country: country.name.uk })}
          >
            {panel('min-h-0 flex-1')}
          </ChatDock>
        </>
      )}
    </>
  );
}
