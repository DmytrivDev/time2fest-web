'use client';

/**
 * Плеєр вікна кімнати (S-ROOM, T097).
 *
 * - Вікно 1 (головне) — НЕ цей компонент: там стоїть `PlayerSlot id="main"`, і над ним сідає єдиний `PlayerHost`
 *   макета (перехід «країна → кімната» не перезапускає відео, FR-042). Лише воно має автозапуск (FR-040).
 * - Вікна 2–4 — окремі `YT.Player` (`lib/player/youtubeApi.ts`), створені БЕЗ автозапуску (політика YouTube: автозапуск
 *   лише в одного плеєра на сторінці, 2026-11-13) і з кадром наготові (`cueVideoById`). Поки людина не натиснула
 *   («Грати» на фасаді, «Звук сюди», клавіші 1–4 → `started`), над ними — `ResumeCard` (фасад із мініатюрою).
 *   Грають без звуку, `playsinline`; звук перемикає кімната через `mute/unMute` з реєстру `roomPlayers`.
 * - Ланцюжок запасних джерел — `lib/player/chain.ts`: помилка → наступне джерело, `player:source-switched`
 *   для слота `room:N`. Вибране людиною джерело йде першим, як у головного плеєра.
 * - iframe живе у вузлі, яким не керує React (API замінює його); поверх відео нічого немає.
 * - Додана трансляція ще не почалась (`startsAt` попереду; 2026-11-11) — у вікні заглушка «Трансляція очікується» з
 *   відліком (без iframe — отже й без «на весь екран»); о `startsAt` вікно переходить у «готове» (фасад), само не грає.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { emit } from '@/lib/events/bus';
import { advanceChain, selectSource, type ChainCause } from '@/lib/player/chain';
import type { ChainSelection, PlayerSlotId, PlayerSource } from '@/lib/player/types';
import { createYouTubePlayer, YTState, type YouTubePlayerHandle } from '@/lib/player/youtubeApi';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { getData } from '@/lib/data/load';
import { WaitingScene } from '@/components/player/CountdownScene';
import { useGuestStore } from '@/stores/guest';
import { ResumeCard } from './RoomGrid';

// ── Реєстр плеєрів вікон 2–4 (для перемикання звуку з кімнати) ─────────────

const players = new Map<number, YouTubePlayerHandle>();

export const roomPlayers = {
  get(slot: number): YouTubePlayerHandle | undefined {
    return players.get(slot);
  },
  entries(): [number, YouTubePlayerHandle][] {
    return [...players.entries()];
  },
};

const FRAME = 'relative aspect-video w-full min-h-player-min-height min-w-player-min-height overflow-hidden bg-surface';

export interface RoomWindowPlayerProps {
  slot: number;
  eventId: string;
  sources: readonly PlayerSource[];
  /** Джерело, яке людина додала в кімнату. */
  preferredSourceId: string;
  title: string;
  /** Людина запустила вікно в цьому сеансі. */
  started: boolean;
  /** Це вікно зі звуком: після готовності вмикаємо звук, якщо людина вже вмикала його в сеансі. */
  hasSound: boolean;
  soundAllowed: boolean;
  onStart(slot: number): void;
}

export function RoomWindowPlayer({
  slot,
  eventId,
  sources,
  preferredSourceId,
  title,
  started,
  hasSound,
  soundAllowed,
  onStart,
}: RoomWindowPlayerProps) {
  const t = useTranslations('room.page');
  const time = useTimeSource();
  const slotId: PlayerSlotId = `room:${slot}`;
  const facebookConsent = useGuestStore((s) => s.consent.facebookVideo);
  const [failed, setFailed] = useState<string[]>([]);

  // Інше джерело чи подія у вікні (заміна) → новий ланцюжок, без старих недоступних.
  const [chainKey, setChainKey] = useState(`${eventId}|${preferredSourceId}`);
  const key = `${eventId}|${preferredSourceId}`;
  if (key !== chainKey) {
    setChainKey(key);
    setFailed([]);
  }

  // Очікувана трансляція: заглушка до `startsAt`, далі вибір перераховується (ключ змінюється раз — о початку).
  const now = useNow();
  const preferredSrc = sources.find((s) => s.id === preferredSourceId);
  const startsAt = preferredSrc?.startsAt ? Date.parse(preferredSrc.startsAt) : NaN;
  const waiting = Number.isFinite(startsAt) && startsAt > now;
  const selection = useMemo<ChainSelection>(() => {
    void waiting;
    const ctx = { slot: slotId, eventId, sources, failed, facebookConsent, now: time.now() };
    const preferred = sources.find((s) => s.id === preferredSourceId);
    if (preferred && !failed.includes(preferred.id)) {
      const picked = selectSource({ ...ctx, sources: [preferred] });
      if (picked.kind === 'source') return picked;
    }
    return selectSource(ctx);
  }, [slotId, eventId, sources, failed, facebookConsent, time, preferredSourceId, waiting]);

  const videoId = selection.kind === 'source' && selection.source.platform === 'youtube' ? (selection.source.videoId ?? null) : null;

  const live = useRef({ selection, failed, sources, eventId, facebookConsent, hasSound, soundAllowed, started });
  useLayoutEffect(() => {
    live.current = { selection, failed, sources, eventId, facebookConsent, hasSound, soundAllowed, started };
  });

  const handleBreak = useCallback(
    (cause: ChainCause) => {
      const c = live.current;
      if (c.selection.kind !== 'source') return;
      const tr = advanceChain(
        { slot: slotId, eventId: c.eventId, sources: c.sources, failed: c.failed, facebookConsent: c.facebookConsent, now: time.now() },
        { currentSourceId: c.selection.source.id, cause },
      );
      if (tr.type !== 'switched') return;
      setFailed(tr.failed);
      emit('player:source-switched', tr.switched);
    },
    [slotId, time],
  );

  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<YouTubePlayerHandle | null>(null);
  const creating = useRef(false);
  const unmounted = useRef(false);
  const run = started && videoId !== null && !waiting;
  const ready = videoId !== null && !waiting;

  /** Старт відтворення — лише після дії людини (`started`): грає без звуку, звук — якщо це вікно зі звуком. */
  const startPlayback = useCallback((handle: YouTubePlayerHandle) => {
    handle.play();
    if (live.current.hasSound && live.current.soundAllowed) handle.unMute();
  }, []);

  // Створення плеєра (один раз на вікно) — БЕЗ автозапуску, з кадром наготові (cue). Зміна відео: людина вже
  // запустила вікно → loadVideoById, ні → cueVideoById (кадр змінюється, але не грає).
  useEffect(() => {
    if (!ready || !videoId) return;
    const h = handleRef.current;
    if (h) {
      if (live.current.started) {
        h.load(videoId);
        h.play();
      } else h.cue(videoId);
      return;
    }
    const host = hostRef.current;
    if (!host || creating.current) return;
    creating.current = true;
    const mount = document.createElement('div');
    host.appendChild(mount);
    createYouTubePlayer(mount, {
      videoId,
      autoplay: false,
      handlers: {
        onReady: () => {
          const handle = handleRef.current;
          if (handle && live.current.started) startPlayback(handle);
        },
        onStateChange: (state) => {
          if (state === YTState.ENDED) handleBreak({ type: 'ended' });
        },
        onError: (code) => handleBreak({ type: 'error', code }),
        onAutoplayBlocked: () => {
          const handle = handleRef.current;
          if (handle && live.current.started && !handle.isMuted()) {
            handle.mute();
            handle.play();
          }
        },
      },
    })
      .then((handle) => {
        if (unmounted.current) {
          handle.destroy();
          return;
        }
        handleRef.current = handle;
        players.set(slot, handle);
        const sel = live.current.selection;
        const wanted = sel.kind === 'source' ? sel.source.videoId : undefined;
        if (wanted) {
          if (live.current.started) handle.load(wanted);
          else handle.cue(wanted);
        }
      })
      .catch((err: unknown) => console.error('[room player]', err))
      .finally(() => {
        creating.current = false;
      });
  }, [ready, videoId, slot, handleBreak, startPlayback]);

  // Людина запустила вікно («Грати», «Звук сюди», «+» не рахується) → відтворення; скинула (заміна) → пауза.
  useEffect(() => {
    const h = handleRef.current;
    if (!h) return; // ще створюється: `onReady` запустить, якщо `started`
    if (started) startPlayback(h);
    else h.pause();
  }, [started, startPlayback]);

  // Розмонтування вікна (прибрали, вікно стало головним, вихід з кімнати) — знищення плеєра.
  useEffect(() => {
    // Strict Mode: cleanup і одразу знову effect — плеєр, що ще створюється, лишається.
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      const h = handleRef.current;
      handleRef.current = null;
      if (players.get(slot) === h) players.delete(slot);
      h?.destroy();
    };
  }, [slot]);

  let fallback = null;
  const country = getData().countriesByIso.get(getData().eventsById.get(eventId)?.countryIso ?? '');
  if (waiting && country) {
    fallback = (
      <div className={FRAME}>
        <WaitingScene compact country={country} waitingFor={{ title, startsAt }} className="absolute inset-0" />
      </div>
    );
  } else if (!started) {
    const thumb = selection.kind === 'source' ? selection.source.videoId : undefined;
    fallback = <ResumeCard title={title} videoId={thumb} onActivate={() => onStart(slot)} />;
  } else if (!videoId) {
    fallback = (
      <div className={`${FRAME} flex items-center justify-center p-4`} role="status">
        <p className="text-body text-text-secondary">{t('unavailable')}</p>
      </div>
    );
  }

  return (
    <div data-player-slot={slotId} data-player-state={run ? 'video' : 'fallback'} className="w-full">
      {fallback}
      {/* Вузол для iframe: без React-дітей. Схований, поки вікно показує фасад. */}
      <div ref={hostRef} hidden={!run} className={FRAME} />
    </div>
  );
}
