'use client';

/**
 * ChatDock — закріплене вікно чату внизу на телефоні (рішення 2026-10-27, макети `Phone-Chat-Dock`, `Phone-Chat-Expanded`).
 * Замінює вкладки «Події | Чат»: чат завжди на екрані. Згорнутий — ручка 36×4 і рядок «Розгорнути чат» зі жовтою
 * пілюлею «N нових» (нові з моменту згортання, власні не рахуємо), 46 px + безпечна зона (≥ 58 px). Розгорнутий — накриває
 * все під рядком часу (відео й рядок часу лишаються; смуга під ним, позначена `data-dock-above`, — теж), сторінка не прокручується.
 * Жести лише на шапці (ручка + рядок інструментів): свайп угору розгортає, униз згортає; вікно йде за пальцем,
 * відпустили далі середини або швидким рухом — доїжджає (200 мс, без анімації за «зменшити рух»). Дотик до шапки поза
 * кнопками перемикає стан; Esc і шеврон «Згорнути чат» згортають, фокус іде на шапку.
 * Вікна чату (O-NICK, O-AUTHOR, правила) відкриваються всередині вікна — у `#chat-dock-slot`.
 * Усі інші вікна (пас, графік, тост, «Поділитися», вхід…) — окремий шар поверх сторінки (`#layer-dock-slot`,
 * рішення 2026-10-29 і 2026-11-04), не пов’язаний із вікном чату: чат під ним лишається таким, яким був, і не рухається.
 * Два види шторок, обидва без затемнення (верх — `lib/overlay/sheetTop.ts`, одне правило сайту, 2026-11-10): вікна чату,
 * відкриті при згорнутому чаті, — до низу рядка часу (як сам чат); решта — вищі, до самого відео (накривають рядок часу
 * й смугу під ним). Альбом — на весь екран; з клавіатурою — видима область
 * над нею. З шару в чат не перейти — лише закрити: свайп униз з ручки чи шапки, дотик до ручки, «×», Esc. Розгорнути шар
 * не можна — він відкривається лише кнопкою, що відкриває вікно.
 * Шар назвався `seat` (від вікна покупки «Першого ряду»); ряд прибрано 2026-11-12 — тепер `layer`, `#layer-dock-slot`.
 * Новий тост (рішення власника 2026-11-12, дошка `Phone-Toast-New`): згорнутий рядок ≈10 с показує його (прапор, нік,
 * текст) замість «Розгорнути чат» — потім як завжди (`useArrivingToast`).
 */
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  useContext,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { EmojiText } from '@/components/primitives/Emoji';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { CHAT_DOCK_SLOT_ID, LAYER_DOCK_SLOT_ID } from '@/components/primitives/Panel';
import { useArrivingToast, useWorldToasts } from '@/components/toast/useWorldToasts';
import { CLOSE_MS, isLayerSpec, notifyOverlaySlots, useOverlay, usePhoneLandscape } from '@/components/shell/OverlayManager';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { measureSheetTop, SHEET_TOP_SOURCES, stableViewportH } from '@/lib/overlay/sheetTop';
import type { RoomId } from '@/lib/data/types';
import { useNow } from '@/lib/time/TimeProvider';
import { formatCount, useChatUi, useHiddenCount, useRepliesToMe } from '@/stores/chat';
import { useChatDock } from '@/stores/chatDock';
import tm from './toastMessage.module.css';

/** Дані вікна для його вмісту: у альбомі розгорнутий чат дає кнопку «До відео» в шапку. */
export const ChatDockContext = createContext<{ toVideo: (() => void) | null }>({ toVideo: null });
export const useChatDockContext = () => useContext(ChatDockContext);

/** Висота зони жестів у згорнутому стані: ручка + рядок. */
const COLLAPSED_ROW = 46;
const MOVE_THRESHOLD = 6;
/** Найменша висота розгорнутого вікна під смугою; менше — чат займає всю видиму область (накриває відео й смугу). */
const MIN_DOCK = 300;
/** Скільки висоти має «з’їсти» екранна клавіатура, щоб вважати її відкритою. */
const KB_MIN = 80;
const FIELD = '[data-composer] textarea, [data-composer] input';
const FLICK_PX_PER_MS = 0.5;
/** Усе, що в шапці працює саме по собі (дотик не перемикає вікно). */
const INTERACTIVE = 'button, a, input, textarea, select, [role="radiogroup"], [role="group"], [role="menu"]';
const ZONE = '[data-dock-grip], .t2f-dock-grip-handle';
/** Зона жестів шару вікон: ручка й шапка вікна. */
const LAYER_ZONE = '.t2f-layer-grip, [data-window-layer] [data-board-header]';
/** Скільки протягнути шар униз (px), щоб він закрився, якщо відпустили повільно. */
const LAYER_CLOSE_PX = 80;

/**
 * Телефон-альбом: усе, що лишається над чатом (відео, рядок часу й позначене `data-dock-above`), — прямі діти `<main>`; беремо
 * останнього з них (за порядком у DOM). Чат у потоці стає одразу після нього.
 */
function findAnchor(main: HTMLElement | null): HTMLElement | null {
  if (!main) return null;
  let last: HTMLElement | null = null;
  document.querySelectorAll<HTMLElement>('[data-dock-above]').forEach((el) => {
    let n: HTMLElement | null = el;
    while (n && n.parentElement !== main) n = n.parentElement;
    if (n) last = n;
  });
  if (last) return last;
  return main.querySelector<HTMLElement>(':scope > [data-player-slot="main"]');
}

interface DragState {
  id: number;
  startY: number;
  startH: number;
  collapsedH: number;
  expandedH: number;
  lastY: number;
  lastT: number;
  v: number;
  moved: boolean;
  h: number;
}

/** Керування вікном з будь-якого місця сторінки (смуга під плеєром, вікна). */
export function useChatDockControls() {
  const now = useNow();
  const setExpanded = useChatDock((s) => s.setExpanded);
  const markHidden = useChatUi((s) => s.markHidden);
  const expand = useCallback(() => {
    markHidden(null);
    setExpanded(true);
  }, [markHidden, setExpanded]);
  const collapse = useCallback(() => {
    // Вікно чату (автор, нік, правила) не закриваємо: згорнули — розгорнули й бачимо його в тому самому вигляді.
    markHidden(now);
    setExpanded(false);
  }, [markHidden, now, setExpanded]);
  return { expand, collapse };
}

export interface ChatDockProps {
  /** Кімната для лічильника «N нових» (кімната за замовчуванням сторінки). */
  room: RoomId;
  roomLabel: string;
  /** `ChatPanel` (з `collapseMode`). */
  children: ReactNode;
}

export function ChatDock({ room, roomLabel, children }: ChatDockProps) {
  const t = useTranslations('chat');
  const expanded = useChatDock((s) => s.expanded);
  const overlay = useOverlay();
  // Відкрите вікно поза чатом — окремий шар; вікно чату під ним не змінюється.
  const layerOpen = isLayerSpec(overlay.current);
  // Шар закривається: ще видимий і їде вниз (OverlayManager тримає вміст `CLOSE_MS`).
  const layerClosing = !layerOpen && isLayerSpec(overlay.closing);
  // Два види шторок (рішення власника 2026-11-04): вікна чату — до низу рядка часу, як сам чат; решта — до відео.
  const layerTall = !(layerOpen ? overlay.current : overlay.closing)?.inChat;
  const open = expanded;
  const [layerDy, setLayerDy] = useState(0);
  const { expand, collapse } = useChatDockControls();
  const count = useHiddenCount(room);
  const replies = useRepliesToMe();
  const world = useWorldToasts();
  const arriving = useArrivingToast(world.toasts, world.ready, world.now);

  const sectionRef = useRef<HTMLElement>(null);
  const collapsedRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [top, setTop] = useState(0);
  const [videoTop, setVideoTop] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);
  // Телефон-альбом: згорнуте вікно з’являється внизу лише коли сторінку прокручено нижче рядка часу.
  // Поки в полі введення фокус, режим не міняємо: клавіатура може стиснути макет і «перевернути» орієнтацію за медіазапитом.
  const landRaw = usePhoneLandscape();
  const [frozenLand, setFrozenLand] = useState<boolean | null>(null);
  const land = frozenLand ?? landRaw;
  const reduceMotion = useReducedMotion();
  const [past, setPast] = useState(false);
  const landHidden = land && !open && !past;

  // Екранна клавіатура: visualViewport (Android/iOS зменшують лише візуальну область, макет лишається). Якщо клавіатура
  // зменшує сам макет (`resizes-content`, зміна розміру вікна) — inset = 0, а розміри вже правильні самі собою.
  const [vv, setVv] = useState({ h: 0, off: 0, inner: 0, idle: 0 });
  const [typing, setTyping] = useState(false);
  const typingRef = useRef(false);
  useEffect(() => {
    const v = window.visualViewport;
    const read = () => {
      const h = v ? v.height : window.innerHeight;
      setVv((cur) => {
        // `idle` — висота видимої області, коли поле не в фокусі (без клавіатури).
        const next = { h, off: v ? v.offsetTop : 0, inner: window.innerHeight, idle: typingRef.current ? cur.idle : h };
        return cur.h === next.h && cur.off === next.off && cur.inner === next.inner && cur.idle === next.idle ? cur : next;
      });
    };
    read();
    v?.addEventListener('resize', read);
    v?.addEventListener('scroll', read);
    window.addEventListener('resize', read);
    return () => {
      v?.removeEventListener('resize', read);
      v?.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, []);
  const inset = vv.h ? Math.max(0, vv.inner - vv.h - vv.off) : 0;
  const kbUp = vv.h > 0 && (inset > KB_MIN || (typing && vv.idle - vv.h > KB_MIN));
  const kbOpen = open && kbUp;
  const landFlow = land && open;

  // Контейнери вікон (`#chat-dock-slot`, `#layer-dock-slot`) з’явились чи зникли — OverlayManager перемальовує портали.
  useLayoutEffect(() => {
    notifyOverlaySlots();
    return notifyOverlaySlots;
  }, []);

  // Згорнутий з першого показу: нові рахуємо від завантаження сторінки.
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  const markHidden = useChatUi((s) => s.markHidden);
  const now = useNow();
  useEffect(() => {
    if (!expanded && hiddenAt === null) markHidden(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Нижній відступ сторінки на висоту згорнутого вікна (globals.css); у альбомі — лише коли вікно видно внизу.
  const reserve = !(land && (landHidden || open));
  useEffect(() => {
    if (!reserve) return;
    document.documentElement.setAttribute('data-has-chat-dock', '');
    return () => document.documentElement.removeAttribute('data-has-chat-dock');
  }, [reserve]);

  // Згорнутий: гортаємо вгору — від плашки лишається тонка смужка з ручкою (дотик розгортає); униз чи в самому низу
  // сторінки — знову вся плашка (рішення 2026-10-28).
  const [slim, setSlim] = useState(false);
  useEffect(() => {
    // Лише портрет: в альбомі згорнутий чат завжди повний (з'являється нижче рядка часу).
    if (open || land) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const atBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 2;
      if (atBottom || y <= 0) setSlim(false);
      else if (y < lastY - 6) setSlim(true);
      else if (y > lastY + 6) setSlim(false);
      if (Math.abs(y - lastY) > 6) lastY = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      setSlim(false); // після розгортання згорнутий чат знову повний
    };
  }, [open, land]);

  // Телефон-альбом, згорнутий: чи прокручено нижче смуги (низ останнього елемента над чатом вище верху вікна).
  useEffect(() => {
    if (!land || open) return;
    const main = sectionRef.current?.parentElement ?? null;
    const update = () => {
      const a = findAnchor(main);
      setPast(a ? a.getBoundingClientRect().bottom <= 4 : false);
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (main) ro?.observe(main);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [land, open]);

  // Розгорнутий чат: плашка cookies тимчасово ховається (inline-стиль не потрібен — правило в primitives.css).
  useEffect(() => {
    if (!open && !layerOpen) return;
    document.documentElement.setAttribute('data-chat-dock-expanded', '');
    return () => document.documentElement.removeAttribute('data-chat-dock-expanded');
  }, [open, layerOpen]);

  // Телефон-альбом, розгорнутий: чат — блок у потоці одразу після смуги (висота вікна), сторінка прокручується як завжди;
  // при розгортанні прокручуємо так, щоб чат заповнив екран.
  useLayoutEffect(() => {
    if (!landFlow) return;
    const el = sectionRef.current;
    const anchor = findAnchor(el?.parentElement ?? null);
    const html = document.documentElement;
    html.setAttribute('data-chat-land-expanded', '');
    anchor?.setAttribute('data-dock-anchor', '');
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: y, behavior: reduceMotion ? 'instant' : 'smooth' });
    }
    return () => {
      html.removeAttribute('data-chat-land-expanded');
      anchor?.removeAttribute('data-dock-anchor');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landFlow]);

  // Розгорнутий: вікно починається під рядком часу (`measureSheetTop('chat')`); сторінка нагорі й не прокручується.
  useLayoutEffect(() => {
    if ((!open && !layerOpen) || land) return;
    // Сторінка не блокується й нічого не липне: чат фіксований унизу, його висота — місце під смугою при scrollTop = 0
    // (міряємо при розгортанні й зміні розміру, за прокруткою не слідуємо).
    const measure = () => {
      setTop(measureSheetTop('chat'));
      setVideoTop(measureSheetTop('video'));
    };
    measure();
    const frame = requestAnimationFrame(measure);
    // Лише зміна ширини (поворот, інше вікно): зміна самої висоти — це адресна стрічка, на неї висота чату не реагує.
    let width = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      measure();
    };
    window.addEventListener('resize', onResize);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    document.querySelectorAll(SHEET_TOP_SOURCES).forEach((el) => ro?.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      ro?.disconnect();
    };
  }, [open, layerOpen, land]);

  // Розгорнутий (портрет): запас унизу сторінки = висота чату, щоб усе можна було прокрутити над ним. Після згортання
  // запас лишається, доки вікно не доїде вниз (без стрибка під час анімації), потім знімається.
  const padH = open && !land ? Math.max(0, stableViewportH() - top) : null;
  useEffect(() => {
    if (padH === null) return;
    const html = document.documentElement;
    html.setAttribute('data-chat-dock-pad', '');
    html.style.setProperty('--chat-dock-pad', `${padH}px`);
  }, [padH]);
  useEffect(() => {
    if (open) return;
    const html = document.documentElement;
    if (!html.hasAttribute('data-chat-dock-pad')) return;
    const clear = () => {
      html.removeAttribute('data-chat-dock-pad');
      html.style.removeProperty('--chat-dock-pad');
    };
    if (reduceMotion || land) {
      clear();
      return;
    }
    const id = window.setTimeout(clear, 260);
    return () => window.clearTimeout(id);
  }, [open, reduceMotion, land]);
  useEffect(
    () => () => {
      document.documentElement.removeAttribute('data-chat-dock-pad');
      document.documentElement.style.removeProperty('--chat-dock-pad');
    },
    [],
  );

  // Альбом + клавіатура: запас унизу сторінки (щоб чат можна було вирівняти по верху видимої області) і вирівнювання.
  const landKb = landFlow && kbOpen;
  useLayoutEffect(() => {
    if (!landKb) return;
    const html = document.documentElement;
    html.style.setProperty('--kb-pad', `${Math.max(0, vv.inner - vv.h)}px`);
    const el = sectionRef.current;
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - vv.off, behavior: 'instant' });
    return () => {
      html.style.removeProperty('--kb-pad');
    };
  }, [landKb, vv.h, vv.off, vv.inner]);
  // Клавіатуру закрито — чат знову на весь екран (без стрибка: те саме місце сторінки).
  const wasLandKb = useRef(false);
  useLayoutEffect(() => {
    if (wasLandKb.current && !landKb && landFlow) {
      const el = sectionRef.current;
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
    }
    wasLandKb.current = landKb;
  }, [landKb, landFlow]);

  // Альбом, розгорнутий: верх відео — на верх вікна (не шапка сайту); плавно, за «зменшити рух» — миттєво.
  const toVideo = useCallback(() => {
    const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
    if (!slot) return;
    const y = slot.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, y), behavior: reduceMotion ? 'instant' : 'smooth' });
  }, [reduceMotion]);
  const ctx = useMemo(() => ({ toVideo: landFlow ? toVideo : null }), [landFlow, toVideo]);

  // Фокус іде на шапку після розгортання/згортання (не при першому показі й не коли фокус забрало вікно чату).
  // Порівнюємо з попереднім станом (а не «перший запуск»): у dev StrictMode ефект виконується двічі, і фокус із жовтою
  // рамкою опинявся на згорнутому чаті одразу після завантаження.
  const prevExpanded = useRef(expanded);
  useEffect(() => {
    if (prevExpanded.current === expanded) return;
    prevExpanded.current = expanded;
    if (expanded && overlay.current) return;
    if (expanded) sectionRef.current?.querySelector<HTMLElement>('[data-chat-collapse]')?.focus({ preventScroll: true });
    else collapsedRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Esc згортає (Esc у відкритому вікні чату, меню чи виборі емодзі спершу закриває їх).
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || overlay.current) return;
      collapse();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [expanded, overlay, collapse]);

  // Шар вікон: свайп униз з ручки чи шапки закриває вікно. Нативні події: шапка вікна — у порталі
  // (у дереві React вона не всередині вікна чату), а миша, на відміну від пальця, не «прилипає» до елемента під нею.
  const layerRef = useRef<HTMLDivElement>(null);
  const closeLayer = overlay.close;
  useEffect(() => {
    const layer = layerRef.current;
    if (!layerOpen || !layer) return;
    let drag: { id: number; startY: number; lastY: number; lastT: number; v: number; moved: boolean } | null = null;
    const onDown = (e: globalThis.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(LAYER_ZONE)) return;
      drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
    };
    const onMove = (e: globalThis.PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dy = e.clientY - drag.startY;
      if (!drag.moved) {
        if (Math.abs(dy) < MOVE_THRESHOLD) return;
        drag.moved = true;
      }
      const dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = 0.6 * drag.v + 0.4 * ((e.clientY - drag.lastY) / dt);
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      // Шар їде за пальцем лише вниз (угору розгортати нікуди).
      setLayerDy(Math.max(0, dy));
    };
    const onEnd = (e: globalThis.PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const d = drag;
      drag = null;
      const closing = d.moved && e.type !== 'pointercancel' && (d.lastY - d.startY > LAYER_CLOSE_PX || d.v > FLICK_PX_PER_MS);
      // Закриваємо — шар їде вниз від того місця, де його відпустили (без повернення вгору).
      if (!closing) setLayerDy(0);
      if (!d.moved || e.type === 'pointercancel') return;
      // Після жесту клік (напр. по «×» чи ручці) не потрібен.
      const swallow = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (closing) closeLayer();
    };
    layer.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      layer.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      setLayerDy(0);
    };
  }, [layerOpen, land, closeLayer]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const el = sectionRef.current;
    if (!el) return;
    const inCollapsedRow = !!target.closest('.t2f-dock-collapsed');
    if (!inCollapsedRow && !target.closest(ZONE)) return;
    const collapsedH = !expanded && el.offsetHeight ? el.offsetHeight : COLLAPSED_ROW + 12;
    const expandedH = Math.max(collapsedH + 1, stableViewportH() - (expanded ? top : measureSheetTop('chat')));
    dragRef.current = {
      id: e.pointerId,
      startY: e.clientY,
      startH: el.offsetHeight,
      collapsedH,
      expandedH,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
      moved: false,
      h: el.offsetHeight,
    };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    // Кнопку відпущено поза вікном (модальне меню перехопило pointerup) — жесту немає.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      dragRef.current = null;
      return;
    }
    const dy = e.clientY - d.startY;
    if (!d.moved) {
      if (Math.abs(dy) < MOVE_THRESHOLD) return;
      d.moved = true;
      if (d.startH <= d.collapsedH + 1) setTop(measureSheetTop('chat'));
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = 0.6 * d.v + 0.4 * ((e.clientY - d.lastY) / dt);
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.h = Math.max(d.collapsedH, Math.min(d.expandedH, d.startH - dy));
    // Чат у потоці (альбом) не тягнеться за пальцем: свайп униз лише згортає.
    if (!landFlow) setDragH(d.h);
  };
  const onPointerEnd = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    if (!d.moved) return;
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const dyTotal = d.lastY - d.startY;
    const progress = (d.h - d.collapsedH) / (d.expandedH - d.collapsedH);
    const goExpanded = landFlow
      ? !(dyTotal > 60 || d.v > FLICK_PX_PER_MS)
      : Math.abs(d.v) > FLICK_PX_PER_MS
        ? d.v < 0
        : progress > 0.5;
    setDragH(null);
    if (e.type === 'pointercancel') return;
    if (goExpanded && !expanded) expand();
    else if (!goExpanded && expanded) collapse();
  };

  // Дотик до шапки поза кнопками перемикає стан (кадр 3 макета); після жесту клік гаситься.
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onClick = (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!expanded) return;
    if (!target.closest(ZONE) || target.closest(INTERACTIVE)) return;
    collapse();
  };

  // Портрет, розгорнутий, відкрита клавіатура: чат у видимій області над нею; замало місця під смугою — на всю видиму
  // область. Без клавіатури висота завжди одна — під рядком часу (рішення 2026-10-28).
  let geo: CSSProperties | null = null;
  if (open && !land && vv.h > 0 && inset > 0) {
    const free = vv.h - top;
    geo = { height: free >= MIN_DOCK ? free : vv.h, bottom: inset };
  }
  // Альбом, розгорнутий, клавіатура: блок чату = видима область; решту прокручуємо вгору (див. ефект нижче).
  if (landFlow && kbOpen) geo = { height: vv.h };
  const style: CSSProperties & Record<'--dock-top', string> = {
    '--dock-top': `${top}px`,
    ...geo,
    ...(dragH !== null ? { height: dragH } : null),
  };

  // Шар вікон: портрет — вікна чату під рядком часу (як розгорнутий чат), решта — під відео; альбом — весь екран;
  // клавіатура — видима область.
  const layerKb = layerOpen && kbUp;
  let layerGeo: CSSProperties;
  if (land) layerGeo = layerKb ? { top: vv.off, bottom: 'auto', height: vv.h } : { top: 0, height: '100svh', borderRadius: 0 };
  else if (layerKb) {
    const free = vv.h - (layerTall ? videoTop : top);
    layerGeo = { height: free >= MIN_DOCK ? free : vv.h, bottom: inset };
  } else layerGeo = { height: `calc(100svh - ${layerTall ? videoTop : top}px)` };
  if (layerDy) layerGeo = { ...layerGeo, transform: `translateY(${layerDy}px)`, transition: 'none' };
  if (layerClosing) layerGeo = { ...layerGeo, transform: 'translateY(100%)', transition: `transform ${CLOSE_MS}ms ease-out` };
  const onLayerFocus = (e: FocusEvent<HTMLElement>, on: boolean) => {
    if (!(e.target as HTMLElement).matches('input, textarea')) return;
    typingRef.current = on;
    setTyping(on);
    setFrozenLand(on ? landRaw : null);
  };

  return (
    <>
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events */}
    <section
      ref={sectionRef}
      aria-label={t('dockLabel', { room: roomLabel })}
      data-chat-dock=""
      data-state={open ? 'expanded' : 'collapsed'}
      inert={layerOpen}
      data-dragging={dragH !== null ? 'true' : 'false'}
      data-land={land ? 'true' : undefined}
      data-land-hidden={landHidden ? 'true' : undefined}
      data-kb={kbOpen ? 'true' : undefined}
      data-slim={slim && !expanded && !land ? 'true' : undefined}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(FIELD)) {
          typingRef.current = true;
          setTyping(true);
          setFrozenLand(landRaw);
        }
      }}
      onBlur={(e) => {
        if ((e.target as HTMLElement).matches(FIELD)) {
          typingRef.current = false;
          setTyping(false);
          setFrozenLand(null);
        }
      }}
      className="t2f-dock"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
      onClick={onClick}
    >
      <button
        ref={collapsedRef}
        type="button"
        aria-expanded={false}
        aria-label={[
          count > 0 ? t('dockExpandLabelUnread', { room: roomLabel, count }) : t('dockExpandLabel', { room: roomLabel }),
          replies > 0 ? t('settings.repliedCount', { count: replies }) : '',
        ]
          .filter(Boolean)
          .join('. ')}
        className="t2f-focus t2f-dock-collapsed"
        inert={open || landHidden}
        onClick={expand}
        data-dock-expand=""
      >
        <span aria-hidden="true" className="t2f-dock-handle" />
        <span className="t2f-dock-row">
          <Icon name="chevron-up" size={20} strokeWidth={2} />
          {arriving ? (
            // Новий тост ≈10 с замість «Розгорнути чат» (дошка `Phone-Toast-New` · «Згорнутий чат · новий тост»).
            <span key={arriving.id} className={tm.dockToast} data-dock-toast={arriving.id}>
              <Flag round code={arriving.flagCode} diameter={22} decorative />
              <span className={tm.dockNick}>{arriving.nick}</span>
              <span className={tm.dockText}>
                <EmojiText text={arriving.text} />
              </span>
              <span className="sr-only">{t('expand')}</span>
            </span>
          ) : (
            <>
              <span>{t('expand')}</span>
              <span className="flex-1" />
            </>
          )}
          {replies > 0 ? (
            <span aria-hidden="true" className="t2f-replied" data-row="replied">
              <Icon name="reply" size={14} strokeWidth={2} />
              {t('settings.replied')}
              {replies > 1 ? ` · ${formatCount(replies)}` : ''}
            </span>
          ) : null}
          <span aria-hidden="true" className="t2f-dock-pill" data-dock-pill="" data-zero={count === 0 ? 'true' : undefined}>
            {t('dockNewPill', { count: formatCount(count) })}
          </span>
        </span>
      </button>
      <div className="t2f-dock-body" inert={!expanded}>
        <div aria-hidden="true" className="t2f-dock-grip-handle">
          <span className="t2f-dock-handle" />
        </div>
        <ChatDockContext.Provider value={ctx}>
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </ChatDockContext.Provider>
        <div id={CHAT_DOCK_SLOT_ID} className="t2f-dock-slot pointer-events-none z-20 [&>*]:pointer-events-auto" />
      </div>
    </section>
    {/* Шар вікон поза чатом: контейнер є завжди (портал вікна шукає його в DOM), видно лише з вікном. */}
    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
    <div
      ref={layerRef}
      data-window-layer=""
      data-land={land ? 'true' : undefined}
      className="t2f-layer"
      hidden={!layerOpen && !layerClosing}
      inert={layerClosing || undefined}
      data-closing={layerClosing ? 'true' : undefined}
      style={layerGeo}
      onFocus={(e) => onLayerFocus(e, true)}
      onBlur={(e) => onLayerFocus(e, false)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('.t2f-layer-grip')) overlay.close();
      }}
    >
      <div aria-hidden="true" className="t2f-layer-grip">
        <span className="t2f-dock-handle" />
      </div>
      <div id={LAYER_DOCK_SLOT_ID} className="t2f-layer-slot" />
    </div>
    </>
  );
}
