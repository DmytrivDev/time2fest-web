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
import { Suspense, useCallback, useMemo } from 'react';
import { useLiveChat } from '@/components/chat/hooks/useLiveChat';
import { CountryHeader } from '@/components/country/CountryHeader';
import { MomentInflow } from '@/components/live/MomentInflow';
import { StampBlock } from '@/components/stamp/StampBlock';
import { ToastStrip } from '@/components/toast/ToastStrip';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { RoomTray } from '@/components/room/RoomTray';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useLiveData, usePeopleNow } from '@/lib/api/hooks/live';
import { useChatRooms } from '@/lib/api/hooks/chat';
import type { RoomId } from '@/lib/data/types';
import { eventStatus, stampGrantedAt } from '@time2fest/rules/time';
import { zoneHasLive } from '@/lib/engine/mainCelebration';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { scrollToBlock } from './scrollToBlock';
import { useStreamPicker } from '@/components/live/ActionRow';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { useRatingBoard } from '@/lib/api/hooks/rating';
import { usePresence } from '@/lib/api/hooks/passport';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { eventTitle } from '@/components/live/Caption';
import home from '@/components/live/home.module.css';
import styles from '@/components/live/live.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';
import { CountryEvents, NOW_NEXT_ID, STREAMS_ID } from './CountryEvents';
import { zoneOption } from './countryHelpers';
import { FocusFromUrl } from './FocusFromUrl';
import { useCountryPlayer } from './useCountryPlayer';
import { useCountryStreams } from './useCountryStreams';

const PLAYER_TITLE_ID = 'player-title';

export function CountryLive({ iso }: { iso: string }) {
  const tc = useTranslations('country');
  const tHead = useTranslations('country.header');
  const tChat = useTranslations('chat');
  const tPlayer = useTranslations('player');
  const data = useLiveData();
  const country = data.countriesByIso.get(iso)!;
  const chatColumn = useChatColumn();
  const ready = useTimeReady();
  const now = useNow();
  const known = ready && now > 0;
  const minute = Math.floor(now / 60_000) * 60_000;

  const {
    zones, zoneId, mainEvent, playing, playingOurs, countdown, shownEvent, current, currentSource, currentStreamId,
    next, phase, expected, select, changeZone, setMode, addToRoom, watchAgain, switchToMain, mainLive, mainCity, onUrlFocus,
  } = useCountryPlayer({ data, iso, country, now, known, minute });

  // Присутність для штампа: подія, яку сторінка показує зараз (FR-060, `presenceSource: 'country'`): трансляція, що грає
  // (своя країна чи обрана вручну), інакше головна подія вибраного поясу. Штамп іде країні того, що дивляться (2026-11-16).
  const presenceIds = useMemo(() => (shownEvent?.id ? [shownEvent.id] : []), [shownEvent]);
  usePresence(presenceIds.length ? { source: 'country', eventIds: presenceIds } : null);
  useChatRooms(useMemo(() => ['world', `country:${iso}`] as RoomId[], [iso]));
  useMomentWindows();
  // Пропозиція пасу (offer:show) і стан введення для рушія пропозицій.
  const passWindows = useOfferWindows();
  const hasPass = useHasPass();
  const getPass = useGetPass();

  const { countryRows, streams, nbFilter, nbRows, nbCountdown, nbScheduleCount, changeNbFilter, pickerRows } =
    useCountryStreams({ data, iso, zoneId, minute, mainEvent, select, addToRoom, hasPass, passWindows });
  const recording = !!shownEvent && known && eventStatus(now, shownEvent) === 'recording';
  const after = !!mainEvent && known && now >= stampGrantedAt(mainEvent.midnightMs);

  // Графік: запис «країна + пояс» (той самий, що в календариків головної); без пасу — вікно пасу.
  const scheduleIds = useMemo(
    () => (mainEvent ? countryZoneEvents(mainEvent.id) : []),
    [mainEvent],
  );
  const mySchedule = useSchedule();
  const inSchedule = scheduleIds.some((id) => mySchedule.includes(id));
  const toggleSchedule = useCallback(() => {
    if (mainEvent) passWindows.requestSchedule(mainEvent.id);
  }, [mainEvent, passWindows]);
  const people = usePeopleNow();

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
  const { state: ratingBoardState } = useRatingBoard(minute);
  const ratingRow = useMemo(
    () => (after && mainEvent ? ratingBoardState.rows.find((r) => r.eventId === mainEvent.id) : undefined),
    [after, mainEvent, ratingBoardState],
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
  const zoneCountries = useMemo(
    () => (zoneId ? data.countries.filter((c) => c.zoneIds.includes(zoneId)).length : 0),
    [data, zoneId],
  );

  const events = (
    <CountryEvents
      data={data}
      country={country}
      minute={minute}
      chatColumn={chatColumn}
      mainEvent={mainEvent}
      zoneId={zoneId}
      zone={zone}
      zoneOptions={zoneOptions}
      recording={recording}
      liveNow={liveNow}
      countdown={countdown}
      countryRows={countryRows}
      currentStreamId={currentStreamId}
      currentRow={currentRow}
      select={select}
      addToRoom={addToRoom}
      nbRows={nbRows}
      nbCountdown={nbCountdown}
      nbFilter={nbFilter}
      changeNbFilter={changeNbFilter}
      nbScheduleCount={nbScheduleCount}
      zoneCountries={zoneCountries}
      hasPass={hasPass}
      passWindows={passWindows}
      getPass={getPass}
    />
  );

  const chat = useLiveChat({
    chatColumn,
    room: `country:${iso}`,
    roomLabel: tChat('roomCountryPicker', { country: country.name.uk }),
    panel: { country: { iso, name: country.name.uk } },
  });
  // Штамп (окремий блок) і вікна моменту (оцінка, пропозиції) — одразу під рядком дій плеєра, як на головній.
  const inflow = (
    <MomentInflow stamp={<StampBlock eventId={mainEvent?.id ?? null} permanent />} label={tPlayer('inFlowLabel')} />
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
        watchers={people}
        stampHint
        captionAside={chat.showButton}
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
          <div className={home.sectionTop}>{events}</div>
          {chat.column}
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
            {people ? (
              <p className={cn(home.watchers, home.watchersPhone)}>
                <Icon name="globe" size={14} strokeWidth={2} />
                {tPlayer('peopleNowShort', { count: people })}
              </p>
            ) : null}
          </div>
          <div className={home.sectionTop}>{events}</div>
          {chat.dock}
        </>
      )}
    </>
  );
}
