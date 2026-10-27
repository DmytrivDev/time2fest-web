'use client';

/**
 * Головна, ефір (S-HOME-LIVE, ІНВ 4.3; T081) — за макетами `Main`, `Desk-Home-Handover`, `Desk-Moment`, `Desk-Rate`,
 * `Desk-Cookies(-Wide)` і телефонними `Phone-Home-Live`, `Phone-Home-Handover`, `Phone-Moment`,
 * `Phone-Rate`, `Phone-Cookies`, `Phone-Chat`, `Phone-Map-Card`.
 *
 * Десктоп: основна колонка — PlayerBlock (плеєр, підпис, рядок дій) · InFlowSlot (штамп, оцінка; cookies смугою,
 * коли вільного кута немає) · «Перший ряд» · «Зараз і далі» + «Прогрес свята»; права колонка макета — чат «Світ»
 * (sticky); мапа поясів — на всю ширину під обома колонками (портал у `#page-wide`). Під відео при прокрутці нічого не плаває.
 * Телефон (зверху вниз): PlayerBlock (плеєр закріплений угорі) · InFlowSlot · вкладки «Події | Чат»: «Події» —
 * «Дивляться люди з N країн», «Перший ряд» (згортається), «Зараз і далі» + прогрес, мапа поясів; «Чат» — кімната «Світ».
 *
 * Дані ефіру лише читаються з `useBroadcast()` (один `BroadcastController` на макет). Сторінка реєструє присутність
 * для штампа (`useStampGrant`), запускає імітатор чату й відкриває вікна моменту (`useMomentWindows`).
 * Чат сховано (FR-053): десктоп — колонки немає, «Показати чат N» праворуч від таймера; телефон — вкладок немає,
 * «Відкрити чат N».
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { FirstRowChatRowConnected, FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { buildMapModel } from '@/components/live/MapModel';
import { NowNext } from '@/components/live/NowNext';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { ZoneMap } from '@/components/live/ZoneMap';
import { CookieInflow } from '@/components/offers/CookieLayer';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { CHAT_SLOT_ID, WIDE_SLOT_ID } from '@/components/primitives/Panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { OverlayInFlowOutlet, useChatColumn } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, Ms } from '@/lib/data/types';
import { firstRowEventFor } from '@/lib/firstrow/pick';
import { formatClock, viewerTimeZone } from '@/lib/i18n/time';
import { festProgress, nowNextItems, scheduleNow } from '@/lib/live/homeData';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { simulatedViewers } from '@/lib/presence/viewers';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { formatCount } from '@/stores/chat';
import { useChatFeed } from '@/lib/chat-sim/store';
import home from './home.module.css';

const CHAT_ROOMS = ['world'] as const;
const PLAYER_TITLE_ID = 'player-title';

export { useChatLookup };

/** Модуль «Перший ряд» (C6/C7/C8, US5): подія ефіру з «Першим рядом» або найближча з відкритим продажем. */
function FirstRowSection({ place, now, className }: { place: AirPlace; now: Ms; className?: string }) {
  return <FirstRowModule event={firstRowEventFor(getData(), now, place.event)} className={className} />;
}

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
  const items = useMemo(() => nowNextItems(data, minute, schedule), [data, minute, schedule]);
  const progress = useMemo(() => ({ ...festProgress(data, minute), ...progressEdges(data) }), [data, minute]);
  const zoneLabel = viewerTimeZone().split('/').pop()?.replace(/_/g, ' ') ?? '';
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
  const tNav = useTranslations('nav');
  const tPlayer = useTranslations('player');
  const broadcast = useBroadcast();
  const { ready, phase, current, next, air, stayHere } = broadcast;
  const now = useNow();
  const chatColumn = useChatColumn();
  const schedule = useGuestStore((s) => s.schedule);
  const eventId = current?.event.id ?? null;

  // Присутність для штампа: ефір показує подію поточного слота.
  useStampGrant(eventId ? { source: 'air', eventIds: [eventId] } : null);
  useChatSimulator(CHAT_ROOMS);
  useMomentWindows(eventId);
  // Пропозиції пасу й чайових (offer:show), «Потрібен пас» для кнопки графіка, стан введення для рушія.
  const passWindows = useOfferWindows();

  const hint = useMemo(() => scheduleNow(getData(), schedule, current?.event ?? null), [schedule, current]);
  const city = current?.city?.name.uk;
  const { items, progress, zoneLabel } = useNowNextData(now);
  const { mapModel, viewers } = useMapData();
  // Лічильник на вкладці «Чат» (макет «Чат 99+»): повідомлення «Світу», поки відкрито «Події».
  const roomCount = useChatFeed((st) => {
    let n = 0;
    for (const msg of st.rooms.world ?? []) if (!msg.author?.isMine && msg.kind !== 'system') n += 1;
    return n;
  });

  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const wideSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(WIDE_SLOT_ID) : null;
  const vis = useChatVisibility();
  const [tab, setTab] = useState('events');
  // Телефон, відкрита вкладка «Чат» (`Phone-Chat`): підпис одним рядком, «Перший ряд» рядком над вкладками.
  const phoneChat = !chatColumn && !vis.hidden && tab === 'chat';
  const panel = (className?: string) => (
    <ChatPanel
      eventId={eventId}
      cityName={city}
      onHide={() => {
        vis.hide();
        setTab('events');
      }}
      onToEvents={() => setTab('events')}
      className={className}
    />
  );

  const map = (
    // `id` — ціль «Перейти до мапи» і посилання-пропуску.
    <div id="zone-map">
      <ZoneMap {...mapModel} viewers={viewers} airCityId={current?.city?.id} />
    </div>
  );
  const nowNext = (layout: 'carousel' | 'stack') => (
    <NowNext
      items={items}
      zoneLabel={zoneLabel}
      layout={layout}
      progress={progress}
      mapHref={layout === 'stack' ? '#zone-map' : undefined}
      onToggleSchedule={passWindows.requestSchedule}
      airEventId={eventId}
    />
  );
  const showChatButton = vis.hidden ? (
    <ChatHiddenButton
      placement={chatColumn ? 'desktop' : 'phone'}
      room="world"
      onShow={() => {
        vis.show();
        setTab('chat');
      }}
    />
  ) : null;
  // Вікна моменту (штамп, оцінка) і cookies смугою — одразу під рядком дій плеєра.
  const inflow = (
    <>
      <CookieInflow />
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
        scheduleHint={hint}
        titleId={PLAYER_TITLE_ID}
        watchers={viewers.length}
        captionAside={chatColumn ? showChatButton : null}
        bar={phoneChat}
      />

      {chatColumn ? (
        <div className={cn(home.column, 'pt-4')}>
          {inflow}
          {current && ready ? <FirstRowSection place={current} now={now} /> : null}
          <div className="mt-2">{nowNext('carousel')}</div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
          {wideSlot ? createPortal(map, wideSlot) : null}
        </div>
      ) : (
        <>
          {vis.hidden ? <div className="px-4 pb-3">{showChatButton}</div> : null}
          <div className={cn("px-4", home.phoneInflow)}>{inflow}</div>
          {phoneChat && current && ready ? (
            <FirstRowChatRowConnected event={firstRowEventFor(getData(), now, current.event)} onClick={() => setTab('events')} />
          ) : null}
          <Tabs value={vis.hidden ? 'events' : tab} onValueChange={setTab} className={home.tabs}>
            {vis.hidden ? null : (
              <TabsList>
                <TabsTrigger value="events">{tNav('events')}</TabsTrigger>
                <TabsTrigger value="chat">
                  {tNav('chat')}
                  {tab !== 'chat' && roomCount > 0 ? (
                    <span aria-hidden="true" className="inline-flex h-4.5 items-center rounded-full bg-surface-raised px-1.5 text-label-badge-chat font-semibold text-text">
                      {formatCount(roomCount)}
                    </span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
            )}
            {/* forceMount: стіна «Першого ряду» й мапа живуть і поки відкрито «Чат» (загоряння опівночі синхронне). */}
            <TabsContent value="events" forceMount className={home.events}>
              <p className={home.watchers}>
                <Icon name="globe" size={14} strokeWidth={2} />
                {tPlayer('watchersShort', { count: viewers.length })}
              </p>
              {current && ready ? <FirstRowSection place={current} now={now} /> : null}
              {nowNext('stack')}
              {map}
            </TabsContent>
            <TabsContent value="chat">
              {panel(home.phoneChat)}
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  );
}
