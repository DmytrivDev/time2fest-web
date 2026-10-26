'use client';

/**
 * Головна, ефір (S-HOME-LIVE, ІНВ 4.3; T081).
 *
 * Телефон (зверху вниз): PlayerBlock(`broadcast`, плеєр закріплений угорі) · «Перший ряд» (стіна) · InFlowSlot ·
 * вкладки «Події | Чат»: «Події» — «Як святкувати» (−15…+10 хв), «Зараз і далі» + прогрес свята, країни поясу,
 * слайдер основних святкувань, мапа поясів; «Чат» — кімната «Світ».
 * Десктоп: ліва колонка — PlayerBlock · «Перший ряд» · InFlowSlot · «Як святкувати» · «Зараз і далі» · країни поясу ·
 * слайдер · мапа; права колонка макета — чат «Світ» (sticky); мініплеєр при прокрутці.
 *
 * Дані ефіру лише читаються з `useBroadcast()` (один `BroadcastController` на макет). Сторінка реєструє присутність
 * для штампа (`useStampGrant`), запускає імітатор чату й відкриває вікна моменту (`useMomentWindows`).
 * Чат — `ChatPanel` («Світ», учасникам ще «Перший ряд»). Сховано (FR-053): десктоп — колонки немає, біля плеєра
 * «Показати чат N»; телефон — вкладок немає, «Відкрити чат N».
 */
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { CelebrationsSlider } from '@/components/live/CelebrationsSlider';
import { CountryChips } from '@/components/live/CountryChips';
import { FirstRowChatRowConnected, FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { HowToCard } from '@/components/live/HowToCard';
import { buildMapModel } from '@/components/live/MapModel';
import { NowNext } from '@/components/live/NowNext';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { CookieInflow } from '@/components/offers/CookieLayer';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { ZoneMap } from '@/components/live/ZoneMap';
import { ConnectedMiniPlayer } from '@/components/player/MiniPlayer';
import { PlayerBlock } from '@/components/player/PlayerBlock';
import { cn } from '@/components/primitives/cn';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { OverlayInFlowOutlet, useChatColumn } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { HOWTO_BEFORE } from '@/lib/engine/config';
import { firstRowEventFor } from '@/lib/firstrow/pick';
import { viewerTimeZone } from '@/lib/i18n/time';
import { festProgress, mainCelebrations, nowNextItems, scheduleNow, zoneCountries } from '@/lib/live/homeData';
import { useBroadcast, type AirPlace } from '@/lib/player/BroadcastController';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { eventTitle } from './Caption';
import styles from './live.module.css';

const CHAT_ROOMS = ['world'] as const;
/** «Як святкувати» біля плеєра: −15 хв … +10 хв від півночі (C20, компактна версія). */
const HOWTO_AFTER = 10 * 60_000;
const PLAYER_TITLE_ID = 'player-title';

export { useChatLookup };

/** Модуль «Перший ряд» (C6/C7/C8, US5): подія ефіру з «Першим рядом» або найближча з відкритим продажем. */
function FirstRowSection({ place, now }: { place: AirPlace; now: Ms }) {
  return <FirstRowModule event={firstRowEventFor(getData(), now, place.event)} className={styles.pad} />;
}

function EventsBlocks({
  now,
  layout,
  howTo,
  onToggleSchedule,
}: {
  now: Ms;
  layout: 'carousel' | 'stack';
  howTo: boolean;
  onToggleSchedule?: (eventId: string, next: boolean) => void;
}) {
  const tNav = useTranslations('nav');
  const { current } = useBroadcast();
  const schedule = useGuestStore((s) => s.schedule);
  const minute = Math.floor(now / 60_000) * 60_000;
  const data = getData();
  const items = useMemo(() => nowNextItems(data, minute, schedule), [data, minute, schedule]);
  const progress = useMemo(() => festProgress(data, minute), [data, minute]);
  const celebrations = useMemo(() => mainCelebrations(data, minute, schedule), [data, minute, schedule]);
  const chips = useMemo(() => (current ? zoneCountries(data, current.event.zoneId) : []), [data, current]);
  const mapModel = useMemo(() => buildMapModel(data), [data]);
  const zoneLabel = viewerTimeZone().split('/').pop()?.replace(/_/g, ' ') ?? '';

  return (
    <div className="flex flex-col gap-8 pb-8">
      {howTo && current?.country ? (
        <HowToCard country={current.country.name.uk} traditions={current.country.howTo.traditions} variant="compact" className={styles.pad} />
      ) : null}
      <NowNext items={items} zoneLabel={zoneLabel} layout={layout} progress={progress} mapHref="#zone-map" className={styles.pad} />
      {chips.length ? (
        <section aria-labelledby="zone-countries-title" className={cn(styles.pad, 'flex flex-col gap-3')}>
          <h2 id="zone-countries-title" className="text-headline-sm text-text">
            {tNav('countriesOfZone')}
          </h2>
          <CountryChips countries={chips} selectedIso={current?.country?.iso} />
        </section>
      ) : null}
      <CelebrationsSlider items={celebrations} onToggleSchedule={onToggleSchedule} className={styles.pad} />
      {/* C18 мапа поясів (T080); `id` — ціль «Перейти до мапи». */}
      <div id="zone-map" className={styles.pad}>
        <ZoneMap {...mapModel} />
      </div>
    </div>
  );
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
  const t0 = current?.event.midnightMs;
  const howTo = t0 !== undefined && now >= t0 - HOWTO_BEFORE && now < t0 + HOWTO_AFTER;
  const city = current?.city?.name.uk;

  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const vis = useChatVisibility();
  const [tab, setTab] = useState('events');
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
      />
      {current && ready ? <FirstRowSection place={current} now={now} /> : null}
      {vis.hidden ? (
        <div className={cn(styles.pad, 'pt-3')}>
          <ChatHiddenButton
            placement={chatColumn ? 'desktop' : 'phone'}
            room="world"
            onShow={() => {
              vis.show();
              setTab('chat');
            }}
          />
        </div>
      ) : null}
      {/* Cookies смугою на місці штампа, коли вільного кута немає (чат сховано). */}
      <div className={styles.pad}>
        <CookieInflow />
      </div>
      <div data-moment-slot="" className={styles.pad}>
        <OverlayInFlowOutlet label={tPlayer('inFlowLabel')} />
      </div>

      {chatColumn ? (
        <>
          <div className="pt-6">
            <EventsBlocks now={now} layout="carousel" howTo={howTo} onToggleSchedule={passWindows.requestSchedule} />
          </div>
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
        </>
      ) : (
        <Tabs value={vis.hidden ? 'events' : tab} onValueChange={setTab} className="pt-2">
          {vis.hidden ? null : (
            <TabsList>
              <TabsTrigger value="events">{tNav('events')}</TabsTrigger>
              <TabsTrigger value="chat">{tNav('chat')}</TabsTrigger>
            </TabsList>
          )}
          <TabsContent value="events" className="pt-4">
            <EventsBlocks now={now} layout="stack" howTo={howTo} onToggleSchedule={passWindows.requestSchedule} />
          </TabsContent>
          <TabsContent value="chat">
            {current && ready ? (
              <FirstRowChatRowConnected event={firstRowEventFor(getData(), now, current.event)} onClick={() => setTab('events')} className={styles.pad} />
            ) : null}
            {panel(styles.phoneChat)}
          </TabsContent>
        </Tabs>
      )}

      <ConnectedMiniPlayer title={eventTitle(current?.city)} />
    </>
  );
}
