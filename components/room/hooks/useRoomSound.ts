/**
 * Звук в одному вікні кімнати: перенесення звуку (`moveSound`), опитування стану плеєрів, клавіші 1–4.
 * Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import type { GuestRoomWindow } from '@/lib/data/types';
import { cityOf } from '@/lib/live/cityOf';
import type { useOptionalPlayer, useOptionalPlayerActions } from '@/lib/player/PlayerProvider';
import { posOf, useRoomStore } from '@/stores/room';
import { roomPlayers } from '@/components/room/parts/RoomWindowPlayer';

const SOUND_POLL_MS = 1_000;
/** Після «Звук сюди» YouTube віддає новий стан звуку не миттєво — стільки довіряємо дії людини. */
const SOUND_GRACE_MS = 1_500;

export function useRoomSound({
  windows,
  soundSlot,
  host,
  player,
  actions,
  titleOf,
}: {
  windows: readonly GuestRoomWindow[];
  soundSlot: number | null;
  host: GuestRoomWindow | null;
  player: ReturnType<typeof useOptionalPlayer>;
  actions: ReturnType<typeof useOptionalPlayerActions>;
  titleOf: (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => string;
}) {
  const t = useTranslations('room.page');
  const announce = useAnnounce();

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

  return { isHost, applySound, soundLive, moveSound };
}
