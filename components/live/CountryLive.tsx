'use client';

/**
 * Сторінка країни, пульт (S-COUNTRY, ІНВ 4.3; T092).
 *
 * Повний дизайн — дошки `Desk-Country-Full`, `Phone-Country-Full` (погоджено 2026-11-05):
 * рядок країни (CountryHeader; кілька поясів — вибір поясу) · відео й рядок дій («Обрати трансляцію ›», «Відео | Відлік»,
 * кімната, вечірка, «⋯») · штамп (тут — постійно, без «×») · пропозиція пасу · «Трансляції ·
 * <Країна>» картками з мініатюрами й «+» · до півночі «Ще о … · інші країни поясу» (після — «Зараз і далі») ·
 * «Як святкувати» · «Як <Країна> зустрічає Новий рік» · «Питання й відповіді».
 * Каркас — як на головній (рішення 2026-11-05, `as-built-home-countries-2026-11-05.md`):
 * Телефон (зверху вниз): відео · липкий рядок «місто · відлік» зі звуком · назва й рядок дій
 * («Обрати трансляцію ›», «⋯») · штамп, пропозиції, вікна моменту · CountryHeader (крихти, графік) · «Дивляться люди з N
 * країн» · «Міста й трансляції», «Трансляції в цьому поясі» (після півночі — «Зараз і далі»), «Як святкувати», «Питання й
 * відповіді». Чат «Країна» / «Світ» — закріплене вікно внизу (`ChatDock`).
 * Десктоп: CountryHeader · PlayerBlock (рядок дій: «Обрати трансляцію ›», кімната, вечірка, «⋯») · штамп, пропозиції,
 * вікна моменту · ті самі блоки; права колонка макета — чат (sticky); сховано — «Показати чат» біля таймера.
 * «Перший ряд» прибрано (рішення власника 2026-11-12); на його місці — смуга тостів (`ToastStrip`): телефон — під
 * липким рядком часу, десктоп — під рядком дій плеєра, над штампом.
 *
 * Плеєр: сторінка сама НЕ переходить за ефіром (FR-024). Ланцюжок задається лише двічі: один раз після відкриття
 * (якщо вже грає подія цієї країни — після «Лишитися тут ›» — нічого не чіпаємо, відео не перезапускається) і на дію
 * людини (дотик до рядка трансляції, чип поясу, «Подивитися північ ще раз»). Час ланцюжок не змінює.
 *
 * Головне святкування (рішення власника 2026-11-13): поки не почалось — заглушка (час і відлік лише з відомим початком) з
 * кнопкою «Дивитися, що вже йде», якщо в поясі щось іде наживо: відкриває той самий список, що «Обрати трансляцію ›»
 * сторінки (трансляції країни й поясу, `useStreamPicker`), вибір — ручний. Людина сама обрала іншу трансляцію поясу, а головне почалось — «Головне святкування почалось ·
 * Перемкнути» в рядку під відео, без автоматичного перемикання.
 */
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ToastStrip } from '@/components/toast/ToastStrip';
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
import { OverlayInFlowOutlet, useChatColumn, useTabletPortrait } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, LoadedZone, Ms, RoomId, ScheduledEvent } from '@/lib/data/types';
import { captionPhase } from '@/lib/engine/captionPhase';
import { HANDOVER_AFTER, STAMP_DELAY } from '@/lib/engine/config';
import { mainLiveLine, mainSourceOf, zoneHasLive } from '@/lib/engine/mainCelebration';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { scrollToBlock } from './scrollToBlock';
import { useStreamPicker } from './ActionRow';
import { airSlots, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { eventStatus } from '@/lib/engine/eventStatus';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { isReducedMotionNow } from '@/lib/a11y/reducedMotion';
import { formatClock, viewerZoneLabel } from '@/lib/i18n/time';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { ratingState } from '@/lib/rating/rating';
import { currentViewers } from '@/lib/presence/viewers';
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

const PLAYER_TITLE_ID = 'player-title';
const STREAMS_ID = 'country-streams';
const NOW_NEXT_ID = 'now-next';

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

/**
 * Ланцюжок події для плеєра. Без обраної людиною трансляції — головне святкування (`kind: 'main'`), якщо воно є: ще не
 * почалось — на місці відео заглушка «Очікуйте трансляцію» (правка власника 2026-11-11), а не перша-ліпша вебкамера; і коли
 * час початку невідомий чи вже минув (2026-11-13). Обрана людиною трансляція, що «очікується» без часу початку, — теж заглушка.
 */
export function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  const preferred = preferredSourceId ?? sources.find((s) => s.kind === 'main')?.id;
  if (!preferred) return { eventId, sources };
  const wait = !preferredSourceId || sources.find((s) => s.id === preferred)?.status === 'expected';
  return wait ? { eventId, sources, preferredSourceId: preferred, waitForPreferred: true } : { eventId, sources, preferredSourceId: preferred };
}

/** Угору до плеєра (вибір трансляції в списку під ним). */
function scrollToPlayer() {
  window.scrollTo({ top: 0, behavior: isReducedMotionNow() ? 'auto' : 'smooth' });
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

/** Що відкрити на сторінці країни з адреси (`?e=` подія / `?zone=` пояс, `countryHref`): пояс і, можливо, подія. */
export interface CountryFocus {
  zoneId: string;
  eventId: string | null;
  /** Обрана трансляція події (`?s=`). */
  sourceId?: string | null;
}

export function countryFocusFrom(
  data: Dataset,
  iso: string,
  zoneIds: readonly string[],
  e: string | null,
  zone: string | null,
  s: string | null = null,
): CountryFocus | null {
  const ev = e ? data.eventsById.get(e) : undefined;
  if (ev && ev.countryIso === iso && zoneIds.includes(ev.zoneId)) {
    const src = s ? data.chainsByEventId.get(ev.id)?.sources.find((x) => x.id === s) : undefined;
    return { zoneId: ev.zoneId, eventId: ev.id, ...(src ? { sourceId: src.id } : {}) };
  }
  if (zone && zoneIds.includes(zone)) return { zoneId: zone, eventId: null };
  return null;
}

/**
 * Читає `?e=` / `?zone=` (окремо, у своєму `Suspense`: сторінка країни лишається статичною) і повідомляє про зміну —
 * перехід із «Зараз і далі» на ту саму сторінку з іншим містом теж перемикає пояс.
 */
function FocusFromUrl({ onFocus }: { onFocus: (e: string | null, zone: string | null, s: string | null) => void }) {
  const sp = useSearchParams();
  const e = sp?.get('e') ?? null;
  const zone = sp?.get('zone') ?? null;
  const s = sp?.get('s') ?? null;
  useEffect(() => {
    onFocus(e, zone, s);
  }, [e, zone, s, onFocus]);
  return null;
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
  // Планшет-портрет (`Tab-P-New`, 2026-11-10): «Зараз і далі» — сіткою карток, як на головній.
  const tabletPortrait = useTabletPortrait();
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
  // Людина сама обрала трансляцію (дотик до трансляції, `?s=` в адресі) — для «Головне святкування почалось · Перемкнути».
  const [manual, setManual] = useState(false);
  const playing = player?.eventId ? data.eventsById.get(player.eventId) : undefined;
  const playingOurs = !!playing && (playing.countryIso === iso || playing.id === pickedEventId);

  // Пояс і подія з адреси (`?e=` / `?zone=`, власник 2026-11-10: «щоб перекидало на те, на що клікнув») — важливіші
  // за пояс за замовчуванням і за подію, яку вже грає плеєр.
  const zoneIdList = useMemo(() => zones.map((z) => z.id), [zones]);
  const readFocus = useCallback(
    (e: string | null, zone: string | null, s: string | null = null) => countryFocusFrom(data, iso, zoneIdList, e, zone, s),
    [data, iso, zoneIdList],
  );
  const [urlFocus, setUrlFocus] = useState<CountryFocus | null>(null);
  const onUrlFocus = useCallback(
    (e: string | null, zone: string | null, s: string | null) => setUrlFocus(readFocus(e, zone, s)),
    [readFocus],
  );
  const appliedFocus = useRef<string | null>(null);

  // Один раз після того, як час відомий: пояс за замовчуванням (кілька поясів — найближча північ попереду, усі минули —
  // остання; рішення 2026-11-05) і ланцюжок, якщо плеєр не грає подію цієї країни. Далі — лише дії людини.
  // Є пояс / подія в адресі — їх відкриває ефект нижче (адресу читаємо й тут: `FocusFromUrl` може змонтуватися пізніше).
  const initRef = useRef(false);
  useEffect(() => {
    if (!known || !actions || initRef.current) return;
    initRef.current = true;
    const sp = new URLSearchParams(window.location.search);
    if (readFocus(sp.get('e'), sp.get('zone'))) return;
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

  // Адреса з поясом / подією: відкрити саме їх (і при першому показі, і коли адреса змінилася на цій же сторінці).
  useEffect(() => {
    if (!known || !actions) return;
    let focus = urlFocus;
    if (!focus && appliedFocus.current === null) {
      const sp = new URLSearchParams(window.location.search);
      focus = readFocus(sp.get('e'), sp.get('zone'), sp.get('s'));
    }
    if (!focus) return;
    const key = `${focus.zoneId}|${focus.eventId ?? ''}|${focus.sourceId ?? ''}`;
    if (appliedFocus.current === key) return;
    appliedFocus.current = key;
    const main = countryMainEvent(data, iso, focus.zoneId);
    const target = focus.eventId ?? main?.id ?? null;
    // Пояс і подія з адреси відомі лише після монтування.
    setCountdown(false);
    setZoneId(focus.zoneId);
    setPickedEventId(focus.eventId && focus.eventId !== main?.id ? focus.eventId : null);
    setManual(!!focus.sourceId);
    if (target && (player?.eventId !== target || focus.sourceId)) actions.setChain(chainInput(data, target, focus.sourceId ?? undefined));
    // Лише на зміну адреси (і перший раз, коли час відомий).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFocus, known, actions]);

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
  // Пропозиція пасу (offer:show) і стан введення для рушія пропозицій.
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

  // Дотик до трансляції (правка власника 2026-11-11): своя країна — вмикається тут і сторінка йде вгору до плеєра (ще не
  // почалась — заглушка «Очікуйте трансляцію»); інша країна поясу — перехід на її сторінку з цією трансляцією.
  const router = useRouter();
  const select = useCallback(
    (row: StreamRowData) => {
      if (row.countryIso !== iso) {
        const other = data.countriesByIso.get(row.countryIso);
        if (other) router.push(countryHref(other, { eventId: row.eventId, sourceId: row.id }));
        return;
      }
      setCountdown(false);
      setPickedEventId(row.eventId);
      setManual(true);
      actions?.setChain(chainInput(data, row.eventId, row.id));
      scrollToPlayer();
    },
    [actions, data, iso, router],
  );
  const changeZone = useCallback(
    (id: string) => {
      setCountdown(false);
      setPickedEventId(null);
      setManual(false);
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
      setManual(false);
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
  const viewers = useMemo(() => currentViewers(data), [data]);

  const faqItems: FaqItem[] = (['when', 'stamp', 'switch', 'room'] as const).map((id) => ({
    id,
    question: tc(`faq.items.${id}.q`),
    answer: tc(`faq.items.${id}.a`, { time: mainEvent ? formatClock(mainEvent.midnightMs) : '' }),
  }));

  const schedule = useGuestStore((s) => s.schedule);
  // «Зараз і далі» — і до півночі, і після (правка власника 2026-11-05: на Азорських островах його не було).
  const nowNext = useMemo(() => nowNextItems(data, minute, schedule, { liveOthers: true, mainCards: true }), [data, minute, schedule]);

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
          href: countryHref(c, { zoneId }),
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
  // Чіп рейтингу біля назви — після півночі, якщо головне святкування вже в «Рейтингу святкувань».
  const rate = useGuestStore((g) => g.rate);
  const ratingRow = useMemo(
    () => (after && mainEvent ? ratingState(data, minute, rate).rows.find((r) => r.eventId === mainEvent.id) : undefined),
    [after, mainEvent, data, minute, rate],
  );
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
      rating={ratingRow ? { score: ratingRow.score, place: ratingRow.place } : undefined}
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

  // Головне святкування поясу (2026-11-13): кнопка «Дивитися, що вже йде ↓» на заглушці й рядок «почалось · Перемкнути».
  const reduced = useReducedMotion();
  const liveInZone = useMemo(
    () => (mainEvent && minute > 0 ? zoneHasLive(data, mainEvent.midnightMs, minute) : false),
    [data, mainEvent, minute],
  );
  // «Дивитися, що вже йде» — той самий список, що «Обрати трансляцію ›» сторінки (трансляції країни й поясу; вибір — ручний,
  // рішення власника 2026-11-13); списку немає — до трансляцій країни чи «Зараз і далі», як раніше.
  const picker = useStreamPicker({ mode: 'remote', streams, onToggleSchedule: passWindows.requestSchedule });
  const scrollToLive = useCallback(() => scrollToBlock(liveNow ? STREAMS_ID : NOW_NEXT_ID, reduced), [liveNow, reduced]);
  const watchLive = streams.rows.length > 0 ? picker.open : scrollToLive;
  const mainSource = mainEvent ? mainSourceOf(data.chainsByEventId.get(mainEvent.id)) : null;
  const playingSel = player?.selection;
  const mainLive =
    known && mainEvent && mainSource && playing && playingSel && playingSel.kind !== 'countdown-scene'
      ? mainLiveLine({
          now,
          main: { eventId: mainEvent.id, source: mainSource },
          midnightMs: mainEvent.midnightMs,
          playing: { eventId: playing.id, sourceId: playingSel.source.id, midnightMs: playing.midnightMs },
          manual: manual && !countdown,
          stampHint: false, // рядок підказки про штамп віддає `PlayerBlock` (останні 60 с до півночі)
          handoverAt: mainEvent.midnightMs + HANDOVER_AFTER,
        })
      : false;
  const switchToMain = useCallback(() => {
    if (!mainEvent) return;
    setManual(false);
    setPickedEventId(null);
    actions?.setChain(chainInput(data, mainEvent.id));
  }, [actions, data, mainEvent]);
  const mainCity = mainEvent ? (data.citiesById.get(mainEvent.cityId)?.name.uk ?? country.name.uk) : '';
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
          layout={chatColumn ? 'carousel' : tabletPortrait ? 'grid' : 'stack'}
          progress={progress}
          mapHref={tabletPortrait ? '/countries/' : undefined}
          onToggleSchedule={passWindows.requestSchedule}
          scheduleLocked={!hasPass}
          onScheduleLocked={passWindows.openPassInfoBoard}
          onGetPass={() => getPass()}
          id={NOW_NEXT_ID}
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
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );
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
      <Suspense fallback={null}>
        <FocusFromUrl onFocus={onUrlFocus} />
      </Suspense>
      {/* `data-skeleton` — поки час не відомий (статичний HTML до гідратації): той самий маркер, що в `loading.tsx` (2026-11-10). */}
      <h1 className="sr-only" data-skeleton={known ? undefined : 'country'}>
        {tc('pageHeading', { country: country.name.uk })}
      </h1>
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
        stampHint
        captionAside={
          chatColumn && vis.hidden ? <ChatHiddenButton room={chatRoom} onShow={vis.show} /> : null
        }
        dock={!chatColumn}
        // Смуга тостів (телефон) — під липким рядком часу, та сама, що на головній (дошка `Phone-Toast-New`, 2026-11-12).
        belowBar={<ToastStrip variant="phone" />}
        onWatchLive={liveInZone ? watchLive : undefined}
        mainLive={mainLive ? { place: mainCity, onSwitch: switchToMain } : null}
      />

      {chatColumn ? (
        <>
          {/* Смуга тостів над штампом і пропозиціями (дошки `Desk-Toast-New`, `Desk-Country-Full`). */}
          <div className={cn(home.column, 'pt-4')}>
            <ToastStrip variant="desk" />
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
            {/* Чесне число (2026-11-12): без даних присутності (робоча збірка) рядка немає. */}
            {viewers.length ? (
              <p className={cn(home.watchers, home.watchersPhone)}>
                <Icon name="globe" size={14} strokeWidth={2} />
                {tPlayer('watchersShort', { count: viewers.length })}
              </p>
            ) : null}
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
