'use client';

/**
 * Сторінка країни, пульт (S-COUNTRY, ІНВ 4.3; T092).
 *
 * Телефон (зверху вниз): PlayerBlock(`remote`, плеєр закріплений угорі) · CountryHeader (крихти, календар) ·
 * слот «Першого ряду» (US5) · InFlowSlot · вкладки «Події | Чат»: «Події» — «Міста й трансляції», «Трансляції в цьому
 * поясі» (після півночі — «Зараз і далі»), «Як святкувати», «Питання й відповіді»; «Чат» — «Країна» (за замовчуванням) / «Світ».
 * Десктоп: ліва колонка — CountryHeader · PlayerBlock · слот «Першого ряду» · InFlowSlot · ті самі блоки; права колонка
 * макета — чат «Країна» / «Світ» (sticky).
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
import { MORE_STREAMS_ID, MoreStreamsSheet, StreamList, ZoneStreamsBlock } from '@/components/live/StreamList';
import { StampBlock } from '@/components/live/StampBlock';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { CookieInflow } from '@/components/offers/CookieLayer';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useAddToRoom } from '@/components/room/useRoomViewport';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { cn } from '@/components/primitives/cn';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { OverlayInFlowOutlet, useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, LoadedZone, Ms, RoomId, ScheduledEvent } from '@/lib/data/types';
import { captionPhase } from '@/lib/engine/captionPhase';
import { STAMP_DELAY } from '@/lib/engine/config';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { eventStatus } from '@/lib/engine/eventStatus';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { formatClock, viewerZoneLabel } from '@/lib/i18n/time';
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
import { useOptionalPlayer, useOptionalPlayerActions, type PlayerChainInput } from '@/lib/player/PlayerProvider';
import type { PlayerSource } from '@/lib/player/types';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { eventTitle } from './Caption';
import styles from './live.module.css';
import { FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { firstRowEventForCountry } from '@/lib/firstrow/pick';

const PLAYER_TITLE_ID = 'player-title';
const STREAMS_ID = 'country-streams';

function placeOf(data: Dataset, event: ScheduledEvent | undefined | null): AirPlace | null {
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  return { event, city: data.citiesById.get(event.cityId), country, href: country ? countryHref(country) : null };
}

function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  return preferredSourceId ? { eventId, sources, preferredSourceId } : { eventId, sources };
}

/** Наступна подія розкладу після півночі `event` (для «· далі: …» у пульті): подія наступного слота ефіру. */
function nextAfter(data: Dataset, event: ScheduledEvent, now: Ms): ScheduledEvent | null {
  const slot = airSlots(data).find((s) => s.midnightMs > event.midnightMs);
  return slot ? (pickSlotEvent(now, slot.events, data.countriesByIso, data.chainsByEventId)?.event ?? null) : null;
}

/** «UTC+3», «UTC−3:30». */
function utcLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const abs = Math.abs(offsetMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return offsetMinutes === 0 ? 'UTC+0' : `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

function zoneChip(data: Dataset, iso: string, zone: LoadedZone): { id: string; label: string } {
  const city = data.citiesById.get(countryMainEvent(data, iso, zone.id)?.cityId ?? '');
  return { id: zone.id, label: city ? `${utcLabel(zone.offsetMinutes)} · ${city.name.uk}` : utcLabel(zone.offsetMinutes) };
}

export function CountryLive({ iso }: { iso: string }) {
  const tc = useTranslations('country');
  const tStreams = useTranslations('country.streams');
  const tChat = useTranslations('chat');
  const tPlayer = useTranslations('player');
  const data = getData();
  const country = data.countriesByIso.get(iso)!;
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const overlay = useOverlay();
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
      ? data.chainsByEventId.get(shownEvent?.id ?? '')?.sources.find((s) => s.id === selection.source.id)
      : undefined;
  const currentStreamId = currentSource?.id ?? null;

  const next = useMemo(() => (shownEvent ? placeOf(data, nextAfter(data, shownEvent, minute)) : null), [data, shownEvent, minute]);
  const phase =
    known && shownEvent
      ? captionPhase(now, shownEvent, 'remote', next?.event ?? null, { hasReplay: !!currentSource?.replay })
      : null;
  const expected = useMemo(
    () => (shownEvent ? (data.chainsByEventId.get(shownEvent.id)?.sources ?? []).some((s) => sourceStatus(s, minute) === 'expected') : false),
    [data, shownEvent, minute],
  );

  // Присутність для штампа: головна подія вибраного поясу й подія, що грає (FR-060, `presenceSource: 'country'`).
  const presenceIds = useMemo(() => [...new Set([mainEvent?.id, shownEvent?.id].filter((x): x is string => !!x))], [mainEvent, shownEvent]);
  useStampGrant(presenceIds.length ? { source: 'country', eventIds: presenceIds } : null);
  useChatSimulator(useMemo(() => ['world', `country:${iso}`] as RoomId[], [iso]));
  useMomentWindows();
  // Пропозиції пасу й чайових (offer:show) і стан введення для рушія пропозицій.
  const passWindows = useOfferWindows();
  const hasPass = useGuestStore((s) => s.hasPass);
  const getPass = useGetPass();

  const countryRows = useMemo(() => (zoneId ? countryStreamRows(data, iso, zoneId, minute) : []), [data, iso, zoneId, minute]);
  const zoneRows = useMemo(() => (zoneId ? zoneStreamRows(data, zoneId, iso, minute) : []), [data, iso, zoneId, minute]);
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

  const moreStreams = useCallback(() => {
    if (chatColumn) {
      document.getElementById(STREAMS_ID)?.scrollIntoView({ block: 'start' });
      return;
    }
    const midnightMs = mainEvent?.midnightMs ?? 0;
    overlay.open({
      id: MORE_STREAMS_ID,
      kind: 'nonmodal',
      title: tStreams('sheet.title', { time: formatClock(midnightMs) }),
      content: (
        <MoreStreamsSheet
          countryName={country.name.uk}
          countryStreams={countryRows}
          zoneStreams={zoneRows}
          midnightMs={midnightMs}
          currentStreamId={currentStreamId}
          onSelect={(row) => {
            select(row);
            overlay.close(MORE_STREAMS_ID);
          }}
          onAddToRoom={addToRoom}
        />
      ),
    });
  }, [chatColumn, overlay, tStreams, country, countryRows, zoneRows, mainEvent, currentStreamId, select, addToRoom]);

  const faqItems: FaqItem[] = (['when', 'stamp', 'switch', 'room'] as const).map((id) => ({
    id,
    question: tc(`faq.items.${id}.q`),
    answer: tc(`faq.items.${id}.a`, { time: mainEvent ? formatClock(mainEvent.midnightMs) : '' }),
  }));

  const schedule = useGuestStore((s) => s.schedule);
  const nowNext = useMemo(() => (recording ? nowNextItems(data, minute, schedule) : []), [recording, data, minute, schedule]);
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
      className={cn(styles.pad, chatColumn ? 'pb-4' : 'pt-3')}
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

  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
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
        onMoreStreams={moreStreams}
        onWatchAgain={watchAgain}
        titleId={PLAYER_TITLE_ID}
      />
      {chatColumn ? null : header}
      {/* Слот «Першого ряду» сторінки країни (US5). */}
      <div data-first-row-slot="">
        <FirstRowModule event={firstRowEventForCountry(data, iso)} className={styles.pad} />
      </div>
      {chatColumn && vis.hidden ? (
        <div className={cn(styles.pad, 'pt-3')}>
          <ChatHiddenButton room={chatRoom} onShow={vis.show} />
        </div>
      ) : null}
      <StampBlock eventId={mainEvent?.id ?? null} className={styles.pad} />
      <div className={styles.pad}>
        <CookieInflow />
      </div>
      <div data-moment-slot="" className={styles.pad}>
        <OverlayInFlowOutlet label={tPlayer('inFlowLabel')} />
      </div>

      {chatColumn ? (
        <>
          <div className="pt-6">{events}</div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
        </>
      ) : (
        <>
          <div className="pt-4">{events}</div>
          <ChatDock room={`country:${iso}`} roomLabel={tChat('roomCountryPicker', { country: country.name.uk })}>
            {panel('min-h-0 flex-1')}
          </ChatDock>
        </>
      )}

    </>
  );
}
