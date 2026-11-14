'use client';

/**
 * Прокрутка й пауза стрічки `Chat`: ручна пауза / «прокручено вгору» / фокус у списку / відкрите меню → `paused`,
 * автопрокрутка вниз, лічильник «Нові повідомлення N ↓» (побачене стає прочитаним), оголошення нових, «приклеювання»
 * до низу при зміні висоти (ResizeObserver), плавна прокрутка (`scrollLogTo`), показ повідомлення з меню в потоці.
 * Порядок ефектів збережено як у компоненті.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { ChatMessage, RoomId } from '@/lib/data/types';
import type { ChatState } from './Chat';
import type { ChatMenuState } from './useChatMenu';

const SCROLL_MS = 250;
const SCROLL_PAD = 8;
const NEAR_BOTTOM = 24;

export function useChatLogScroll(o: {
  logRef: RefObject<HTMLDivElement | null>;
  state: ChatState;
  visible: readonly ChatMessage[];
  roomId: RoomId;
  defaultPaused: boolean;
  announceNew: boolean;
  menu: ChatMenuState | null;
  menuMessage: ChatMessage | null;
  inlineMenu: boolean;
}) {
  const { logRef, state, visible, roomId, defaultPaused, announceNew, menu, menuMessage, inlineMenu } = o;
  const t = useTranslations('chat');
  const announce = useAnnounce();
  const [manualPause, setManualPause] = useState(defaultPaused);
  const [scrolledUp, setScrolledUp] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const paused = manualPause || scrolledUp || focusInside || menuMessage !== null;

  const lastId = visible[visible.length - 1]?.id;
  // Автопрокрутка вниз, поки стрічка не зупинена.
  useEffect(() => {
    if (paused) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    // Останнє повідомлення, а не довжина: коли стрічка досягла ліміту, довжина лишається сталою.
  }, [logRef, lastId, paused, state]);

  // Скільки повідомлень прийшло відтоді, як стрічку зупинено (поки не на паузі — відлік іде за кінцем списку).
  // Побачене (верх повідомлення у вікні стрічки) стає прочитаним: лічильник зменшується, а коли непрочитаних нижче
  // не лишилось — капсула зникає (рішення власника: не лише в самому низу).
  // Межа «побаченого» — id останнього побаченого повідомлення, а не номер у списку: стрічка тримає щонайбільше
  // 200 повідомлень і зрізає старі з початку, тож номер «з’їжджав» і лічильник застигав на 0 (перевірка 2026-11-09).
  const lastVisibleId = visible.length ? visible[visible.length - 1]!.id : null;
  const [seenId, setSeenId] = useState<string | null>(lastVisibleId);
  if (!paused && seenId !== lastVisibleId) setSeenId(lastVisibleId);
  const seenIndex = seenId === null ? -1 : visible.findIndex((m) => m.id === seenId);
  // Побачене повідомлення вже зрізане з початку — усе, що лишилось у стрічці, новіше за нього.
  const baseline = seenId === null ? 0 : seenIndex + 1;
  const markSeen = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const bottom = el.getBoundingClientRect().bottom - 4;
    setSeenId((id) => {
      const from = id === null ? 0 : visible.findIndex((m) => m.id === id) + 1;
      let next = from;
      for (let i = from; i < visible.length; i += 1) {
        const node = el.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(visible[i]!.id)}"]`);
        if (!node || node.getBoundingClientRect().top > bottom) break;
        next = i + 1;
      }
      return next > from ? visible[next - 1]!.id : id;
    });
  }, [logRef, visible]);
  useLayoutEffect(() => {
    if (paused) markSeen();
  }, [paused, markSeen]);
  const newCount = paused ? Math.max(0, visible.length - baseline) : 0;

  // Лічильник нових на вкладці не є live-областю: оголошення «Нові повідомлення N» — не частіше ніж раз на 30 с.
  const lastAnnounce = useRef(0);
  useEffect(() => {
    if (!announceNew || newCount === 0) return;
    const at = Date.now();
    if (at - lastAnnounce.current < 30_000) return;
    lastAnnounce.current = at;
    announce(`${t('newMessages')} ${newCount}`);
  }, [newCount, announceNew, announce, t]);

  // Зміна висоти стрічки (вікно чату на телефоні розгортається, з’являється напис паузи, екранна клавіатура) не є
  // прокруткою людини: коли стрічка була внизу, лишаємо її внизу, а «прокрутка» від стиснення не зупиняє стрічку.
  const noMessages = visible.length === 0;
  const pinned = useRef(true);
  const lastClientHeight = useRef(0);
  useEffect(() => {
    const el = logRef.current;
    if (!el || typeof ResizeObserver !== 'function') return;
    let frame = 0;
    const pin = () => {
      if (pinned.current) {
        el.scrollTop = el.scrollHeight;
        setScrolledUp(false);
      }
    };
    const ro = new ResizeObserver(() => {
      pin();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(pin);
    });
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [logRef, state, noMessages]);

  const onScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    // Прокрутка від зміни висоти стрічки — не жест людини.
    const resized = el.clientHeight !== lastClientHeight.current;
    lastClientHeight.current = el.clientHeight;
    if (resized) {
      markSeen();
      return;
    }
    const up = el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_BOTTOM;
    pinned.current = !up;
    setScrolledUp(up);
    markSeen();
  }, [logRef, markSeen]);

  // Інша кімната — нова стрічка: знову внизу й не «прокручена вгору» (прокрутка зміни вмісту не є жестом людини).
  const [shownRoom, setShownRoom] = useState(roomId);
  if (shownRoom !== roomId) {
    setShownRoom(roomId);
    setScrolledUp(false);
  }
  const prevRoomEl = useRef(roomId);
  useLayoutEffect(() => {
    if (prevRoomEl.current === roomId) return;
    prevRoomEl.current = roomId;
    pinned.current = true;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logRef, roomId]);

  const reduceMotion = useReducedMotion();
  const scrollAnim = useRef(0);
  useEffect(() => () => cancelAnimationFrame(scrollAnim.current), []);

  /** Швидка плавна прокрутка (≈250 мс); за «зменшити рух» — стрибок. */
  const scrollLogTo = (target: number) => {
    const el = logRef.current;
    if (!el) return;
    cancelAnimationFrame(scrollAnim.current);
    const to = Math.max(0, Math.min(target, el.scrollHeight - el.clientHeight));
    const from = el.scrollTop;
    if (reduceMotion || Math.abs(to - from) < 1) {
      el.scrollTop = to;
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / SCROLL_MS);
      el.scrollTop = from + (to - from) * (1 - (1 - k) ** 3);
      if (k < 1) scrollAnim.current = requestAnimationFrame(step);
    };
    scrollAnim.current = requestAnimationFrame(step);
  };

  // Меню в потоці: при відкритті показуємо повідомлення разом із меню, наскільки вистачає місця (плавно).
  const menuId = inlineMenu && menu ? menu.message.id : null;
  useLayoutEffect(() => {
    if (!menuId) return;
    const el = logRef.current;
    const a = el?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(menuId)}"]`);
    const mm = a?.nextElementSibling;
    if (!el || !a || !mm) return;
    // Стрічка не «приклеєна» до низу, поки меню відкрите: ResizeObserver не повинен смикати вид.
    pinned.current = false;
    const v = el.getBoundingClientRect();
    const ar = a.getBoundingClientRect();
    const mr = mm.getBoundingClientRect();
    const need = mr.bottom - (v.bottom - SCROLL_PAD);
    const room = ar.top - (v.top + SCROLL_PAD);
    // Прокрутити вниз на `need`, але не так, щоб верх повідомлення зник; якщо все не вміщається — верх повідомлення нагорі.
    const delta = Math.min(need, room);
    if (delta > 0.5) scrollLogTo(el.scrollTop + delta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuId]);

  // «Нові повідомлення N ↓»: до першого непобаченого повідомлення (рішення власника 2026-10-27).
  const jumpToUnseen = () => {
    setManualPause(false);
    setFocusInside(false);
    const el = logRef.current;
    const first = visible[baseline];
    const node = first
      ? el?.querySelector<HTMLElement>(`[data-msg-id="${CSS.escape(first.id)}"]`)
      : null;
    if (!el) return;
    if (!node) {
      setScrolledUp(false);
      scrollLogTo(el.scrollHeight);
      return;
    }
    const offset = node.getBoundingClientRect().top - el.getBoundingClientRect().top;
    scrollLogTo(el.scrollTop + offset - SCROLL_PAD);
  };

  return { manualPause, setManualPause, scrolledUp, setFocusInside, paused, newCount, onScroll, jumpToUnseen };
}
