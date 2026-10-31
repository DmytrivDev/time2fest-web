'use client';

/**
 * Зв’язувальний модуль «Перший ряд» (C6 + C7 + C8; T116): однаковий на головній, сторінці країни й у кімнаті.
 * - Місця імітуються (`lib/firstrow/seatsSim`), стан і ціна — `firstRowView`; утримання, оплата — `controller`.
 * - «Зайняти місце» → O-FIRST-ROW (`accent`, coral; звук стає нейтральним); «Що входить» → O-FIRST-ROW-INFO і «Ще є місця» →
 *   O-FIRST-ROW-MORE — на десктопі на місці чату, на телефоні шторкою (рішення 2026-10-31).
 * - Кнопка «Зайняти місце» tonal, поки на сторінці коралова кнопка звуку (ІНВ 5.3).
 * - Ефекти: «час утримання вийшов» при відкритій формі, підтвердження «очікування», привітання гостя-учасника
 *   в чаті на «+15 с» (синхронно зі стіною).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useChatDockControls } from '@/components/chat/ChatDock';
import { useChatDock } from '@/stores/chatDock';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { useOpenMyEmotion } from '@/components/windows/Emoji';
import { FirstRowInfo } from '@/components/windows/FirstRowInfo';
import { FirstRowMore } from '@/components/windows/FirstRowMore';
import { FirstRowWindow } from '@/components/windows/FirstRowWindow';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { useChatFeed } from '@/lib/chat-sim/store';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { HANDOVER_AFTER, STAMP_DELAY } from '@/lib/engine/config';
import { PENDING_CONFIRM_MS } from '@/lib/firstrow/pay';
import { otherOpenRows } from '@/lib/firstrow/pick';
import { useCoralWindowOpen } from '@/lib/overlay/coral';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useFirstRowStore } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import {
  blockingEvent,
  confirmPayment,
  expireHold,
  FIRST_ROW_INFO_ID,
  FIRST_ROW_MORE_ID,
  FIRST_ROW_WINDOW_ID,
  guestGreetingMessages,
  openForm,
  seatJoinedMessages,
  snapshot,
  type FirstRowEvent,
} from './controller';
import { FirstRowChatRow, FirstRowStrip } from './FirstRowStrip';
import { useOpenParticipant } from './useOpenParticipant';
import type { FirstRowMoreRow } from './types';

export interface FirstRowModuleProps {
  event: FirstRowEvent | null;
  /** Рівень заголовка модуля. */
  headingLevel?: 2 | 3;
  /** Телефон, головна: смуга під липким рядком плеєра, спочатку згорнута (`Phone-Chat-Dock`). */
  dockBar?: boolean;
  className?: string;
}

function cityOf(cityId: string): string {
  return getData().citiesById.get(cityId)?.name.uk ?? '';
}

/** Стан вікна покупки для шапки — так само, як його визначає `FirstRowWindow`. */
function useSeatPhase(event: FirstRowEvent) {
  const flow = useFirstRowStore((st) => (st.flow?.eventId === event.id ? st.flow : null));
  const seat = useGuestStore((st) => st.firstRow[event.id]?.seat);
  const phase = flow?.phase ?? (seat !== undefined ? 'success' : 'form');
  return { phase, seat };
}

/**
 * Шапка вікна O-FIRST-ROW / O-PAY: жовтий надзаголовок «Перший ряд» із кріслом і місто рядком нижче; «Оплату підтверджено» — жовтий
 * рядок 13/700 з галочкою; «Змінити напис чи емоцію» — білий заголовок; «Останнє місце щойно зайняли» — лише «×»
 * (заголовок у тілі, тут — для зчитувача).
 */
function SeatTitle({ event, city }: { event: FirstRowEvent; city: string }) {
  const t = useTranslations('firstRow');
  const { phase, seat } = useSeatPhase(event);
  // Надзаголовок (13/700, жовтий) стоїть на одній лінії з «×»: блок 32 px під відступом 6 px — центр на висоті центру «×».
  const eyebrow = 'flex h-8 items-center gap-1.5 text-caption font-bold text-highlight';
  if (phase === 'success' && seat !== undefined) {
    return (
      <span className={eyebrow}>
        <Icon name="check" size={16} strokeWidth={2.2} className="shrink-0" />
        {t('success.title')}
      </span>
    );
  }
  if (phase === 'edit' && seat !== undefined) return <span className="text-text">{t('edit.title')}</span>;
  if (phase === 'soldout') return <span className="sr-only">{t('heading', { city })}</span>;
  // Варіант А (рішення 2026-10-29): «ПЕРШИЙ РЯД» надзаголовком, місто окремим рядком 16/700 — без переносу всередині назви.
  return (
    <>
      <span className={cn(eyebrow, 'uppercase tracking-wide')}>
        <Icon name="seat" size={16} strokeWidth={2} className="shrink-0" />
        {t('title')}
      </span>
      <span className="sr-only"> · </span>
      <span className="block truncate text-body-strong font-bold text-text">{city}</span>
    </>
  );
}

/**
 * Підрядок шапки: «Північ о 02:00 за вашим часом · лишилось 2 з 10» (оновлюється разом зі стіною; місце, яке тримаємо
 * для людини, рахуємо вільним — інакше «лишилось 0» над її ж формою); у «Змінити напис» — «Місце 9 · Перший ряд · Лондон».
 */
function SeatSubline({ event, city }: { event: FirstRowEvent; city: string }) {
  const t = useTranslations('firstRow');
  const now = useNow();
  const reduced = useReducedMotion();
  const { phase, seat } = useSeatPhase(event);
  const { view } = snapshot(event, now, { reducedMotion: reduced });
  if ((phase === 'success' && seat !== undefined) || phase === 'soldout') return null;
  if (phase === 'edit' && seat !== undefined) return <>{t('edit.seat', { n: seat, city })}</>;
  return (
    <>
      {t('midnightAt', { time: formatClock(event.midnightMs) })} ·{' '}
      <span className="whitespace-nowrap font-semibold text-text">{t('left', { free: view.freeCount + (view.hold ? 1 : 0), total: view.total })}</span>
    </>
  );
}

/** «Ще є місця»: інші ряди з відкритим продажем і вільними місцями, у порядку `otherOpenRows`. */
function otherRows(event: FirstRowEvent, now: Ms): FirstRowMoreRow[] {
  const data = getData();
  const current = data.eventsById.get(event.id);
  if (!current) return [];
  const sellable = (e: FirstRowEvent) => {
    if (blockingEvent(e, now)) return 0;
    const { view } = snapshot(e, now);
    return view.state === 'empty' || view.state === 'open' || view.state === 'last3' ? view.freeCount : 0;
  };
  return otherOpenRows(data, now, current, sellable).map(({ event: e, free }) => {
    const { view } = snapshot(e, now);
    return {
      eventId: e.id,
      city: cityOf(e.cityId),
      country: data.countriesByIso.get(e.countryIso)?.name.uk ?? '',
      flagCode: e.countryIso,
      midnightMs: e.midnightMs,
      free,
      price: view.price.current ?? 4.99,
      main: e.isMainCelebration,
    };
  });
}

/** Ефекти, що мають іти й тоді, коли вікно закрите. */
function useFirstRowEffects(event: FirstRowEvent, now: Ms) {
  const ensureSim = useFirstRowStore((s) => s.ensureSim);
  const flow = useFirstRowStore((s) => (s.flow?.eventId === event.id ? s.flow : null));
  const entry = useGuestStore((s) => s.firstRow[event.id]);
  const greeted = useRef<string | null>(null);

  useEffect(() => {
    if (now > 0) ensureSim(event.id, now);
  }, [ensureSim, event.id, now]);

  // Час утримання вийшов, поки форма відкрита.
  const holdUntil = entry?.seat === undefined ? entry?.hold?.until : undefined;
  const formOpen = !!flow && !flow.submitting && (flow.phase === 'form' || flow.phase === 'declined' || flow.phase === 'expired');
  useEffect(() => {
    if (formOpen && holdUntil !== undefined && now > 0 && holdUntil <= now) expireHold(event, now);
  }, [formOpen, holdUntil, now, event]);

  // «Чекаємо підтвердження оплати» → підтверджено.
  const pendingSince = flow?.phase === 'pending' ? flow.pendingSince : undefined;
  useEffect(() => {
    if (pendingSince !== undefined && now - pendingSince >= PENDING_CONFIRM_MS) confirmPayment(event, now);
  }, [pendingSince, now, event]);

  // Хтось зайняв місце (імітатор) — системне повідомлення в чаті, щоразу. Лише нові місця відтоді, як модуль на екрані.
  const joinedSince = useRef<Ms | null>(null);
  useEffect(() => {
    if (now <= 0) return;
    if (joinedSince.current === null || now < joinedSince.current) {
      joinedSince.current = now;
      return;
    }
    const since = joinedSince.current;
    joinedSince.current = now;
    const { seats } = snapshot(event, now);
    const messages = seatJoinedMessages(event, seats, since, now);
    if (messages.length) useChatFeed.getState().append(messages);
  }, [event, now]);

  // Привітання учасника на «+15 с» — разом із загорянням стіни.
  const seat = entry?.seat;
  const greetAt = event.midnightMs + STAMP_DELAY;
  const due = seat !== undefined && now >= greetAt && now < event.midnightMs + HANDOVER_AFTER;
  useEffect(() => {
    if (!due) return;
    const key = `${event.id}:${seat}`;
    if (greeted.current === key) return;
    greeted.current = key;
    useChatFeed.getState().append(guestGreetingMessages(event));
  }, [due, event, seat]);
}

function InfoBody({ event, city, onTake, onBack }: { event: FirstRowEvent; city: string; onTake?(): void; onBack?(): void }) {
  const now = useNow();
  const reduced = useReducedMotion();
  const overlay = useOverlay();
  const hasPass = useGuestStore((s) => s.hasPass);
  const { view } = snapshot(event, now, { reducedMotion: reduced });
  const sellable = !!onTake && (view.state === 'empty' || view.state === 'open' || view.state === 'last3');
  return (
    <FirstRowInfo
      city={city}
      midnightMs={event.midnightMs}
      view={view}
      hasPass={hasPass}
      onTake={sellable ? onTake : undefined}
      onClose={() => overlay.close(FIRST_ROW_INFO_ID)}
      onBack={onBack}
    />
  );
}

function MoreBody({ event, city, onPick }: { event: FirstRowEvent; city: string; onPick(eventId: string): void }) {
  const now = useNow({ granularity: 'minute' });
  const overlay = useOverlay();
  return <FirstRowMore city={city} midnightMs={event.midnightMs} now={now} rows={otherRows(event, now)} onPick={onPick} onClose={() => overlay.close(FIRST_ROW_MORE_ID)} />;
}

export function FirstRowModule({ event, headingLevel = 2, dockBar = false, className }: FirstRowModuleProps) {
  if (!event?.firstRow?.saleEnabled) return null;
  return <ConnectedModule event={event} headingLevel={headingLevel} dockBar={dockBar} className={className} />;
}

function ConnectedModule({ event, headingLevel, dockBar, className }: { event: FirstRowEvent; headingLevel: 2 | 3; dockBar: boolean; className?: string }) {
  const t = useTranslations('firstRow');
  const now = useNow();
  const reduced = useReducedMotion();
  const overlay = useOverlay();
  const column = useChatColumn();
  // Розгортання смуги «Перший ряд» на телефоні згортає чат (рішення 2026-10-27).
  const dockExpanded = useChatDock((st) => st.expanded);
  const { collapse } = useChatDockControls();
  const collapseChat = () => {
    if (dockExpanded) collapse();
  };
  const lookup = useChatLookup();
  const player = useOptionalPlayer();
  const coralWindow = useCoralWindowOpen();
  // Підписка, щоб модуль перераховувався після запису в гостя.
  useGuestStore((s) => s.firstRow[event.id]);
  useGuestStore((s) => s.hasPass);
  useFirstRowStore((s) => s.passGifted);
  useFirstRowEffects(event, now);

  const city = cityOf(event.cityId);
  const { seats, view } = snapshot(event, now, { reducedMotion: reduced });

  const blocker = blockingEvent(event, now);
  const openOwn = () => {
    if (!blocker) return;
    const res = openForm(blocker, now);
    if (res === 'closed') return;
    overlay.open({
      id: FIRST_ROW_WINDOW_ID,
      kind: 'accent',
      coral: true,
      chrome: 'board',
      title: <SeatTitle event={blocker} city={cityOf(blocker.cityId)} />,
      description: <SeatSubline event={blocker} city={cityOf(blocker.cityId)} />,
      content: <FirstRowWindow event={blocker} city={cityOf(blocker.cityId)} />,
      onClose: () => useFirstRowStore.getState().setFlow(null),
    });
  };

  const openWindowFor = (ev: FirstRowEvent) => {
    const evCity = cityOf(ev.cityId);
    const res = openForm(ev, now);
    if (res === 'closed' || res === 'blocked') return;
    overlay.open({
      id: FIRST_ROW_WINDOW_ID,
      kind: 'accent',
      coral: true,
      chrome: 'board',
      title: <SeatTitle event={ev} city={evCity} />,
      description: <SeatSubline event={ev} city={evCity} />,
      content: <FirstRowWindow event={ev} city={evCity} />,
      onClose: () => {
        const s = useFirstRowStore.getState();
        // «Очікування» триває й після закриття: місце з’явиться на стіні після підтвердження.
        if (s.flow?.phase !== 'pending') s.setFlow(null);
      },
    });
  };
  const openWindow = () => openWindowFor(event);

  // «Що входить» — на місці чату / шторкою, як решта вікон (рішення 2026-10-31).
  const openInfoFor = (ev: FirstRowEvent, onBack?: () => void) => {
    const evCity = cityOf(ev.cityId);
    overlay.open({
      id: FIRST_ROW_INFO_ID,
      kind: 'accent',
      coral: true,
      chrome: 'board',
      title: t('infoTitle'),
      description: t('infoWin.metaShort', { city: evCity, time: formatClock(ev.midnightMs) }),
      content: (
        <InfoBody event={ev} city={evCity} onTake={blockingEvent(ev, now) ? undefined : () => openWindowFor(ev)} onBack={onBack} />
      ),
    });
  };
  const infoOpen = overlay.current?.id === FIRST_ROW_INFO_ID;
  const toggleInfo = () => {
    if (infoOpen) overlay.close(FIRST_ROW_INFO_ID);
    else openInfoFor(event);
  };

  // «Ще є місця» → список інших рядів; рядок → «Що входить» того ряду з «‹ До списку».
  const moreOpen = overlay.current?.id === FIRST_ROW_MORE_ID;
  const openMore = () => {
    overlay.open({
      id: FIRST_ROW_MORE_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('more.title'),
      description: t('more.sub', { city }),
      content: (
        <MoreBody
          event={event}
          city={city}
          onPick={(id) => {
            const ev = getData().eventsById.get(id);
            if (ev) openInfoFor(ev, openMore);
          }}
        />
      ),
    });
  };

  const openEmoji = useOpenMyEmotion(event.id);
  const openParticipant = useOpenParticipant();

  const coralSound = !!player && player.muted;
  const more = view.state === 'soldout' ? otherRows(event, now) : [];

  return (
    <FirstRowStrip
      city={city}
      midnightMs={event.midnightMs}
      view={view}
      seats={seats}
      takeVariant={coralSound || coralWindow ? 'tonal' : 'coral'}
      onTake={openWindow}
      blocked={blocker ? { city: cityOf(blocker.cityId), onOwn: openOwn } : undefined}
      onInfo={toggleInfo}
      infoOpen={infoOpen}
      onOpenEmoji={view.state === 'mine' ? openEmoji : undefined}
      onOpenTicket={view.state === 'mine' ? openWindow : undefined}
      onOpenParticipant={openParticipant}
      restrainedNote={event.restrained?.note.uk}
      soldOutAlt={more.length ? { city: more[0]!.city, more: more.length - 1, onOpen: moreOpen ? () => overlay.close(FIRST_ROW_MORE_ID) : openMore, open: moreOpen } : undefined}
      countryName={lookup.countryName}
      layout={column ? 'module' : 'compact'}
      headingLevel={headingLevel}
      onToggle={column ? undefined : collapseChat}
      dockBar={dockBar && !column}
      defaultOpen={!(dockBar && !column)}
      className={className}
    />
  );
}

/** Рядок у вкладці «Чат» на телефоні: «Перший ряд · Лондон · 8 ›». */
export function FirstRowChatRowConnected({ event, onClick, className }: { event: FirstRowEvent | null; onClick(): void; className?: string }) {
  const now = useNow();
  useGuestStore((s) => (event ? s.firstRow[event.id] : undefined));
  if (!event?.firstRow?.saleEnabled) return null;
  const { view } = snapshot(event, now);
  return <FirstRowChatRow city={cityOf(event.cityId)} freeCount={view.freeCount} onClick={onClick} className={className} />;
}
