'use client';

/**
 * Зв’язувальний модуль «Перший ряд» (C6 + C7 + C8; T116): однаковий на головній, сторінці країни й у кімнаті.
 * - Місця імітуються (`lib/firstrow/seatsSim`), стан і ціна — `firstRowView`; утримання, оплата — `controller`.
 * - «Зайняти місце» → O-FIRST-ROW (`accent`, coral; звук стає нейтральним), «Що входить» → O-FIRST-ROW-INFO (InFlowSlot).
 * - Кнопка «Зайняти місце» tonal, поки на сторінці коралова кнопка звуку (ІНВ 5.3).
 * - Ефекти: «час утримання вийшов» при відкритій формі, підтвердження «очікування», привітання гостя-учасника
 *   в чаті на «+15 с» (синхронно зі стіною).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { useChatDockControls } from '@/components/chat/ChatDock';
import { useChatDock } from '@/stores/chatDock';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { useOpenMyEmotion } from '@/components/windows/Emoji';
import { FirstRowInfo } from '@/components/windows/FirstRowInfo';
import { FirstRowWindow } from '@/components/windows/FirstRowWindow';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { useChatFeed } from '@/lib/chat-sim/store';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { HANDOVER_AFTER, STAMP_DELAY } from '@/lib/engine/config';
import { PENDING_CONFIRM_MS } from '@/lib/firstrow/pay';
import { nextOpenSale } from '@/lib/firstrow/pick';
import { useCoralWindowOpen } from '@/lib/overlay/coral';
import { countryHref } from '@/lib/player/BroadcastController';
import { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import { useNow } from '@/lib/time/TimeProvider';
import { useFirstRowStore } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import {
  confirmPayment,
  expireHold,
  FIRST_ROW_INFO_ID,
  FIRST_ROW_WINDOW_ID,
  guestGreetingMessages,
  openForm,
  seatJoinedMessages,
  snapshot,
  type FirstRowEvent,
} from './controller';
import { FirstRowChatRow, FirstRowStrip } from './FirstRowStrip';

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

function saleLink(now: Ms, excludeId: string): { city: string; midnightMs: Ms; href?: string } | undefined {
  const data = getData();
  const e = nextOpenSale(data, now, excludeId);
  if (!e) return undefined;
  const country = data.countriesByIso.get(e.countryIso);
  return { city: cityOf(e.cityId), midnightMs: e.midnightMs, ...(country ? { href: countryHref(country) } : {}) };
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

function InfoBody({ event, city, onTake }: { event: FirstRowEvent; city: string; onTake(): void }) {
  const now = useNow();
  const reduced = useReducedMotion();
  const overlay = useOverlay();
  const { view } = snapshot(event, now, { reducedMotion: reduced });
  const sellable = view.state === 'empty' || view.state === 'open' || view.state === 'last3';
  return (
    <FirstRowInfo
      city={city}
      midnightMs={event.midnightMs}
      view={view}
      onTake={sellable ? onTake : undefined}
      onCollapse={() => overlay.close(FIRST_ROW_INFO_ID)}
    />
  );
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
  const heading = t('heading', { city });

  const openWindow = () => {
    const res = openForm(event, now);
    if (res === 'closed') return;
    overlay.open({
      id: FIRST_ROW_WINDOW_ID,
      kind: 'accent',
      coral: true,
      title: heading,
      content: <FirstRowWindow event={event} city={city} />,
      onClose: () => {
        const s = useFirstRowStore.getState();
        // «Очікування» триває й після закриття: місце з’явиться на стіні після підтвердження.
        if (s.flow?.phase !== 'pending') s.setFlow(null);
      },
    });
  };

  const infoOpen = overlay.current?.id === FIRST_ROW_INFO_ID;
  const toggleInfo = () => {
    if (infoOpen) {
      overlay.close(FIRST_ROW_INFO_ID);
      return;
    }
    overlay.open({
      id: FIRST_ROW_INFO_ID,
      kind: 'inflow',
      coral: true,
      title: t('infoTitle'),
      content: <InfoBody event={event} city={city} onTake={openWindow} />,
    });
  };

  const openEmoji = useOpenMyEmotion(event.id);

  const coralSound = !!player && player.muted;
  const elsewhere = view.state === 'closed' || view.state === 'soldout' ? saleLink(now, event.id) : undefined;

  return (
    <FirstRowStrip
      city={city}
      midnightMs={event.midnightMs}
      view={view}
      seats={seats}
      takeVariant={coralSound || coralWindow ? 'tonal' : 'coral'}
      onTake={openWindow}
      onInfo={toggleInfo}
      infoOpen={infoOpen}
      onOpenEmoji={view.state === 'mine' ? openEmoji : undefined}
      onOpenTicket={view.state === 'mine' ? openWindow : undefined}
      restrainedNote={event.restrained?.note.uk}
      nextSale={view.state === 'closed' ? elsewhere : undefined}
      soldOutAlt={view.state === 'soldout' && elsewhere ? { city: elsewhere.city, href: elsewhere.href } : undefined}
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
