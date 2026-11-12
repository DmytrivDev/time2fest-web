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
 * «Перший ряд» прибрано (рішення власника 2026-11-12); на його місці буде смуга тостів — місця позначено `TOAST-STRIP-SLOT`.
 *
 * Дані ефіру лише читаються з `useBroadcast()` (один `BroadcastController` на макет). Сторінка реєструє присутність
 * для штампа (`useStampGrant`), запускає імітатор чату й відкриває вікна моменту (`useMomentWindows`).
 * Чат сховано (FR-053): десктоп — колонки немає, пілюля «Показати чат N» в рядку назви поруч із таймером; на телефоні
 * «сховати» = згорнути вікно.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { buildMapModel } from '@/components/live/MapModel';
import { NowNext } from '@/components/live/NowNext';
import { StampBlock } from '@/components/live/StampBlock';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { ZoneMap } from '@/components/live/ZoneMap';
import { useGetPass } from '@/components/pass/PassWindow';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { RoomTray } from '@/components/room/RoomTray';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { CHAT_SLOT_ID, WIDE_SLOT_ID } from '@/components/primitives/Panel';
import { OverlayInFlowOutlet, useChatColumn, useTabletPortrait } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms, RoomId } from '@/lib/data/types';
import { formatClock, viewerTimeZone, viewerZoneLabel } from '@/lib/i18n/time';
import { festProgress, nowNextItems, scheduleNow } from '@/lib/live/homeData';
import { useBroadcast } from '@/lib/player/BroadcastController';
import { simulatedViewers } from '@/lib/presence/viewers';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import home from './home.module.css';

const CHAT_ROOMS = ['world'] as const;
const PLAYER_TITLE_ID = 'player-title';

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
  const schedule = useGuestStore((s) => s.schedule);
  const minute = Math.floor(now / 60_000) * 60_000;
  const data = getData();
  const items = useMemo(() => nowNextItems(data, minute, schedule, { liveOthers: true }), [data, minute, schedule]);
  const progress = useMemo(() => ({ ...festProgress(data, minute), ...progressEdges(data) }), [data, minute]);
  const zoneLabel = viewerZoneLabel();
  return { items, progress, zoneLabel };
}

function useMapData() {
  const data = getData();
  const mapModel = useMemo(() => buildMapModel(data), [data]);
  const viewers = useMemo(() => simulatedViewers(data), [data]);
  return { mapModel, viewers };
}

export function HomeLive() {
  const t = useTranslations('a11y');
  const tPlayer = useTranslations('player');
  const broadcast = useBroadcast();
  const { ready, phase, current, next, air, stayHere } = broadcast;
  const now = useNow();
  const chatColumn = useChatColumn();
  // Планшет-портрет (`Tab-P-New`, 2026-11-10): структура телефона, «Зараз і далі» — сіткою карток.
  const tabletPortrait = useTabletPortrait();
  const schedule = useGuestStore((s) => s.schedule);
  const eventId = current?.event.id ?? null;

  // Присутність для штампа: ефір показує подію поточного слота.
  useStampGrant(eventId ? { source: 'air', eventIds: [eventId] } : null);
  // Кімната «Країна» на головній — країна ефіру, що йде зараз (змінюється разом зі зміною ефіру).
  const airCountry = current?.event.countryIso ? getData().countriesByIso.get(current.event.countryIso) : undefined;
  const chatRooms = useMemo<RoomId[]>(
    () => (airCountry ? ['world', `country:${airCountry.iso}`] : [...CHAT_ROOMS]),
    [airCountry],
  );
  useChatSimulator(chatRooms);
  useMomentWindows();
  // Пропозиції пасу й чайових (offer:show), «Потрібен пас» для кнопки графіка, стан введення для рушія.
  const passWindows = useOfferWindows();
  const hasPass = useGuestStore((s) => s.hasPass);
  const getPass = useGetPass();

  const hint = useMemo(() => scheduleNow(getData(), schedule, current?.event ?? null), [schedule, current]);
  const city = current?.city?.name.uk;
  const { items, progress, zoneLabel } = useNowNextData(now);
  const { mapModel, viewers } = useMapData();
  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const wideSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(WIDE_SLOT_ID) : null;
  const vis = useChatVisibility();
  const tChat = useTranslations('chat');
  const { collapse } = useChatDockControls();
  const panel = (className?: string) => (
    <ChatPanel
      country={airCountry ? { iso: airCountry.iso, name: airCountry.name.uk } : undefined}
      startInWorld
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );
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
    />
  );
  const showChatButton = chatColumn && vis.hidden ? (
    <ChatHiddenButton room="world" onShow={vis.show} />
  ) : null;
  // Штамп (окремий блок) і вікна моменту (оцінка, пропозиції) — одразу під рядком дій плеєра.
  const inflow = (
    <>
      <StampBlock eventId={eventId} />
      <OfferBlock />
      <div data-moment-slot="">
        <OverlayInFlowOutlet label={tPlayer('inFlowLabel')} />
      </div>
    </>
  );

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
        captionAside={showChatButton}
        dock={!chatColumn}
        // TOAST-STRIP-SLOT (телефон): смуга тостів — під липким рядком часу (`belowBar`). Поки нічого.
      />

      {chatColumn ? (
        <div className={cn(home.column, 'pt-4')}>
          {inflow}
          {/* TOAST-STRIP-SLOT (десктоп): смуга тостів — тут, під штампом і пропозиціями, над «Зараз і далі». */}
          <div className="mt-2">{nowNext('carousel')}</div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
          {wideSlot ? createPortal(map, wideSlot) : null}
          <RoomTray />
        </div>
      ) : (
        <>
          <div className={cn("px-4", home.phoneInflow)}>{inflow}</div>
          <div className={home.events}>
            <p className={home.watchers}>
              <Icon name="globe" size={14} strokeWidth={2} />
              {tPlayer('watchersShort', { count: viewers.length })}
            </p>
            {nowNext(tabletPortrait ? 'grid' : 'stack')}
            {map}
          </div>
          <ChatDock room="world" roomLabel={tChat('roomWorld')}>
            {panel('min-h-0 flex-1')}
          </ChatDock>
        </>
      )}
    </>
  );
}
