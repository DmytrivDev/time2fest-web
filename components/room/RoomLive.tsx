'use client';

/**
 * Кімната перегляду (S-ROOM, US3) — новий дизайн (дошки `Desk-Room-New`, `Phone-Room-New`, `Desk-Room-Notices`,
 * концепція `room-concept-2026-11-05.md`, власник 2026-11-05).
 *
 * Згори нічого: одразу вікна (1 — на всю ширину, 2–4 — сітка 2×2, вільні місця — плашки розміром із вікно; порожня
 * кімната — 4 місця, телефон — одне). Під вікнами — «Кімната перегляду · N з 4», відлік до найближчої півночі у вікнах і
 * рядок дій: «Додати / Замінити трансляцію», «Поділитися», «Режим вечірки», «⋯». Далі — обіцянка штампа, штамп
 * (головного вікна + «Ще в кімнаті»), Перший ряд (поточного поясу), пас, «Поточні трансляції», «Як працює кімната».
 *
 * Вікна:
 * - позиція в сітці = порядок `guest.room.windows`; перше — головне (штамп, чат країни). DOM вікон не переставляємо
 *   (CSS `order`), тож перетягування за смугу не перезапускає плеєри;
 * - спільний `PlayerHost` макета сидить у вікні `hostSlot` (не обов’язково першому): лише він має автозапуск (FR-040);
 *   вікна 2–4 — `RoomWindowPlayer`, стартують після дії людини, без звуку;
 * - звук в одному вікні: «Звук сюди», клавіші 1–4; звук, увімкнений кнопкою самого плеєра, кімната переносить туди.
 * Сповіщення — там, де сталася дія: прибране вікно 6 с лишається плиткою «Повернути» (десктоп; телефон — під рядком
 * дій), заміна — 6 с у смузі вікна. Кімната повна → «Що замінити?» у колонці чату / шторці (лише там).
 * Телефон: розгорнутий чат при 2 вікнах згортає вікно без звуку (пауза); горизонтально — два вікна поруч (CSS).
 */
import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import NextLink from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { firstRowEventFor } from '@/lib/firstrow/pick';
import {
  MORE_ACTIONS_ID,
  MoreActionsDesk,
  MoreActionsList,
  REPORT_ID,
  ReportProblem,
  type ShareTarget,
} from '@/components/live/MoreActions';
import { StreamCards } from '@/components/live/StreamCards';
import type { EventFilterValue } from '@/components/live/EventFilter';
import { StampBlock } from '@/components/live/StampBlock';
import { StreamPicker } from '@/components/live/StreamPicker';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { OverlayInFlowOutlet, useChatColumn, useOverlay, usePartyHref } from '@/components/shell/OverlayManager';
import { ShareContent } from '@/components/windows/Share';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { SITE_HOST } from '@/lib/config/site';
import { getData } from '@/lib/data/load';
import type { Dataset, GuestRoomWindow, RoomId } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { streamRows, type StreamRowData } from '@/lib/live/countryData';
import { countryZoneEvents } from '@/lib/schedule/countryZone';
import { utcLabel } from '@/lib/i18n/time';
import { thumbOf } from '@/lib/live/thumb';
import {
  useOptionalPlayer,
  useOptionalPlayerActions,
  type PlayerChainInput,
} from '@/lib/player/PlayerProvider';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { roomShareSvg } from '@/lib/room/shareRoomImage';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useChatDock } from '@/stores/chatDock';
import { useGuestStore } from '@/stores/guest';
import { posOf, roomLimit, useRoom, useRoomStore, type RoomTarget } from '@/stores/room';
import { RoomHowTo } from './RoomHowTo';
import { RoomReplacePanel } from './RoomReplacePanel';
import { SlotTile, UndoTile, type SlotState } from './RoomSlots';
import { RoomWindowCard, type RoomWindowCardView } from './RoomWindowCard';
import { roomPlayers, RoomWindowPlayer } from './RoomWindowPlayer';
import { RoomPageContext } from './useRoomToggle';
import { useRoomDrag } from './useRoomDrag';
import { useRoomViewport } from './useRoomViewport';
import s from './room.module.css';

const SOUND_POLL_MS = 1_000;
/** Після «Звук сюди» YouTube віддає новий стан звуку не миттєво — стільки довіряємо дії людини. */
const SOUND_GRACE_MS = 1_500;
const NOTICE_MS = 6_000;
const PICKER_ID = 'O-ROOM-ADD';
const REPLACE_ID = 'O-ROOM-REPLACE';
const SHARE_ID = 'O-ROOM-SHARE';

function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  return preferredSourceId ? { eventId, sources, preferredSourceId } : { eventId, sources };
}

function cityOf(title: string): string {
  return title.split(' · ')[0] ?? title;
}

function sourceTitle(data: Dataset, w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>): string {
  const src = data.chainsByEventId.get(w.eventId)?.sources.find((x) => x.id === w.sourceId);
  if (src) return src.title.uk;
  const ev = data.eventsById.get(w.eventId);
  return ev ? (data.citiesById.get(ev.cityId)?.name.uk ?? '') : '';
}

function flagOf(data: Dataset, eventId: string): string {
  const ev = data.eventsById.get(eventId);
  const c = ev ? data.countriesByIso.get(ev.countryIso) : undefined;
  return c?.flagCode ?? ev?.countryIso.toLowerCase() ?? '';
}

/**
 * Посилання «Поділитися кімнатою»: `?w=` — джерела за місцями сітки (0 — верхнє ліве … 3 — нижнє праве), порожнє місце —
 * порожній елемент: `?w=a,,,b` — вікна на місцях 1 і 4. Друг бачить трансляції на тих самих місцях.
 */
export function roomShareUrl(windows: readonly GuestRoomWindow[], origin = typeof window !== 'undefined' ? window.location.origin : `https://${SITE_HOST}`): string {
  const byPos: string[] = [];
  windows.forEach((w, i) => {
    byPos[posOf(w, i)] = encodeURIComponent(w.sourceId);
  });
  return `${origin}/room/?w=${Array.from(byPos, (x) => x ?? '').join(',')}`;
}

/** `?w=` → вікна з місцями сітки; невідомі джерела й повтори пропускаємо, місця інших вікон не зсуваються. */
export function parseRoomShare(raw: string, data: Pick<Dataset, 'chainsByEventId'>): GuestRoomWindow[] {
  const list: GuestRoomWindow[] = [];
  raw.split(',').forEach((part, pos) => {
    if (!part || pos > 3) return;
    const id = decodeURIComponent(part);
    if (list.some((w) => w.sourceId === id)) return;
    for (const [eventId, chain] of data.chainsByEventId) {
      if (chain.sources.some((x) => x.id === id)) {
        list.push({ slot: list.length, sourceId: id, eventId, pos });
        return;
      }
    }
  });
  return list;
}

/** Чат розгорнуто (телефон) — для згортання вікна без звуку. */
function useChatExpanded(): boolean {
  return useChatDock((st) => st.expanded);
}

export function RoomLive() {
  const t = useTranslations('room.page');
  const tWin = useTranslations('room.window');
  const tUndo = useTranslations('room.undo');
  const tShare = useTranslations('room.share');
  const tPlayer = useTranslations('player');
  const tChat = useTranslations('chat');
  const data = getData();
  const announce = useAnnounce();
  const overlay = useOverlay();
  // «Режим вечірки»: телефон і планшет-портрет — `/tv-info/` (2026-11-10).
  const partyHref = usePartyHref();
  const player = useOptionalPlayer();
  const actions = useOptionalPlayerActions();
  const viewport = useRoomViewport();
  const phone = viewport === 'phone';
  const limit = roomLimit(viewport);
  const chatColumn = useChatColumn();
  const ready = useTimeReady();
  const now = useNow();
  const known = ready && now > 0;
  const minute = Math.floor(now / 60_000) * 60_000;
  const passWindows = useOfferWindows();
  const router = useRouter();
  const searchParams = useSearchParams();

  const room = useRoom();
  const { pickTarget, started, hostSlot } = useRoomStore();
  const schedule = useGuestStore((st) => st.schedule);
  const stamps = useGuestStore((st) => st.stamps);
  const hasPass = useGuestStore((st) => st.hasPass);

  // На телефоні видно до 2 вікон (збережені з десктопа 3–4 лишаються в `guest.room`).
  const windows = useMemo(() => room.windows.slice(0, limit), [room.windows, limit]);
  const soundSlot = windows.some((w) => w.slot === room.soundSlot)
    ? room.soundSlot
    : (windows[0]?.slot ?? null);
  const main = windows[0] ?? null;
  const host = windows.find((w) => w.slot === hostSlot) ?? main;
  const soundWindow = windows.find((w) => w.slot === soundSlot) ?? main;

  // ── Посилання «Поділитися кімнатою» (`?w=`): відкриває ті самі вікна ──
  const sharedRef = useRef(false);
  useEffect(() => {
    if (sharedRef.current || !known) return;
    const raw = searchParams?.get('w');
    if (!raw) return;
    sharedRef.current = true;
    const list = parseRoomShare(raw, data);
    if (!list.length) return;
    useGuestStore.getState().setRoomWindows(list);
    useGuestStore.getState().setSoundSlot(0);
    useRoomStore.getState().setHostSlot(null);
    if (list.length > limit) announce(t('sharedPhone', { count: list.length }));
  }, [known, searchParams, data, limit, announce, t]);

  // ── Головний плеєр = спільний PlayerHost у вікні `host` ──
  const adoptedRef = useRef(false);
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });
  const hostSource = host?.sourceId;
  const hostEvent = host?.eventId;
  useEffect(() => {
    if (!known || !actions) return;
    if (!adoptedRef.current) {
      adoptedRef.current = true;
      const p = playerRef.current;
      const sel = p?.selection;
      if (!searchParams?.get('w') && p?.eventId && sel && sel.kind !== 'countdown-scene') {
        useRoomStore
          .getState()
          .adoptMain({ sourceId: sel.source.id, eventId: p.eventId }, viewport);
        useRoomStore.getState().setHostSlot(null);
      }
    }
    const st = useGuestStore.getState().room.windows;
    const hs = useRoomStore.getState().hostSlot;
    const h = st.find((w) => w.slot === hs) ?? st[0];
    if (h) actions.setChain(chainInput(data, h.eventId, h.sourceId));
  }, [known, actions, data, viewport, hostEvent, hostSource, searchParams]);

  // Вікно-господар прибране → господарем стає перше вікно.
  useEffect(() => {
    if (hostSlot !== null && !windows.some((w) => w.slot === hostSlot))
      useRoomStore.getState().setHostSlot(null);
  }, [hostSlot, windows]);

  // ── Звук в одному вікні ──
  const isHost = useCallback((w: GuestRoomWindow) => w.slot === (host?.slot ?? -1), [host]);
  const applySound = useCallback(
    (list: readonly GuestRoomWindow[], target: number | null, skipTarget = false) => {
      const hs = useRoomStore.getState().hostSlot;
      const hostOf = list.find((w) => w.slot === hs) ?? list[0];
      list.forEach((w) => {
        const on = w.slot === target;
        if (on && skipTarget) return;
        if (w === hostOf) {
          if (on) actions?.unmute();
          else actions?.mute();
          return;
        }
        const h = roomPlayers.get(w.slot);
        if (!h) return;
        if (on) {
          h.unMute();
          h.play();
        } else h.mute();
      });
    },
    [actions],
  );

  const titleOf = useCallback(
    (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => sourceTitle(data, w),
    [data],
  );

  // Плашка «Звук тут» — лише коли у вікні зі звуком справді чути (власник 2026-11-10): автозапуск без звуку,
  // кнопка звуку чи гучність самого YouTube, вікно ще не запущене — скрізь «Звук сюди».
  const [soundLive, setSoundLive] = useState(false);
  const soundGrace = useRef(0);

  const moveSound = useCallback(
    (slot: number, opts: { apply: boolean }) => {
      const w = windows.find((x) => x.slot === slot);
      if (!w) return;
      soundGrace.current = Date.now() + SOUND_GRACE_MS;
      setSoundLive(true);
      useRoomStore.getState().setSound(slot);
      if (!useRoomStore.getState().started.includes(slot) && !isHost(w))
        useRoomStore.getState().markStarted(slot);
      applySound(windows, slot, !opts.apply);
      announce(t('soundMoved', { city: cityOf(titleOf(w)) }));
    },
    [windows, applySound, announce, t, titleOf, isHost],
  );

  const mainMuted = player?.muted ?? true;
  useEffect(() => {
    if (!mainMuted && host && soundSlot !== host.slot) actions?.mute();
    // лише на зміну стану звуку головного плеєра
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMuted]);

  const live = useRef({ windows, soundSlot, moveSound, actions, host });
  useEffect(() => {
    live.current = { windows, soundSlot, moveSound, actions, host };
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const {
        windows: list,
        soundSlot: cur,
        moveSound: move,
        actions: act,
        host: h,
      } = live.current;
      if (list.length < 2) return;
      for (const w of list) {
        if (w.slot === cur) continue;
        const unmuted =
          w === h ? act?.isMuted() === false : roomPlayers.get(w.slot)?.isMuted() === false;
        if (unmuted) {
          move(w.slot, { apply: false });
          return;
        }
      }
      if (Date.now() < soundGrace.current) return;
      const sw = list.find((w) => w.slot === cur);
      const audible = !sw
        ? false
        : sw === h
          ? act?.isAudible() === true
          : roomPlayers.get(sw.slot)?.isAudible() === true;
      setSoundLive(audible);
    }, SOUND_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // Клавіші 1–4 — звук у вікно на цьому місці сітки (1 — верхнє ліве … 4 — нижнє праве; порожнє місце — нічого), не в полях введення.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
        return;
      const n = Number(e.key);
      if (!Number.isInteger(n) || n < 1 || n > 4) return;
      const { windows: list, soundSlot: cur, moveSound: move } = live.current;
      const w = list.find((x, i) => posOf(x, i) === n - 1);
      if (!w || list.length < 2 || w.slot === cur) return;
      move(w.slot, { apply: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Сповіщення там, де сталася дія ──
  const [undo, setUndo] = useState<{
    win: GuestRoomWindow;
    pos: number;
    sound: boolean;
    title: string;
    until: number;
  } | null>(null);
  const [barNotice, setBarNotice] = useState<{
    slot: number;
    prev: RoomTarget;
    text: string;
    until: number;
  } | null>(null);
  useEffect(() => {
    const until = Math.min(undo?.until ?? Infinity, barNotice?.until ?? Infinity);
    if (!Number.isFinite(until)) return;
    const id = window.setTimeout(
      () => {
        const nowMs = Date.now();
        setUndo((u) => (u && u.until <= nowMs ? null : u));
        setBarNotice((b) => (b && b.until <= nowMs ? null : b));
      },
      Math.max(0, until - Date.now()) + 20,
    );
    return () => window.clearTimeout(id);
  }, [undo, barNotice]);

  // ── Дії ──
  const remove = useCallback(
    (slot: number) => {
      const index = windows.findIndex((w) => w.slot === slot);
      const removed = windows[index];
      if (!removed) return;
      const pos = removed.pos ?? index;
      const hadSound = soundSlot === slot;
      useRoomStore.getState().remove(slot);
      const after = useGuestStore.getState().room;
      if (hadSound && after.soundSlot !== null)
        applySound(after.windows.slice(0, limit), after.soundSlot);
      const title = titleOf(removed);
      setUndo({ win: removed, pos, sound: hadSound, title, until: Date.now() + NOTICE_MS });
      announce(t('removed', { city: cityOf(title) }));
    },
    [windows, soundSlot, applySound, limit, announce, t, titleOf],
  );

  const doUndo = useCallback(() => {
    if (!undo) return;
    useRoomStore.getState().restore(undo.win, undo.pos, viewport, undo.sound);
    setUndo(null);
  }, [undo, viewport]);

  const replaceInto = useCallback(
    (slot: number) => {
      const target = useRoomStore.getState().pickTarget;
      const old = windows.find((w) => w.slot === slot);
      if (!target || !old) return;
      useRoomStore.getState().replace(slot, target);
      overlay.close(REPLACE_ID);
      const text = tWin('replaced', { from: cityOf(titleOf(old)), to: cityOf(titleOf(target)) });
      setBarNotice({
        slot,
        prev: { sourceId: old.sourceId, eventId: old.eventId },
        text,
        until: Date.now() + NOTICE_MS,
      });
      announce(text);
    },
    [windows, overlay, tWin, titleOf, announce],
  );

  const undoReplace = useCallback(() => {
    if (!barNotice) return;
    useRoomStore.getState().replace(barNotice.slot, barNotice.prev);
    setBarNotice(null);
  }, [barNotice]);

  // Перетягування: на інше вікно — міняються місцями, на вільне місце — вікно переходить туди.
  const moveTo = useCallback(
    (slot: number, pos: number) => {
      // Господар PlayerHost не змінюється: позиція — лише порядок показу.
      if (useRoomStore.getState().hostSlot === null && main)
        useRoomStore.getState().setHostSlot(main.slot);
      useRoomStore.getState().move(slot, pos);
      // Перестановка не змінює, у якому вікні звук: підтверджуємо його у вікні зі звуком (і тиша в решті).
      if (soundLive && soundSlot !== null) {
        const after = useGuestStore.getState().room.windows.slice(0, limit);
        applySound(after, soundSlot);
      }
      // PlayerHost стежить за слотом через ResizeObserver; перестановка без зміни розміру — перемір вручну.
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    },
    [main, soundLive, soundSlot, limit, applySound],
  );
  const drag = useRoomDrag(moveTo);

  const start = useCallback((slot: number) => useRoomStore.getState().markStarted(slot), []);

  // ── Трансляції наживо (для «Додати», вільних місць) ──
  // Пояс кімнати — пояс головного вікна (порожня кімната — поточний пояс). У списку «Додати» й у «Поточних
  // трансляціях» — усі трансляції цього поясу, що йдуть зараз (власник 2026-11-06).
  const roomZoneId =
    (main ? data.eventsById.get(main.eventId)?.zoneId : undefined) ??
    (known ? firstRowEventFor(data, now)?.zoneId : undefined) ??
    null;
  const liveRows = useMemo(() => {
    if (!known || !roomZoneId) return [] as StreamRowData[];
    const evs = data.events.filter((e) => e.zoneId === roomZoneId);
    return streamRows(data, evs, minute).filter((r) => r.status === 'live');
  }, [data, known, minute, roomZoneId]);
  const inRoomIds = useMemo(() => new Set(room.windows.map((w) => w.sourceId)), [room.windows]);
  const freeLive = liveRows.filter((r) => !inRoomIds.has(r.id));

  const slotState: SlotState = useMemo(() => {
    if (freeLive.length > 1)
      return {
        kind: 'live',
        count: freeLive.length,
        flags: [...new Set(freeLive.map((r) => r.flagCode))],
      };
    if (freeLive.length === 1) return { kind: 'one', title: freeLive[0]!.title };
    const upcoming = known
      ? data.events
          .filter(
            (e) => e.midnightMs > now && (data.chainsByEventId.get(e.id)?.sources.length ?? 0) > 0,
          )
          .sort((a, b) => a.midnightMs - b.midnightMs)[0]
      : undefined;
    if (liveRows.length > 0)
      return { kind: 'all-in', next: upcoming ? formatClock(upcoming.midnightMs) : null };
    return {
      kind: 'none',
      next: upcoming
        ? {
            title: data.citiesById.get(upcoming.cityId)?.name.uk ?? '',
            time: formatClock(upcoming.midnightMs),
          }
        : null,
    };
  }, [freeLive, liveRows, known, data, now]);

  const add = useCallback(
    (target: RoomTarget) => {
      const res = useRoomStore.getState().add(target, viewport);
      if (res === 'added') {
        overlay.close(PICKER_ID);
        announce(t('added', { city: cityOf(titleOf(target)) }));
      }
    },
    [viewport, overlay, announce, t, titleOf],
  );

  // «+» на картці: є — прибрати; немає — додати (повна → «Що замінити?»).
  const toggleFromCard = useCallback(
    (target: RoomTarget) => {
      const w = windows.find((x) => x.sourceId === target.sourceId);
      if (w) remove(w.slot);
      else add(target);
    },
    [windows, remove, add],
  );

  // ── Вибір трансляції (на місці чату / шторка) ──
  const openPicker = useCallback(() => {
    overlay.open({
      id: PICKER_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('addTitle'),
      description: t('addSub', { count: windows.length, limit }),
      // Вікно рендериться поза сторінкою (колонка чату / шторка) — контекст кімнати передаємо явно.
      content: (
        <RoomPageContext.Provider value={{ toggle: (target: RoomTarget) => add(target) }}>
          <StreamPicker
            midnightMs={main ? (data.eventsById.get(main.eventId)?.midnightMs ?? now) : now}
            rows={liveRows}
            onPick={(row) => add({ sourceId: row.id, eventId: row.eventId })}
            onAddToRoom={(row: StreamRowData) => add({ sourceId: row.id, eventId: row.eventId })}
            onToggleSchedule={(id) =>
              passWindows.requestSchedule(id, !useGuestStore.getState().schedule.includes(id))
            }
          />
        </RoomPageContext.Provider>
      ),
    });
  }, [overlay, t, windows.length, limit, main, data, now, liveRows, add, passWindows]);

  // Кімната повна → «Що замінити?» (одне місце для вибору).
  useEffect(() => {
    if (!pickTarget) {
      if (overlay.current?.id === REPLACE_ID) overlay.close(REPLACE_ID);
      return;
    }
    overlay.open({
      id: REPLACE_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('replaceTitle'),
      description: phone ? t('replaceSubPhone') : t('replaceSub'),
      content: (
        <RoomReplacePanel
          phone={phone}
          adding={{
            title: titleOf(pickTarget),
            flagCode: flagOf(data, pickTarget.eventId),
            thumb: thumbOf({ id: pickTarget.sourceId, eventId: pickTarget.eventId }),
          }}
          windows={windows.map((w, i) => ({
            slot: w.slot,
            position: posOf(w, i) + 1,
            title: titleOf(w),
            flagCode: flagOf(data, w.eventId),
            thumb: thumbOf({ id: w.sourceId, eventId: w.eventId }),
            hasSound: w.slot === soundSlot && soundLive,
          }))}
          onPick={replaceInto}
          onCancel={() => useRoomStore.getState().cancelPick()}
        />
      ),
    });
    // вміст оновлюємо, коли змінюється, що замінюємо й чим
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickTarget, windows, soundSlot, soundLive, phone]);
  // Закрили вікно «Що замінити?» (×, інше вікно) — заміну скасовано.
  const overlayId = overlay.current?.id ?? null;
  const prevOverlayId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevOverlayId.current;
    prevOverlayId.current = overlayId;
    if (prev === REPLACE_ID && overlayId !== REPLACE_ID && useRoomStore.getState().pickTarget) {
      useRoomStore.getState().cancelPick();
    }
  }, [overlayId]);

  // ── Поділитися кімнатою (як «Поділитися штампом») ──
  const openShare = useCallback(() => {
    const cells = windows.map((w) => {
      const ev = data.eventsById.get(w.eventId);
      return { city: cityOf(titleOf(w)), time: ev ? formatClock(ev.midnightMs) : '' };
    });
    const url = roomShareUrl(windows);
    overlay.open({
      id: SHARE_ID,
      kind: 'form',
      title: tShare('title'),
      description: tShare('sub'),
      content: (
        <ShareContent
          data={{ place: cells.map((c) => c.city).join(' · '), time: '', url }}
          svgFor={(ratio) =>
            roomShareSvg(ratio, cells, {
              eyebrow: tShare('eyebrow'),
              title: tShare('cardTitle', { count: cells.length }),
              caption: tShare('caption'),
              brand: 'Time2Fest',
            })
          }
          previewAlt={tShare('previewAlt', { places: cells.map((c) => c.city).join(', ') })}
          shareText={tShare('text', { count: cells.length })}
          fileStem="time2fest-room"
        />
      ),
    });
  }, [windows, data, titleOf, overlay, tShare]);

  // ── ⋯ ──
  const shareTarget: ShareTarget = {
    url: roomShareUrl(windows),
    shortUrl: `${SITE_HOST}/room/`,
    text: tShare('text', { count: windows.length }),
  };
  const openReport = () =>
    overlay.open({
      id: REPORT_ID,
      kind: 'accent',
      chrome: 'board',
      title: tPlayer('more.reportTitle'),
      onBack: openMore,
      content: (
        <div className="px-4 pb-4 pt-2">
          <ReportProblem center onClose={() => overlay.close(REPORT_ID)} />
        </div>
      ),
    });
  function openMore() {
    overlay.open({
      id: MORE_ACTIONS_ID,
      kind: 'accent',
      chrome: 'board',
      title: tPlayer('moreActions'),
      content: chatColumn ? (
        <MoreActionsDesk target={shareTarget} />
      ) : (
        <MoreActionsList target={shareTarget} onReport={openReport} />
      ),
    });
  }
  const toggleMore = () =>
    overlay.current?.id === MORE_ACTIONS_ID ? overlay.close(MORE_ACTIONS_ID) : openMore();

  // ── Присутність, штамп, чат ──
  const eventIds = [...new Set(windows.map((w) => w.eventId))];
  useStampGrant(eventIds.length ? { source: 'room', eventIds } : null);
  useMomentWindows();
  const mainEvent = main ? data.eventsById.get(main.eventId) : undefined;
  const windowCountries = (() => {
    const out: { iso: string; name: string }[] = [];
    for (const w of windows) {
      const iso = data.eventsById.get(w.eventId)?.countryIso;
      const c = iso ? data.countriesByIso.get(iso) : undefined;
      if (c && !out.some((x) => x.iso === c.iso)) out.push({ iso: c.iso, name: c.name.uk });
    }
    return out;
  })();
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const mainCountry = mainEvent ? data.countriesByIso.get(mainEvent.countryIso) : undefined;
  const country =
    (pickedIso
      ? windowCountries.find((c) => c.iso === pickedIso) && data.countriesByIso.get(pickedIso)
      : undefined) ?? mainCountry;
  const chatRoomCountry: RoomId | null = country ? `country:${country.iso}` : null;
  const simRooms = windowCountries.map((c) => `country:${c.iso}`).join('|');
  useChatSimulator(
    useMemo(
      () =>
        [
          'world',
          ...(simRooms ? simRooms.split('|') : chatRoomCountry ? [chatRoomCountry] : []),
        ] as RoomId[],
      [simRooms, chatRoomCountry],
    ),
  );

  // ── Відлік: найближча північ у вікнах ──
  const midnights = windows
    .map((w) => ({ w, ev: data.eventsById.get(w.eventId) }))
    .filter((x): x is { w: GuestRoomWindow; ev: NonNullable<typeof x.ev> } => !!x.ev);
  const nextMidnight = known
    ? midnights
        .filter((x) => x.ev.midnightMs > now)
        .sort((a, b) => a.ev.midnightMs - b.ev.midnightMs)[0]?.ev.midnightMs
    : undefined;
  const nextCities = nextMidnight
    ? [
        ...new Set(
          midnights
            .filter((x) => x.ev.midnightMs === nextMidnight)
            .map((x) => data.citiesById.get(x.ev.cityId)?.name.uk ?? ''),
        ),
      ]
    : [];
  const left = nextMidnight ? Math.max(0, nextMidnight - now) : 0;
  const hh = String(Math.floor(left / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  const timerText = `${hh}:${mm}:${ss}`;
  const stampCities = [
    ...new Set(
      midnights
        .filter(
          (x) => known && x.ev.midnightMs > now && !stamps.some((st) => st.eventId === x.ev.id),
        )
        .map((x) => data.citiesById.get(x.ev.cityId)?.name.uk ?? ''),
    ),
  ];

  // ── Вікна ──
  const chatExpanded = useChatExpanded();
  const vis = useChatVisibility();
  const { collapse, collapse: collapseChat } = useChatDockControls();
  // Телефон, 2 вікна: розгорнутий чат або будь-яка шторка — вікно без звуку згортається в мініатюру й стає на паузу,
  // сторінка — нагору, шторка починається під мініатюрою (не накриває жодного вікна). Чат і шторки працюють лише так.
  const sheetOpen = phone && overlay.current !== null && overlay.current.kind !== 'inflow';
  const foldSlot =
    phone && (chatExpanded || sheetOpen) && windows.length === 2
      ? (windows.find((w) => w.slot !== soundSlot)?.slot ?? null)
      : null;
  // «Розгорнути» на мініатюрі — чат і шторка повністю закриваються, обидва вікна знову грають.
  const unfold = () => {
    collapseChat();
    if (overlay.current) overlay.close(overlay.current.id);
  };
  const prevFold = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevFold.current;
    prevFold.current = foldSlot;
    const handle = (slot: number) =>
      windows.find((w) => w.slot === slot && isHost(w)) ? null : roomPlayers.get(slot);
    if (foldSlot !== null && prev !== foldSlot) {
      window.scrollTo({ top: 0 });
      const h = handle(foldSlot);
      if (h) h.pause();
      else actions?.pause();
    }
    if (prev !== null && foldSlot === null) {
      const h = handle(prev);
      if (h) h.play();
      else actions?.play();
    }
  }, [foldSlot, windows, actions, isHost]);

  const views: (RoomWindowCardView & { w: GuestRoomWindow; order: number })[] = windows.map(
    (w, index) => {
      // Десктоп — стале місце в сітці (прибране вікно лишає порожнє місце); телефон — одне під одним.
      const order = phone ? index : (w.pos ?? index);
      const ev = data.eventsById.get(w.eventId);
      const row =
        ev && known ? streamRows(data, [ev], minute).find((r) => r.id === w.sourceId) : undefined;
      const sel = isHost(w) && player?.eventId === w.eventId ? player.selection : null;
      const title =
        sel && sel.kind !== 'countdown-scene'
          ? titleOf({ eventId: w.eventId, sourceId: sel.source.id })
          : titleOf(w);
      return {
        w,
        order,
        slot: w.slot,
        title,
        flagCode: flagOf(data, w.eventId),
        status: row?.status === 'recording' ? 'recording' : 'live',
        hasSound: windows.length > 1 && w.slot === soundSlot,
        audible: soundLive,
        inSchedule: schedule.includes(w.eventId),
        stamp: stamps.some((st) => st.eventId === w.eventId) ? 'got' : 'todo',
      };
    },
  );
  // DOM — за сталим номером вікна (плеєри не переставляються), позиція — CSS `order`.
  const domOrder = [...views].sort((a, b) => a.slot - b.slot);

  const media = (w: GuestRoomWindow) =>
    isHost(w) ? (
      <PlayerSlot id="main" />
    ) : (
      <RoomWindowPlayer
        slot={w.slot}
        eventId={w.eventId}
        sources={data.chainsByEventId.get(w.eventId)?.sources ?? []}
        preferredSourceId={w.sourceId}
        title={titleOf(w)}
        started={started.includes(w.slot)}
        hasSound={w.slot === soundSlot}
        soundAllowed
        onStart={start}
      />
    );

  // Плитка «Повернути» займає місце прибраного вікна (десктоп), тож сітка не перебудовується 6 с.
  const showUndoTile = !!undo && !phone;
  const single = !phone && windows.length === 1 && !showUndoTile;
  const taken = new Set([
    ...views.map((v) => v.order),
    ...(showUndoTile && undo ? [undo.pos] : []),
  ]);
  const slotPositions = phone
    ? windows.length === 0
      ? [0]
      : []
    : single
      ? []
      : [0, 1, 2, 3].filter((p) => !taken.has(p));
  const full = windows.length >= limit;

  const grid = (
    <div
      data-room-grid=""
      data-room-layout={windows.length}
      data-dock-above=""
      data-video-column=""
      className={cn(s.grid, single && s.gridOne, phone && s.gridPhone)}
    >
      {domOrder.map((v) => (
        <RoomWindowCard
          key={v.slot}
          id={`room-w${v.slot}`}
          view={v}
          order={single ? 0 : v.order}
          pos={v.order}
          phone={phone}
          only={windows.length <= 1}
          media={media(v.w)}
          draggable={!phone && windows.length > 1}
          drag={drag.dragSlot === v.slot ? 'src' : drag.overPos === v.order ? 'dst' : null}
          notice={
            barNotice?.slot === v.slot
              ? { text: barNotice.text, undo: tUndo('undo'), onUndo: undoReplace }
              : null
          }
          folded={foldSlot === v.slot}
          onUnfold={unfold}
          onBarPointerDown={drag.onBarPointerDown}
          onRemove={remove}
          onSound={(slot) => moveSound(slot, { apply: true })}
        />
      ))}
      {showUndoTile && undo ? (
        <UndoTile title={undo.title} order={undo.pos} onUndo={doUndo} />
      ) : null}
      {slotPositions.map((p) => (
        <SlotTile
          key={`slot-${p}`}
          state={slotState}
          order={p}
          pos={p}
          dropTarget={drag.dragSlot !== null && drag.overPos === p}
          phone={phone}
          onAdd={openPicker}
          onSchedule={() =>
            passWindows.requestSchedule?.(
              data.events.find((e) => e.midnightMs > now)?.id ?? '',
              true,
            )
          }
        />
      ))}
    </div>
  );

  const soundTitle = soundWindow ? titleOf(soundWindow) : '';
  const sub =
    windows.length === 0
      ? t('subEmpty', { limit })
      : windows.length > 1
        ? soundLive
          ? t('sub', { count: windows.length, limit, title: soundTitle })
          : t('subMuted', { count: windows.length, limit })
        : t('subOne', { count: windows.length, limit });
  const addBtn = full ? (
    <Button variant="secondary" iconLeft="swap" onClick={openPicker} data-action="room-replace">
      {t('replaceButton')}
    </Button>
  ) : (
    <Button variant="secondary" iconLeft="plus" onClick={openPicker} data-action="room-add">
      {t('addButton')}
    </Button>
  );

  const info = phone ? (
    <div className={s.phoneActions}>
      <div className={s.phoneTimer}>
        <span>
          {nextMidnight
            ? t('phoneTimer', { count: windows.length, limit })
            : t('phoneCount', { count: windows.length, limit })}
        </span>
        {nextMidnight ? <b>{timerText}</b> : null}
      </div>
      <div className={s.phoneRow}>
        <Button
          variant="secondary"
          compact
          iconLeft={full ? 'swap' : 'plus'}
          onClick={openPicker}
          data-action={full ? 'room-replace' : 'room-add'}
        >
          {full ? t('replaceShort') : t('addShort')}
        </Button>
        <span className={s.spacer} />
        <IconButton icon="share" variant="ring" aria-label={tShare('button')} onClick={openShare} />
        <IconButton
          icon="monitor"
          variant="ring"
          aria-label={tPlayer('partyMode')}
          onClick={() => router.push(partyHref)}
        />
        <IconButton
          icon="more"
          variant="plain"
          aria-label={tPlayer('moreActions')}
          onClick={toggleMore}
        />
      </div>
    </div>
  ) : (
    <>
      <div className={s.info}>
        <div className={s.infoText}>
          <h1 className={s.infoTitle}>{t('heading')}</h1>
          <p className={s.infoSub}>{sub}</p>
        </div>
        {/* Чат сховано — «Показати чат» поруч із таймером, як на головній. */}
        {chatColumn && vis.hidden ? (
          <ChatHiddenButton room={chatRoomCountry ?? 'world'} onShow={vis.show} />
        ) : null}
        {nextMidnight ? (
          <div className={s.timer} data-room-timer="">
            <span>{t('untilMidnight', { cities: nextCities.join(' і ') })}</span>
            <b>{timerText}</b>
          </div>
        ) : windows.length ? (
          <div className={s.timer}>
            <span>{t('allPast')}</span>
          </div>
        ) : null}
      </div>
      <div className={s.actions}>
        {addBtn}
        <Button variant="secondary" iconLeft="share" onClick={openShare} data-action="room-share">
          {tShare('button')}
        </Button>
        <span className={s.spacer} />
        <Button asChild variant="tonal">
          <NextLink href={partyHref} data-action="party-mode">
            <Icon name="monitor" size={18} />
            {tPlayer('partyMode')}
          </NextLink>
        </Button>
        <IconButton
          icon="more"
          variant="ring"
          aria-label={tPlayer('moreActions')}
          aria-haspopup="dialog"
          onClick={toggleMore}
        />
      </div>
    </>
  );

  // ── Чат ──
  const chatSlot =
    chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const panel = (className?: string) => (
    <ChatPanel
      country={country ? { iso: country.iso, name: country.name.uk } : undefined}
      countries={windowCountries}
      onCountryChange={setPickedIso}
      eventId={main?.eventId ?? null}
      cityName={mainEvent ? data.citiesById.get(mainEvent.cityId)?.name.uk : undefined}
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );

  // «Поточні трансляції» — картки подій із трансляцією зараз; «+» — одразу у вікно.
  const [currentFilter, setCurrentFilter] = useState<EventFilterValue>('all');
  const inSchedule = (eventId: string) =>
    countryZoneEvents(eventId).some((id) => schedule.includes(id));
  const currentRows =
    currentFilter === 'mine' ? liveRows.filter((r) => inSchedule(r.eventId)) : liveRows;
  const zone = roomZoneId ? data.zonesById.get(roomZoneId) : undefined;
  const zoneMidnight = liveRows[0]?.midnightMs ?? mainEvent?.midnightMs;
  const roomCtx = useMemo(() => ({ toggle: toggleFromCard }), [toggleFromCard]);

  return (
    <RoomPageContext.Provider value={roomCtx}>
      {/* Десктоп: вікна на рівні з верхом чату, без бічних відступів (власник 2026-11-07); телефон — як було. */}
      <div data-room-page="" className={cn('flex flex-col', s.page)}>
        {grid}
        {info}
        {phone && undo ? (
          <div className={s.notice} role="status" data-room-notice="">
            <Icon name="check" size={18} />
            <span className={s.noticeText}>{t('removed', { city: cityOf(undo.title) })}</span>
            <Button variant="ghost" compact iconLeft="undo" onClick={doUndo}>
              {tUndo('undo')}
            </Button>
            <span className={cn(s.progress, s.progressGrey)} aria-hidden="true" />
          </div>
        ) : null}
        {stampCities.length ? (
          <p className={s.promise} data-room-promise="">
            <Icon name="stamp" size={18} className="text-text-muted" />
            {t('promise', { cities: stampCities.join(', ') })}
          </p>
        ) : null}
        <div className="mt-8 flex flex-col gap-4">
          {/* Штамп у кімнаті закривається «×» (постійний — лише на сторінці країни, власник 2026-11-06). */}
          <StampBlock eventId={main?.eventId ?? null} roomEventIds={eventIds} />
          <div data-first-row-slot="">
            <FirstRowModule event={firstRowEventFor(data, now)} />
          </div>

          <OfferBlock />
          <div data-moment-slot="">
            <OverlayInFlowOutlet label={t('heading')} />
          </div>
        </div>
        <StreamCards
          heading={t('currentTitle')}
          sub={
            zone && zoneMidnight
              ? t('currentSub', {
                  zone: utcLabel(zone.offsetMinutes),
                  time: formatClock(zoneMidnight),
                })
              : undefined
          }
          rows={currentRows}
          currentStreamId={null}
          onSelect={(row) => toggleFromCard({ sourceId: row.id, eventId: row.eventId })}
          onAddToRoom={(row) => add({ sourceId: row.id, eventId: row.eventId })}
          showCountry
          phoneLimit={5}
          filter={{
            value: currentFilter,
            onChange: (v) =>
              v === 'mine' && !hasPass ? passWindows.openPassInfoBoard() : setCurrentFilter(v),
            scheduleLocked: !hasPass,
            scheduleCount: liveRows.filter((r) => inSchedule(r.eventId)).length,
            hideLive: true,
          }}
          className="mt-10"
        />
        <RoomHowTo className="mt-10" />
        {chatColumn ? (
          chatSlot && !vis.hidden ? (
            createPortal(panel('h-full'), chatSlot)
          ) : null
        ) : (
          <ChatDock
            room={chatRoomCountry ?? 'world'}
            roomLabel={
              country
                ? tChat('roomCountryPicker', { country: country.name.uk })
                : tChat('roomWorld')
            }
          >
            {panel('min-h-0 flex-1')}
          </ChatDock>
        )}
      </div>
    </RoomPageContext.Provider>
  );
}
