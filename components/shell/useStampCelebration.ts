/**
 * Свято штампа в шапці — стан і події (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, рішення власника 2026-11-12).
 * Логіка черги, таймлайну й слів — чиста, у `lib/stamp/stampCelebration`; тут — React і браузер:
 *
 * - **Звідки свято.** `moment:stamp` (+15 с) каже, за якими подіями гість був присутній; новий запис у `guest.stamps`
 *   за такою подією — штамп нараховано. Усі штампи одного моменту (кімната з кількома вікнами) — одне свято.
 *   Штампи з інших джерел (демо-набір, скидання стану) свята не дають.
 * - **Відкладення (E).** Повний екран (`document.fullscreenElement` — iframe YouTube у повноекранному режимі чи сцена
 *   відліку) або прихована вкладка (`visibilityState`) — штамп у відкладені; вийшли / повернулись — одне свято на всі.
 *   Штамп прийшов за ≤ 3 с після повернення на вкладку (такт проспав північ) — теж «Поки тебе не було».
 * - **Пауза (WCAG 2.2.1).** Наведення мишею чи фокус у шапці, а також повний екран чи прихована вкладка — таймер стоїть.
 * - **Дзвіночок.** Поки свято попереду чи грає, лічильник не показує нових сповіщень від `holdFrom` — +1 з’являється
 *   наприкінці, коли «штамп прилетів».
 * - **Читач екрана.** Один раз, ввічливо, коли свято починається: «З Новим роком, Франція! Штамп у паспорті».
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { patchedData } from '@/lib/api/hooks/site';
import { on } from '@/lib/events/bus';
import {
  addStamps,
  AVATAR_GLOW_MS,
  celebrationPhase,
  clockElapsed,
  createQueue,
  finishActive,
  hasPending,
  nextBoundary,
  pauseClock,
  RETURN_GRACE_MS,
  resumeClock,
  setEnv,
  spokenText,
  startClock,
  type Celebration,
  type CelebrationClock,
  type CelebrationEnv,
  type CelebrationPhase,
  type CelebrationQueue,
  type CelebrationStamp,
} from '@/lib/stamp/stampCelebration';
import { currentStamps, onStampGranted } from '@/lib/api/hooks/passport';
import { useClock } from '@/lib/time/TimeProvider';
import { useChatDock } from '@/stores/chatDock';

interface CelebrationStore {
  q: CelebrationQueue;
  /** Сповіщення з цього (віртуального) часу дзвіночок поки не рахує; `null` — рахує всі. */
  holdFrom: number | null;
}

/** Черга свят — одна на вкладку (шапка в макеті `(live)` одна). */
export const useCelebrationStore = create<CelebrationStore>(() => ({ q: createQueue(), holdFrom: null }));

/** Тести. */
export function resetCelebration(): void {
  useCelebrationStore.setState({ q: createQueue(readEnv()), holdFrom: null });
}

function readEnv(): CelebrationEnv {
  if (typeof document === 'undefined') return { fullscreen: false, hidden: false };
  const d = document as Document & { webkitFullscreenElement?: Element | null };
  return { fullscreen: !!(d.fullscreenElement ?? d.webkitFullscreenElement), hidden: d.visibilityState === 'hidden' };
}

const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Штамп гостя → запис свята (країна, рід, прапор). */
function toCelebrationStamp(eventId: string, grantedAt: number): CelebrationStamp | null {
  const data = patchedData();
  const event = data.eventsById.get(eventId);
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  return {
    eventId,
    country: country?.name.uk ?? data.citiesById.get(event.cityId)?.name.uk ?? '',
    gender: country?.gender ?? null,
    flagCode: country?.flagCode ?? event.countryIso,
    grantedAt,
  };
}

/** Прокрутити до картки штампу під плеєром і поставити на неї фокус; на телефоні спершу згорнути розгорнутий чат. */
export function scrollToStampCard(reduced: boolean): boolean {
  if (typeof document === 'undefined') return false;
  const dock = useChatDock.getState();
  if (dock.expanded) dock.setExpanded(false);
  const card = document.querySelector<HTMLElement>('[data-stamp-card]');
  if (!card) return false;
  const go = () => {
    card.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'center' });
    card.focus({ preventScroll: true });
  };
  // Згорнутий чат міняє висоту сторінки — прокручуємо в наступному кадрі.
  if (dock.expanded && typeof requestAnimationFrame === 'function') requestAnimationFrame(go);
  else go();
  return true;
}

export interface StampCelebrationState {
  celebration: Celebration | null;
  phase: CelebrationPhase;
  reduced: boolean;
  paused: boolean;
  /** Аватар коротко світиться золотом (після свята). */
  glow: boolean;
  holdFrom: number | null;
  /** Наведення / фокус у шапці. */
  setHold(reason: 'hover' | 'focus', on: boolean): void;
}

export function useStampCelebration({ guest }: { guest: boolean }): StampCelebrationState {
  const clock = useClock();
  const reduced = useReducedMotion();
  const announce = useAnnounce();
  const t = useTranslations('header.celebration');
  const tA11y = useTranslations('a11y');
  const q = useCelebrationStore((s) => s.q);
  const holdFrom = useCelebrationStore((s) => s.holdFrom);
  const virtualNow = useCallback(() => clock.getSnapshot() || clock.source.now(), [clock]);

  // ── Звідки свято: момент + новий штамп ───────────────────────────────────────────
  const expected = useRef(new Set<string>());
  const lastVisibleAt = useRef(-Infinity);
  useEffect(() => on('moment:stamp', (p) => p.presentEventIds.forEach((id) => expected.current.add(id))), []);
  useEffect(() => {
    const seen = new Set(currentStamps().map((s) => s.eventId));
    let batch: { eventId: string; grantedAt: number }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const items = batch.filter((s) => expected.current.delete(s.eventId));
      batch = [];
      const stamps = items.map((s) => toCelebrationStamp(s.eventId, s.grantedAt)).filter((s): s is CelebrationStamp => s !== null);
      if (!stamps.length) return;
      const now = virtualNow();
      const { q: prev, holdFrom: hold } = useCelebrationStore.getState();
      const next = addStamps(prev, stamps, now, { returning: realNow() - lastVisibleAt.current < RETURN_GRACE_MS });
      if (next === prev) return;
      // Сповіщення про цей штамп створено в той самий такт — тримаємо з запасом у секунду.
      useCelebrationStore.setState({ q: next, holdFrom: hold ?? now - 1_000 });
    };
    // Шов E5b: штамп видає сервіс паспорта — свято від його події `granted`.
    return onStampGranted((s) => {
      if (seen.has(s.eventId)) return;
      seen.add(s.eventId);
      batch.push({ eventId: s.eventId, grantedAt: s.grantedAt });
      // Усі штампи одного `moment:stamp` видаються синхронно — збираємо їх в одне свято.
      if (timer === undefined) timer = setTimeout(flush, 0);
    });
  }, [virtualNow]);

  // ── Повний екран і вкладка ───────────────────────────────────────────────────────
  const [env, setEnvState] = useState<CelebrationEnv>(() => readEnv());
  useEffect(() => {
    const update = () => {
      const next = readEnv();
      if (!next.hidden && useCelebrationStore.getState().q.env.hidden) lastVisibleAt.current = realNow();
      setEnvState(next);
      const { q: prev, holdFrom: hold } = useCelebrationStore.getState();
      const q2 = setEnv(prev, next, virtualNow());
      useCelebrationStore.setState({ q: q2, holdFrom: hasPending(q2) ? hold : null });
    };
    update();
    document.addEventListener('fullscreenchange', update);
    document.addEventListener('webkitfullscreenchange', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      document.removeEventListener('webkitfullscreenchange', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [virtualNow]);

  // ── Таймлайн поточного свята ─────────────────────────────────────────────────────
  const active = q.active;
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus || env.fullscreen || env.hidden;
  const [run, setRun] = useState<{ id: number; clock: CelebrationClock; phase: CelebrationPhase } | null>(null);
  const [glow, setGlow] = useState(false);

  // Нове свято — новий відлік і одне оголошення.
  const announced = useRef(0);
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- нове свято з черги запускає власний таймер
    setRun((r) => {
      if (r && r.id === active.id) return r;
      const c = startClock(realNow());
      return { id: active.id, clock: paused ? pauseClock(c, realNow()) : c, phase: celebrationPhase(0, reduced) };
    });
    if (announced.current !== active.id) {
      announced.current = active.id;
      const tr = t as unknown as (key: string, params?: Record<string, string | number>) => string;
      const one = active.kind === 'now' && active.stamps.length === 1 && !guest ? active.stamps[0]! : null;
      // «З Новим роком, Франція! Штамп у паспорті» (a11y.midnightMoment); інші випадки — словами свята.
      announce(one ? tA11y('midnightMoment', { country: one.country }) : spokenText(active, guest, tr));
    }
  }, [active, announce, guest, reduced, t, tA11y, paused]);

  // Пауза й продовження.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- пауза/продовження годинника свята
    setRun((r) => (r ? { ...r, clock: paused ? pauseClock(r.clock, realNow()) : resumeClock(r.clock, realNow()) } : r));
  }, [paused]);

  // Межі фаз — таймером; кінець — наступне свято з черги.
  useEffect(() => {
    if (!run || run.clock.since === null) return;
    const elapsed = clockElapsed(run.clock, realNow());
    const phase = celebrationPhase(elapsed, reduced);
    if (phase !== run.phase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- фаза похідна від часу; переходи за таймером
      setRun({ ...run, phase });
      return;
    }
    if (phase === 'done') {
      setRun(null);
      const next = finishActive(useCelebrationStore.getState().q);
      useCelebrationStore.setState((s) => ({ q: next, holdFrom: hasPending(next) ? s.holdFrom : null }));
      if (!reduced) setGlow(true);
      return;
    }
    const wait = nextBoundary(elapsed, reduced);
    if (wait === null) return;
    const id = setTimeout(() => setRun((r) => (r ? { ...r } : r)), wait + 5);
    return () => clearTimeout(id);
  }, [run, reduced]);

  useEffect(() => {
    if (!glow) return;
    const id = setTimeout(() => setGlow(false), AVATAR_GLOW_MS);
    return () => clearTimeout(id);
  }, [glow]);

  const setHold = useCallback((reason: 'hover' | 'focus', v: boolean) => {
    if (reason === 'hover') setHover(v);
    else setFocus(v);
  }, []);

  const live = active && run && run.id === active.id ? run : null;
  return {
    celebration: live ? active : null,
    phase: live ? live.phase : 'done',
    reduced,
    paused,
    glow,
    holdFrom,
    setHold,
  };
}
