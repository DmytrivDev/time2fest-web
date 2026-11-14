'use client';

/**
 * Головна, ефір (S-HOME-LIVE, ІНВ 4.3; T081) — за макетами `Main`, `Desk-Home-Handover`, `Desk-Moment`, `Desk-Rate`,
 * `Desk-Cookies-Design` і телефонними `Phone-Home-Live`, `Phone-Home-Handover`, `Phone-Moment`,
 * `Phone-Rate`, `Phone-Cookies`, `Phone-Chat`, `Phone-Map-Card`.
 *
 * Десктоп: основна колонка — PlayerBlock (плеєр, підпис, рядок дій) · InFlowSlot (штамп, оцінка) · «Зараз і далі» + «Прогрес свята»; права колонка макета — чат «Світ»
 * (sticky); мапа поясів — на всю ширину під обома колонками (портал у `#page-wide`). Під відео при прокрутці нічого не плаває.
 * Телефон (зверху вниз): PlayerBlock (плеєр закріплений угорі) · InFlowSlot · вміст сторінки, що прокручується:
 * «Дивляться люди з N країн», «Зараз і далі» + прогрес, мапа поясів. Чат «Світ» — вікно
 * внизу (`ChatDock`): згорнуте «Розгорнути чат N нових» або розгорнуте під рядком часу.
 * «Перший ряд» прибрано (рішення власника 2026-11-12); на його місці — смуга тостів (`ToastStrip`): телефон — під липким
 * рядком часу, десктоп — під рядком дій плеєра, над штампом.
 *
 * Дані ефіру лише читаються з `useBroadcast()` (один `BroadcastController` на макет). Сторінка реєструє присутність
 * для штампа (`useStampGrant`), запускає імітатор чату й відкриває вікна моменту (`useMomentWindows`).
 * Чат сховано (FR-053): десктоп — колонки немає, пілюля «Показати чат N» в рядку назви поруч із таймером; на телефоні
 * «сховати» = згорнути вікно.
 *
 * Головне святкування (рішення власника 2026-11-13): поки воно не почалось — заглушка з кнопкою «Дивитися, що вже йде»,
 * якщо в поясі щось іде наживо: відкриває той самий список, що «Обрати трансляцію» (`useStreamPicker`; десктоп — на місці
 * чату, телефон — шторкою), вибір — ручний; у «Зараз і далі» його картка перша («Очікується»), дотик до неї
 * повертає плеєр до ефіру. Людина сама обрала іншу трансляцію поясу, а головне почалось — «Головне святкування почалось ·
 * Перемкнути» в рядку під відео (без автоматичного перемикання).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useLiveChat } from '@/components/chat/useLiveChat';
import { buildMapModel } from '@/lib/map/model';
import { NowNext } from '@/components/live/NowNext';
import { MomentInflow } from '@/components/live/MomentInflow';
import { StampBlock } from '@/components/live/StampBlock';
import { ToastStrip } from '@/components/toast/ToastStrip';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { ZoneMap } from '@/components/map/ZoneMap';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { RoomTray } from '@/components/room/RoomTray';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { WIDE_SLOT_ID } from '@/components/primitives/Panel';
import { useStreamPicker } from '@/components/live/ActionRow';
import { useChatColumn, useTabletPortrait } from '@/components/shell/OverlayManager';
import { useLiveData, useViewers } from '@/lib/api/hooks/live';
import { useChatRooms } from '@/lib/api/hooks/chat';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms, RoomId } from '@/lib/data/types';
import { formatClock, viewerTimeZone, viewerZoneLabel } from '@/lib/i18n/time';
import { festProgress, nowNextItems, scheduleNow } from '@/lib/live/homeData';
import { mainLiveLine, mainSourceOf, zoneHasLive } from '@/lib/engine/mainCelebration';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { useBroadcast } from '@/lib/player/BroadcastController';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { usePresence } from '@/lib/api/hooks/passport';
import { useNow } from '@/lib/time/TimeProvider';
import home from '@/components/live/home.module.css';
import { useHasPass, useSchedule } from '@/lib/api/hooks/auth';

const CHAT_ROOMS = ['world'] as const;
const PLAYER_TITLE_ID = 'player-title';
/** «Зараз і далі» (ціль посилань-пропусків). */
const NOW_NEXT_ID = 'now-next';

export { useChatLookup };

/** Краї «Прогресу свята»: «12:00 · Кірибаті» і «14:00 · 1 січня» за часом глядача. */
function progressEdges(data: Dataset): { startLabel?: string; endLabel?: string } {
  const first = data.zones[0];
  const last = data.zones[data.zones.length - 1];
  if (!first || !last) return {};
  const firstCity = data.citiesById.get(first.representativeCityId);
  const firstCountry = firstCity ? data.countriesByIso.get(firstCity.countryIso) : undefined;
  let date = '';
  try {
    date = new Intl.DateTimeFormat('uk', { day: 'numeric', month: 'long', timeZone: viewerTimeZone() }).format(last.midnightMs);
  } catch {
    date = '';
  }
  return {
    startLabel: `${formatClock(first.midnightMs)}${firstCountry ? ` · ${firstCountry.name.uk}` : ''}`,
    endLabel: `${formatClock(last.midnightMs)}${date ? ` · ${date}` : ''}`,
  };
}

function useNowNextData(now: Ms) {
  const schedule = useSchedule();
  const minute = Math.floor(now / 60_000) * 60_000;
  const data = useLiveData();
  const items = useMemo(() => nowNextItems(data, minute, schedule, { liveOthers: true, mainCards: true }), [data, minute, schedule]);
  const progress = useMemo(() => ({ ...festProgress(data, minute), ...progressEdges(data) }), [data, minute]);
  const zoneLabel = viewerZoneLabel();
  return { items, progress, zoneLabel };
}

function useMapData() {
  const mapModel = useMemo(() => buildMapModel(getData()), []);
  const viewers = useViewers();
  return { mapModel, viewers };
}

export function HomeLive() {
  const t = useTranslations('a11y');
  const tPlayer = useTranslations('player');
  const broadcast = useBroadcast();
  const { ready, phase, current, next, air, stayHere, watching, watch } = broadcast;
  const now = useNow();
  const chatColumn = useChatColumn();
  // Планшет-портрет (`Tab-P-New`, 2026-11-10): структура телефона, «Зараз і далі» — сіткою карток.
  const tabletPortrait = useTabletPortrait();
  const schedule = useSchedule();
  const eventId = current?.event.id ?? null;

  // Присутність для штампа: ефір показує подію поточного слота.
  usePresence(eventId ? { source: 'air', eventIds: [eventId] } : null);
  // Кімната «Країна» на головній — країна ефіру, що йде зараз (змінюється разом зі зміною ефіру).
  const airCountry = current?.event.countryIso ? getData().countriesByIso.get(current.event.countryIso) : undefined;
  const chatRooms = useMemo<RoomId[]>(
    () => (airCountry ? ['world', `country:${airCountry.iso}`] : [...CHAT_ROOMS]),
    [airCountry],
  );
  useChatRooms(chatRooms);
  useMomentWindows();
  // Пропозиція пасу (offer:show), «Потрібен пас» для кнопки графіка, стан введення для рушія.
  const passWindows = useOfferWindows();
  const hasPass = useHasPass();
  const getPass = useGetPass();

  const hint = useMemo(() => scheduleNow(getData(), schedule, current?.event ?? null), [schedule, current]);

  // Головне святкування ефіру (2026-11-13): кнопка на заглушці й рядок «почалось · Перемкнути».
  const player = useOptionalPlayer();
  const reduced = useReducedMotion();
  const data = useLiveData();
  const minute = Math.floor(now / 60_000) * 60_000;
  const airMidnight = current?.event.midnightMs ?? null;
  const liveInZone = useMemo(() => (airMidnight !== null && minute > 0 ? zoneHasLive(data, airMidnight, minute) : false), [data, airMidnight, minute]);
  // «Дивитися, що вже йде» — список трансляцій цієї півночі, як «Обрати трансляцію» (рішення власника 2026-11-13).
  const picker = useStreamPicker({ onToggleSchedule: passWindows.requestSchedule });
  const watchLive = picker.open;
  const mainSource = eventId ? mainSourceOf(data.chainsByEventId.get(eventId)) : null;
  const sel = player?.selection;
  const playingEvent = player?.eventId ? data.eventsById.get(player.eventId) : undefined;
  const mainLive =
    current && mainSource && air?.handoverAt != null
      ? mainLiveLine({
          now,
          main: { eventId: current.event.id, source: mainSource },
          midnightMs: current.event.midnightMs,
          playing: playingEvent && sel && sel.kind !== 'countdown-scene' ? { eventId: playingEvent.id, sourceId: sel.source.id, midnightMs: playingEvent.midnightMs } : null,
          manual: !!watching,
          stampHint: false, // рядок підказки про штамп віддає `PlayerBlock` (останні 60 с до півночі)
          handoverAt: air.handoverAt,
        })
      : false;
  const backToAir = useCallback(() => watch(null), [watch]);
  const city = current?.city?.name.uk;
  const { items, progress, zoneLabel } = useNowNextData(now);
  const { mapModel, viewers } = useMapData();
  const wideSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(WIDE_SLOT_ID) : null;
  const tChat = useTranslations('chat');
  const chat = useLiveChat({
    chatColumn,
    room: 'world',
    roomLabel: tChat('roomWorld'),
    panel: { country: airCountry ? { iso: airCountry.iso, name: airCountry.name.uk } : undefined, startInWorld: true },
  });
  const map = (
    // `id` — ціль «Перейти до мапи» і посилання-пропуску.
    <div id="zone-map">
      <ZoneMap {...mapModel} onToggleSchedule={passWindows.requestSchedule} />
    </div>
  );
  const nowNext = (layout: 'carousel' | 'stack' | 'grid') => (
    <NowNext
      items={items}
      zoneLabel={zoneLabel}
      layout={layout}
      progress={progress}
      mapHref={layout === 'carousel' ? undefined : '/countries/'}
      onToggleSchedule={passWindows.requestSchedule}
      scheduleLocked={!hasPass}
      onScheduleLocked={passWindows.openPassInfoBoard}
      onGetPass={() => getPass()}
      airEventId={eventId}
      id={NOW_NEXT_ID}
      onSelectAir={() => {
        // Картка головного святкування: плеєр — знову ефір (заглушка чи відео), сторінка — вгору до плеєра.
        watch(null);
        window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
      }}
    />
  );
  // Штамп (окремий блок) і вікна моменту (оцінка, пропозиції) — одразу під рядком дій плеєра.
  const inflow = <MomentInflow stamp={<StampBlock eventId={eventId} />} label={tPlayer('inFlowLabel')} />;

  return (
    <>
      <h1 className="sr-only">{city ? t('pageHeadingLive', { place: city }) : t('pageHeadingLive', { place: 'Time2Fest' })}</h1>
      <PlayerBlock
        mode="broadcast"
        ready={ready}
        phase={phase}
        current={current}
        next={next}
        airView={air?.view}
        onStayHere={stayHere}
        onToggleSchedule={passWindows.requestSchedule}
        scheduleHint={hint}
        titleId={PLAYER_TITLE_ID}
        watchers={viewers.length}
        stampHint
        captionAside={chat.showButton}
        dock={!chatColumn}
        // Смуга тостів (телефон) — під липким рядком часу (дошка `Phone-Toast-New`, 2026-11-12).
        belowBar={<ToastStrip variant="phone" />}
        onWatchLive={liveInZone ? watchLive : undefined}
        mainLive={mainLive && city ? { place: city, onSwitch: backToAir } : null}
      />

      {chatColumn ? (
        <div className={cn(home.column, 'pt-4')}>
          {/* Смуга тостів — одразу під рядком дій плеєра, над штампом і пропозиціями (дошка `Desk-Toast-New`). */}
          <ToastStrip variant="desk" />
          {inflow}
          <div className="mt-2">{nowNext('carousel')}</div>
          {chat.column}
          {wideSlot ? createPortal(map, wideSlot) : null}
          <RoomTray />
        </div>
      ) : (
        <>
          <div className={cn("px-4", home.phoneInflow)}>{inflow}</div>
          <div className={home.events}>
            {/* Чесне число (2026-11-12): без даних присутності (робоча збірка) рядка немає. */}
            {viewers.length ? (
              <p className={home.watchers}>
                <Icon name="globe" size={14} strokeWidth={2} />
                {tPlayer('watchersShort', { count: viewers.length })}
              </p>
            ) : null}
            {nowNext(tabletPortrait ? 'grid' : 'stack')}
            {map}
          </div>
          {chat.dock}
        </>
      )}
    </>
  );
}
