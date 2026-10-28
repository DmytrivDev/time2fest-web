'use client';

/**
 * Кімната перегляду (S-ROOM, US3, T100): склад сторінки й керування плеєрами вікон.
 *
 * Десктоп: `RoomGrid` (шапка «← <країна>», «+ Додати трансляцію» → панель, сітка 1 / 2 / 2×2) · під сіткою
 * «Звук у вікні «Париж»», слот «Першого ряду» (US5), «Трансляції в цьому поясі» з «+»; праворуч колонка чату макета
 * (кімнати «Світ» і «Країна» вікна зі звуком). Телефон: до 2 вікон одне під одним, «+ Додати трансляцію» → аркуш,
 * вкладки «Трансляції | Чат».
 *
 * Плеєри (FR-031, FR-040, FR-042):
 * - вікно 1 = `PlayerSlot id="main"`: над ним сідає єдиний `PlayerHost` макета, тож відео, що грало на сторінці
 *   країни, грає далі без перезапуску; при відкритті кімнати те, що грає, стає першим вікном (`adoptMain`);
 * - вікна 2–4 — `RoomWindowPlayer`: стартують лише після дії людини, без звуку;
 * - звук в одному вікні: «Звук сюди» вимикає звук в інших (`mute`) і вмикає у вибраному (`unMute`, у жесті людини);
 *   якщо людина ввімкнула звук кнопкою самого плеєра, кімната помічає це (опитування `isMuted` раз на секунду)
 *   і переносить звук туди. Оголошення «Звук перенесено на …».
 * - «← <країна>» веде на сторінку країни вікна зі звуком; якщо це не головне вікно, головний плеєр спершу бере
 *   його трансляцію (сторінка країни її підхоплює).
 */
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { ZoneStreamsBlock } from '@/components/live/StreamList';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { Button } from '@/components/primitives/Button';
import { Countdown } from '@/components/primitives/Countdown';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { OverlayInFlowOutlet, useChatColumn } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Dataset, GuestRoomWindow, RoomId } from '@/lib/data/types';
import { countryStreamRows, streamRows, zoneStreamRows, type StreamRowData } from '@/lib/live/countryData';
import { countryHref } from '@/lib/player/BroadcastController';
import { useOptionalPlayer, useOptionalPlayerActions, type PlayerChainInput } from '@/lib/player/PlayerProvider';
import { useStampGrant } from '@/lib/presence/useStampGrant';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { roomLimit, useRoom, useRoomStore } from '@/stores/room';
import { AddStreamPanel } from './AddStreamPanel';
import { RoomGrid, type RoomWindowView } from './RoomGrid';
import { roomPlayers, RoomWindowPlayer } from './RoomWindowPlayer';
import { useRoomViewport } from './useRoomViewport';
import { FirstRowModule } from '@/components/firstrow/FirstRowModule';
import { firstRowEventFor } from '@/lib/firstrow/pick';

const SOUND_POLL_MS = 1_000;

function chainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  return preferredSourceId ? { eventId, sources, preferredSourceId } : { eventId, sources };
}

function cityOf(title: string): string {
  return title.split(' · ')[0] ?? title;
}

function sourceTitle(data: Dataset, w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>): string {
  const src = data.chainsByEventId.get(w.eventId)?.sources.find((s) => s.id === w.sourceId);
  if (src) return src.title.uk;
  const ev = data.eventsById.get(w.eventId);
  return ev ? (data.citiesById.get(ev.cityId)?.name.uk ?? '') : '';
}

export function RoomLive() {
  const t = useTranslations('room.page');
  const tHeader = useTranslations('room.header');
  const tChat = useTranslations('chat');
  const data = getData();
  const router = useRouter();
  const announce = useAnnounce();
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

  const room = useRoom();
  const store = useRoomStore();
  const { pickTarget, started } = store;
  const schedule = useGuestStore((s) => s.schedule);
  const stamps = useGuestStore((s) => s.stamps);

  // На телефоні видно до 2 вікон (збережені з десктопа 3–4 лишаються в `guest.room`).
  const windows = useMemo(() => room.windows.slice(0, limit), [room.windows, limit]);
  const soundSlot = windows.some((w) => w.slot === room.soundSlot) ? room.soundSlot : (windows[0]?.slot ?? null);
  const main = windows[0] ?? null;
  const soundWindow = windows.find((w) => w.slot === soundSlot) ?? main;

  // ── Головне вікно = спільний PlayerHost ──
  // Один раз, коли час відомий: те, що вже грає, стає першим вікном (без перезапуску); інакше — ланцюжок першого вікна.
  // Далі: перше вікно змінилось (прибрали чи замінили головне) → головний плеєр бере його трансляцію.
  // `setChain` з тим самим ланцюжком нічого не робить, тож автоперемикання на запасне джерело не скидається.
  const adoptedRef = useRef(false);
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  });
  const mainSource = main?.sourceId;
  const mainEvent = main?.eventId;
  useEffect(() => {
    if (!known || !actions) return;
    if (!adoptedRef.current) {
      adoptedRef.current = true;
      const p = playerRef.current;
      const sel = p?.selection;
      if (p?.eventId && sel && sel.kind !== 'countdown-scene') {
        useRoomStore.getState().adoptMain({ sourceId: sel.source.id, eventId: p.eventId }, viewport);
      }
    }
    // Свіжий стан зі сховища (не із замикання): після `adoptMain` перше вікно — те, що грає.
    const first = useGuestStore.getState().room.windows[0];
    if (first) actions.setChain(chainInput(data, first.eventId, first.sourceId));
  }, [known, actions, data, viewport, mainEvent, mainSource]);

  // ── Звук в одному вікні ──
  const applySound = useCallback(
    (list: readonly GuestRoomWindow[], target: number | null, skipTarget = false) => {
      list.forEach((w, i) => {
        const on = w.slot === target;
        if (on && skipTarget) return;
        if (i === 0) {
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

  const titleOf = useCallback((w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => sourceTitle(data, w), [data]);

  const moveSound = useCallback(
    (slot: number, opts: { apply: boolean }) => {
      const w = windows.find((x) => x.slot === slot);
      if (!w) return;
      useRoomStore.getState().setSound(slot);
      if (!useRoomStore.getState().started.includes(slot) && w !== windows[0]) useRoomStore.getState().markStarted(slot);
      applySound(windows, slot, !opts.apply);
      announce(t('soundMoved', { city: cityOf(titleOf(w)) }));
    },
    [windows, applySound, announce, t, titleOf],
  );

  // Головний плеєр сам увімкнув звук (людина вже вмикала звук у сеансі), а звук — в іншому вікні → вимкнути.
  const mainMuted = player?.muted ?? true;
  useEffect(() => {
    if (!mainMuted && main && soundSlot !== main.slot) actions?.mute();
    // лише на зміну стану звуку головного плеєра
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainMuted]);

  // Звук увімкнули кнопкою самого плеєра в іншому вікні → звук переходить туди, решта вимикається.
  const live = useRef({ windows, soundSlot, moveSound, actions });
  useEffect(() => {
    live.current = { windows, soundSlot, moveSound, actions };
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      const { windows: list, soundSlot: cur, moveSound: move, actions: act } = live.current;
      if (list.length < 2) return;
      for (const [i, w] of list.entries()) {
        if (w.slot === cur) continue;
        const unmuted = i === 0 ? act?.isMuted() === false : roomPlayers.get(w.slot)?.isMuted() === false;
        if (unmuted) {
          move(w.slot, { apply: false });
          return;
        }
      }
    }, SOUND_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  // ── Дії ──
  const add = useCallback(
    (row: StreamRowData) => {
      useRoomStore.getState().add({ sourceId: row.id, eventId: row.eventId }, viewport);
    },
    [viewport],
  );

  const remove = useCallback(
    (slot: number) => {
      const s = useRoomStore.getState();
      const removed = windows.find((w) => w.slot === slot);
      const hadSound = soundSlot === slot;
      s.remove(slot);
      const after = useGuestStore.getState().room;
      if (hadSound && after.soundSlot !== null) applySound(after.windows.slice(0, limit), after.soundSlot);
      if (removed) announce(t('removed', { city: cityOf(titleOf(removed)) }));
    },
    [windows, soundSlot, applySound, limit, announce, t, titleOf],
  );

  const replace = useCallback((slot: number) => useRoomStore.getState().replace(slot), []);
  const start = useCallback((slot: number) => useRoomStore.getState().markStarted(slot), []);

  // ── Країна вікна зі звуком ──
  const soundEvent = soundWindow ? data.eventsById.get(soundWindow.eventId) : undefined;
  const soundCountry = soundEvent ? data.countriesByIso.get(soundEvent.countryIso) : undefined;
  // Країни вікон кімнати перегляду: чип «Країна» з переліком — лише коли їх кілька.
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
  const country =
    (pickedIso ? windowCountries.find((c) => c.iso === pickedIso) && data.countriesByIso.get(pickedIso) : undefined) ?? soundCountry;
  const backHref = soundCountry ? countryHref(soundCountry) : '/';

  const onBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!soundWindow || !main || soundWindow.slot === main.slot || !actions) return;
    e.preventDefault();
    const h = roomPlayers.get(soundWindow.slot);
    const audible = h ? !h.isMuted() : false;
    actions.setChain(chainInput(data, soundWindow.eventId, soundWindow.sourceId));
    if (audible) actions.unmute();
    router.push(backHref);
  };

  // ── Присутність, штамп, чат ──
  const eventIds = [...new Set(windows.map((w) => w.eventId))];
  useStampGrant(eventIds.length ? { source: 'room', eventIds } : null);
  useMomentWindows(soundWindow?.eventId ?? null);
  const chatRoomCountry: RoomId | null = country ? `country:${country.iso}` : null;
  const simRooms = windowCountries.map((c) => `country:${c.iso}`).join('|');
  useChatSimulator(
    useMemo(
      () => ['world', ...(simRooms ? simRooms.split('|') : chatRoomCountry ? [chatRoomCountry] : [])] as RoomId[],
      [simRooms, chatRoomCountry],
    ),
  );

  // ── Перегляд вікон ──
  const views: RoomWindowView[] = windows.map((w) => {
    const ev = data.eventsById.get(w.eventId);
    const row = ev && known ? streamRows(data, [ev], minute).find((r) => r.id === w.sourceId) : undefined;
    // Головне вікно: назва того джерела, яке справді грає (після автоперемикання — запасного).
    const sel = w === main && player?.eventId === w.eventId ? player.selection : null;
    const title = sel && sel.kind !== 'countdown-scene' ? titleOf({ eventId: w.eventId, sourceId: sel.source.id }) : titleOf(w);
    return {
      slot: w.slot,
      title,
      city: cityOf(title),
      status: row?.status ?? 'live',
      hasSound: windows.length > 1 && w.slot === soundSlot,
      inSchedule: schedule.includes(w.eventId),
      stamped: stamps.some((s) => s.eventId === w.eventId),
    };
  });

  const renderMedia = (slot: number) => {
    const w = windows.find((x) => x.slot === slot);
    if (!w) return null;
    if (w === main) return <PlayerSlot id="main" className="rounded-md" />;
    return (
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
  };

  // ── Додати трансляцію: пояс головного вікна, країна вікна зі звуком ──
  const zoneEvent = (main ? data.eventsById.get(main.eventId) : undefined) ?? (player?.eventId ? data.eventsById.get(player.eventId) : undefined);
  const zoneId = zoneEvent?.zoneId ?? null;
  const iso = soundEvent?.countryIso ?? zoneEvent?.countryIso ?? '';
  const midnightMs = zoneEvent?.midnightMs ?? 0;
  const countryRows = zoneId && known ? countryStreamRows(data, iso, zoneId, minute) : [];
  const zoneRows = zoneId && known ? zoneStreamRows(data, zoneId, iso, minute) : [];
  const inRoomIds = useMemo(() => room.windows.map((w) => w.sourceId), [room.windows]);
  const full = windows.length >= limit;
  const zoneNote = known && midnightMs ? (now < midnightMs ? t('zoneNoteBefore', { minutes: Math.ceil((midnightMs - now) / 60_000) }) : t('zoneNoteAfter')) : undefined;

  const [addOpen, setAddOpen] = useState(false);
  const addTrigger = (
    <Button variant="tonal" iconLeft="plus" aria-expanded={addOpen}>
      {tHeader('add')}
    </Button>
  );
  const addControl = (
    <AddStreamPanel
      layout={viewport}
      open={addOpen}
      onOpenChange={setAddOpen}
      trigger={addTrigger}
      countryName={soundCountry?.name.uk ?? ''}
      countryStreams={countryRows}
      zoneStreams={zoneRows}
      midnightMs={midnightMs}
      zoneNote={zoneNote}
      inRoomIds={inRoomIds}
      full={full}
      onPick={add}
    />
  );

  const pick = pickTarget ? { title: titleOf(pickTarget) } : null;
  const soundStatus = windows.length > 1 && soundWindow ? t('soundStatus', { city: cityOf(titleOf(soundWindow)) }) : undefined;

  const grid = (
    <RoomGrid
      layout={viewport}
      countryName={soundCountry?.name.uk ?? ''}
      countryHref={backHref}
      onBack={onBack}
      windows={views}
      limit={limit}
      pickTarget={pick}
      countdown={known && midnightMs > now ? <Countdown target={midnightMs} variant="inline" label={t('untilMidnight')} /> : null}
      renderMedia={renderMedia}
      onAdd={() => setAddOpen(true)}
      addControl={addControl}
      onRemove={remove}
      onSound={(slot) => moveSound(slot, { apply: true })}
      onReplace={replace}
      onCancelPick={() => useRoomStore.getState().cancelPick()}
      soundStatus={phone ? undefined : soundStatus}
    />
  );

  const allRows = [...countryRows, ...zoneRows];
  const streams = (
    <ZoneStreamsBlock
      streams={allRows}
      currentStreamId={null}
      midnightMs={midnightMs}
      onSelect={add}
      onAddToRoom={add}
      context="room"
      hint={full ? t('zoneHintFull') : t('zoneHint', { free: limit - windows.length, limit })}
    />
  );

  // ── Чат ──
  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const vis = useChatVisibility();
  const { collapse } = useChatDockControls();
  const panel = (className?: string) => (
    <ChatPanel
      country={country ? { iso: country.iso, name: country.name.uk } : undefined}
      countries={windowCountries}
      onCountryChange={setPickedIso}
      eventId={soundWindow?.eventId ?? null}
      cityName={soundEvent ? data.citiesById.get(soundEvent.cityId)?.name.uk : undefined}
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );

  return (
    <div data-room-page="" className="flex flex-col gap-6 px-4 py-4 md:px-6">
      {windows.length === 0 && known ? <p className="text-body text-text-secondary">{t('emptyRoom')}</p> : null}
      {grid}
      {/* Слот «Першого ряду» події вікна зі звуком (US5). */}
      <div data-first-row-slot="" data-event-id={soundWindow?.eventId}>
        <FirstRowModule event={firstRowEventFor(data, now, soundWindow ? data.eventsById.get(soundWindow.eventId) : null)} />
      </div>
      {chatColumn && vis.hidden ? <ChatHiddenButton room={chatRoomCountry ?? 'world'} onShow={vis.show} /> : null}
      <div data-moment-slot="">
        <OverlayInFlowOutlet label={t('heading')} />
      </div>
      {chatColumn ? (
        <>
          {streams}
          {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
        </>
      ) : (
        <>
          <div className="pt-4">{streams}</div>
          <ChatDock
            room={chatRoomCountry ?? 'world'}
            roomLabel={country ? tChat('roomCountryPicker', { country: country.name.uk }) : tChat('roomWorld')}
          >
            {panel('min-h-0 flex-1')}
          </ChatDock>
        </>
      )}
    </div>
  );
}
