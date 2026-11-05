'use client';

/**
 * Сторінка країни, пульт (S-COUNTRY, ІНВ 4.3; T092).
 *
 * Повний дизайн — дошки `Desk-Country-Full`, `Phone-Country-Full` (погоджено 2026-11-05):
 * рядок країни (CountryHeader; кілька поясів — вибір поясу) · відео й рядок дій («Обрати трансляцію ›», «Відео | Відлік»,
 * кімната, вечірка, «⋯») · «Перший ряд» · штамп (тут — постійно, без «×») · пропозиція пасу й чайові · «Трансляції ·
 * <Країна>» картками з мініатюрами й «+» · до півночі «Ще о … · інші країни поясу» (після — «Зараз і далі») ·
 * «Як святкувати» · «Як <Країна> зустрічає Новий рік» · «Питання й відповіді».
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
import { CountryHeader, type CountryZoneOption } from '@/components/live/CountryHeader';
import { Faq, type FaqItem } from '@/components/live/Faq';
import { HowToCard } from '@/components/live/HowToCard';
import { NowNext } from '@/components/live/NowNext';
import { StreamCards, type CountdownCountry } from '@/components/live/StreamCards';
import type { EventFilterValue } from '@/components/live/EventFilter';
import { StampBlock } from '@/components/live/StampBlock';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useAddToRoom } from '@/components/room/useRoomViewport';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { RoomTray } from '@/components/room/RoomTray';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
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
import { utcLabel } from './MapModel';
import styles from './live.module.css';
import { FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { firstRowEventFor } from '@/lib/firstrow/pick';

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

/** Пояс країни для вибору в шапці: місто головної події, «UTC−5», північ і скільки трансляцій. */
function zoneOption(
  data: Dataset,
  iso: string,
  zone: LoadedZone,
  now: Ms,
  streamsNote: (n: number) => string,
): CountryZoneOption {
  const city = data.citiesById.get(countryMainEvent(data, iso, zone.id)?.cityId ?? '');
  const n = countryStreamRows(data, iso, zone.id, now).length;
  return {
    id: zone.id,
    utc: utcLabel(zone.offsetMinutes),
    city: city?.name.uk ?? '',
    midnightMs: zone.midnightMs,
    note: streamsNote(n),
  };
}

export function CountryLive({ iso }: { iso: string }) {
  const tc = useTranslations('country');
  const tStreams = useTranslations('country.streams');
  const tHead = useTranslations('country.header');
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

  // Один раз після того, як час відомий: пояс за замовчуванням (кілька поясів — найближча північ попереду, усі минули —
  // остання; рішення 2026-11-05) і ланцюжок, якщо плеєр не грає подію цієї країни. Далі — лише дії людини.
  const initRef = useRef(false);
  useEffect(() => {
    if (!known || !actions || initRef.current) return;
    initRef.current = true;
    if (playing && playing.countryIso === iso && player?.selection) return;
    const zone = defaultZoneId(data, country, now) ?? zoneId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- пояс за замовчуванням залежить від часу, відомого лише після синхронізації
    if (zone !== zoneId) setZoneId(zone);
    const ev = zone ? countryMainEvent(data, iso, zone) : undefined;
    if (ev) actions.setChain(chainInput(data, ev.id));
    // Лише перший раз, коли час відомий.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, actions]);

  // Режим «Відлік» (рішення 2026-11-05): сцена Time2Fest на місці відео — точна північ без затримки.
  const [countdown, setCountdown] = useState(false);

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
      setCountdown(false);
      setPickedEventId(row.eventId);
      actions?.setChain(chainInput(data, row.eventId, row.id));
    },
    [actions, data],
  );
  const changeZone = useCallback(
    (id: string) => {
      setCountdown(false);
      setPickedEventId(null);
      setZoneId(id);
      const ev = countryMainEvent(data, iso, id);
      if (ev) actions?.setChain(chainInput(data, ev.id));
    },
    [actions, data, iso],
  );
  // «Відео | Відлік»: «Відлік» — ланцюжок без джерел (плеєр показує сцену); «Відео» — знову головна подія поясу.
  const setMode = useCallback(
    (on: boolean) => {
      setCountdown(on);
      if (!mainEvent) return;
      actions?.setChain(
        on ? { eventId: mainEvent.id, sources: [] } : chainInput(data, mainEvent.id),
      );
    },
    [actions, data, mainEvent],
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
      onAddToRoom: addToRoom,
    }),
    [pickerRows, iso, mainEvent, select, addToRoom],
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
  // «Зараз і далі» — і до півночі, і після (правка власника 2026-11-05: на Азорських островах його не було).
  const nowNext = useMemo(() => nowNextItems(data, minute, schedule), [data, minute, schedule]);

  // «Ще о … · інші країни поясу»: трансляції сусідів і країни без трансляції (обкладинка з «Відлік»), фільтр як у
  // «Зараз і далі» (правка власника 2026-11-05).
  const [nbFilter, setNbFilter] = useState<EventFilterValue>('all');
  const zoneCountdown = useMemo<CountdownCountry[]>(() => {
    if (!zoneId) return [];
    return data.countries
      .filter((c) => c.iso !== iso && c.zoneIds.includes(zoneId) && countryStreamRows(data, c.iso, zoneId, minute).length === 0)
      .sort((a, b) => b.popularity - a.popularity)
      .map((c) => {
        const ev = countryMainEvent(data, c.iso, zoneId);
        const city = data.citiesById.get(ev?.cityId ?? '');
        return {
          iso: c.iso,
          name: c.name.uk,
          flagCode: c.flagCode,
          illustrationId: c.illustrationId ?? 'generic',
          city: city?.name.uk ?? c.name.uk,
          href: countryHref(c),
          midnightMs: ev?.midnightMs ?? 0,
        };
      });
  }, [data, iso, zoneId, minute]);
  const inSched = useCallback(
    (eventId: string | undefined) => !!eventId && countryZoneEvents(eventId).some((id) => schedule.includes(id)),
    [schedule],
  );
  const nbRows = useMemo(
    () => (nbFilter === 'mine' ? zoneRows.filter((r) => inSched(r.eventId)) : zoneRows),
    [nbFilter, zoneRows, inSched],
  );
  const nbCountdown = useMemo(
    () =>
      nbFilter === 'live'
        ? []
        : nbFilter === 'mine'
          ? zoneCountdown.filter((c) => inSched(zoneId ? countryMainEvent(data, c.iso, zoneId)?.id : undefined))
          : zoneCountdown,
    [nbFilter, zoneCountdown, inSched, data, zoneId],
  );
  const nbScheduleCount = useMemo(
    () => zoneRows.filter((r) => inSched(r.eventId)).length + zoneCountdown.filter((c) => inSched(zoneId ? countryMainEvent(data, c.iso, zoneId)?.id : undefined)).length,
    [zoneRows, zoneCountdown, inSched, data, zoneId],
  );
  const changeNbFilter = useCallback(
    (next: EventFilterValue) => {
      // Без пасу «Мій графік» — вікно «Що дає пас», фільтр лишається.
      if (next === 'mine' && !hasPass) return passWindows.openPassInfoBoard();
      setNbFilter(next);
    },
    [hasPass, passWindows],
  );
  const progress = useMemo(() => festProgress(data, minute), [data, minute]);
  const zoneLabel = viewerZoneLabel();

  const zoneOptions = useMemo(
    () =>
      zones.length > 1
        ? zones.map((z) =>
            zoneOption(data, iso, z, minute, (n) =>
              n ? tHead('streamsCount', { count: n }) : tHead('countdownOnly'),
            ),
          )
        : undefined,
    [zones, data, iso, minute, tHead],
  );
  const zone = zoneId ? data.zonesById.get(zoneId) : undefined;
  const header = mainEvent ? (
    <CountryHeader
      country={country}
      midnightMs={mainEvent.midnightMs}
      after={after}
      zones={zoneOptions}
      selectedZoneId={zoneId ?? undefined}
      onZoneChange={changeZone}
      inSchedule={inSchedule}
      onToggleSchedule={toggleSchedule}
      className={styles.pad}
    />
  ) : null;
  const title = currentSource?.title.uk ?? (current ? eventTitle(current.city) : '');
  const noStreams = countryRows.length === 0;
  // Що під «Трансляціями» (концепція, дошка `Desk-Room-Plus`, погоджено 2026-11-05): у країни зараз іде трансляція наживо —
  // сусіди по поясу (та сама північ); ні (лише відлік, ще не почалась чи вже закінчилась) — «Зараз і далі».
  const liveNow = !recording && countryRows.some((r) => r.status === 'live');
  const currentRow = countdown ? null : (pickerRows.find((r) => r.id === currentStreamId) ?? null);
  const countdownMode = noStreams ? undefined : { countdown, onChange: setMode };
  const time = mainEvent ? formatClock(mainEvent.midnightMs) : '';
  const zoneCountries = useMemo(
    () => (zoneId ? data.countries.filter((c) => c.zoneIds.includes(zoneId)).length : 0),
    [data, zoneId],
  );

  const events = (
    <div className="flex flex-col gap-8 pb-8">
      <div className={cn(styles.pad, 'flex flex-col gap-9')}>
        <StreamCards
          id={STREAMS_ID}
          heading={
            zoneOptions && zone
              ? tStreams('cardsHeadingZone', {
                  country: country.name.uk,
                  zone: utcLabel(zone.offsetMinutes),
                })
              : tStreams('cardsHeading', { country: country.name.uk })
          }
          sub={recording ? tStreams('cardsSubAfter', { time }) : tStreams('cardsSub', { time })}
          rows={countryRows}
          currentStreamId={countdown ? null : currentStreamId}
          currentRow={currentRow}
          onSelect={select}
          onAddToRoom={addToRoom}
        />
        {liveNow ? (
          <StreamCards
            heading={tStreams('othersHeading', { time })}
            sub={tStreams('othersSub')}
            rows={nbRows}
            countdown={nbCountdown}
            filter={{ value: nbFilter, onChange: changeNbFilter, scheduleLocked: !hasPass, scheduleCount: nbScheduleCount }}
            phoneLimit={5}
            currentStreamId={countdown ? null : currentStreamId}
            currentRow={currentRow}
            onSelect={select}
            onAddToRoom={addToRoom}
            showCountry
            footer={
              <Link
                variant="chevron"
                href={`/countries/?zone=${encodeURIComponent(zoneId ?? '')}`}
                className="self-start"
              >
                {tStreams('othersAll', { count: zoneCountries })}
              </Link>
            }
          />
        ) : null}
      </div>
      {!liveNow && nowNext.length ? (
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
      <Faq items={faqItems} columns={2} className={styles.pad} />
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
  // Ряд поточного поясу — той самий на всіх сторінках (ряд один на пояс, рішення 2026-11-05), навіть якщо країна
  // зустрічає Новий рік в іншому поясі (ряди інших поясів — через «Ще є місця», коли поточний розпродано).
  const firstRowEvent = firstRowEventFor(data, now);
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
      <StampBlock eventId={mainEvent?.id ?? null} permanent />
      <OfferBlock />
      <div data-moment-slot="">
        <OverlayInFlowOutlet label={tPlayer('inFlowLabel')} />
      </div>
    </>
  );

  return (
    <>
      <h1 className="sr-only">{tc('pageHeading', { country: country.name.uk })}</h1>
      {header}
      <PlayerBlock
        mode="remote"
        ready={known && (!playing || playingOurs)}
        phase={phase}
        current={current}
        next={next}
        airView={expected ? 'expected-scene' : 'countdown-scene'}
        title={title}
        streams={streams}
        countdownMode={countdownMode}
        onToggleSchedule={passWindows.requestSchedule}
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
          {/* «Перший ряд», під ним штамп і пропозиції (дошка `Desk-Country-Full`). */}
          <div className={cn(home.column, 'pt-4')}>
            {firstRow(false)}
            {inflow}
          </div>
          <div className="pt-6">{events}</div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
          <RoomTray />
        </>
      ) : (
        <>
          <div className={cn('px-4', home.phoneInflow)}>{inflow}</div>
          <div className={cn(styles.pad, 'flex flex-col gap-1.5')}>
            {after ? null : (
              <p className={home.watchers}>
                <Icon name="passport" size={14} strokeWidth={2} />
                {tHead('stamp')}
              </p>
            )}
            <p className={home.watchers}>
              <Icon name="globe" size={14} strokeWidth={2} />
              {tPlayer('watchersShort', { count: viewers.length })}
            </p>
          </div>
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
