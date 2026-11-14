/**
 * Пульт сторінки країни: вибір поясу, фокус з адреси, ланцюжок плеєра, режим «Відлік», ручний вибір трансляції,
 * «Подивитися північ ще раз», «Головне святкування почалось · Перемкнути». Виокремлено з `CountryLive.tsx` (WP-F);
 * сторінка сама НЕ переходить за ефіром (FR-024) — ланцюжок задається лише двічі (див. шапку `CountryLive.tsx`).
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAddToRoom } from '@/components/room/hooks/useRoomViewport';
import type { Country, Dataset, Ms, ScheduledEvent } from '@/lib/data/types';
import { captionPhase } from '@/lib/engine/captionPhase';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { mainLiveLine, mainSourceOf } from '@/lib/engine/mainCelebration';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { countryMainEvent, countryZones, defaultZoneId, type StreamRowData } from '@/lib/live/countryData';
import { countryHref } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import type { PlayerSource } from '@/lib/player/types';
import { countryChainInput, countryFocusFrom, nextAfter, placeOf, scrollToPlayer, type CountryFocus } from './countryHelpers';

interface Args {
  data: Dataset;
  iso: string;
  country: Country;
  now: Ms;
  known: boolean;
  minute: Ms;
}

export function useCountryPlayer({ data, iso, country, now, known, minute }: Args) {
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
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
    if (ev) actions.setChain(countryChainInput(data, ev.id));
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
    if (target && (player?.eventId !== target || focus.sourceId)) actions.setChain(countryChainInput(data, target, focus.sourceId ?? undefined));
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
      actions?.setChain(countryChainInput(data, row.eventId, row.id));
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
      if (ev) actions?.setChain(countryChainInput(data, ev.id));
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
        on ? { eventId: mainEvent.id, sources: [] } : countryChainInput(data, mainEvent.id),
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
    actions?.setChain(countryChainInput(data, mainEvent.id));
  }, [actions, data, mainEvent]);
  const mainCity = mainEvent ? (data.citiesById.get(mainEvent.cityId)?.name.uk ?? country.name.uk) : '';

  return {
    player,
    actions,
    zones,
    zoneId,
    mainEvent,
    pickedEventId,
    manual,
    playing,
    playingOurs,
    countdown,
    shownEvent,
    current,
    currentSource,
    currentStreamId,
    next,
    phase,
    expected,
    select,
    changeZone,
    setMode,
    addToRoom,
    watchAgain,
    switchToMain,
    onUrlFocus,
    mainLive,
    mainCity,
  };
}
