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
 *
 * Файл — композиція: екранна клавіатура — `useDockViewport`, розкладка сторінки й вимірювання — `useChatDockLayout`,
 * жести — `useDockSwipe`/`useLayerSwipe`, геометрія — `chatDockGeometry.ts`, згорнутий рядок і шар вікон — окремі компоненти.
 */
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  createContext,
  useContext,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { CHAT_DOCK_SLOT_ID } from '@/components/primitives/Panel';
import { useArrivingToast, useWorldToasts } from '@/components/toast/useWorldToasts';
import { isLayerSpec, notifyOverlaySlots, useOverlay, usePhoneLandscape } from '@/components/shell/OverlayManager';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { RoomId } from '@/lib/data/types';
import { useNow } from '@/lib/time/TimeProvider';
import { useChatUi, useHiddenCount, useRepliesToMe } from '@/stores/chat';
import { useChatDock } from '@/stores/chatDock';
import { dockStyle, FIELD, layerStyle } from './chatDockGeometry';
import { ChatDockCollapsed } from './parts/ChatDockCollapsed';
import { ChatDockLayer } from './parts/ChatDockLayer';
import { useChatDockLayout } from './hooks/useChatDockLayout';
import { useDockSwipe, useLayerSwipe } from './hooks/useDockSwipe';
import { useDockViewport } from './hooks/useDockViewport';

/** Дані вікна для його вмісту: у альбомі розгорнутий чат дає кнопку «До відео» в шапку. */
export const ChatDockContext = createContext<{ toVideo: (() => void) | null }>({ toVideo: null });
export const useChatDockContext = () => useContext(ChatDockContext);

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
  const { expand, collapse } = useChatDockControls();
  const count = useHiddenCount(room);
  const replies = useRepliesToMe(room);
  const world = useWorldToasts();
  const arriving = useArrivingToast(world.toasts, world.ready, world.now);

  const sectionRef = useRef<HTMLElement>(null);
  const collapsedRef = useRef<HTMLButtonElement>(null);
  // Телефон-альбом: згорнуте вікно з’являється внизу лише коли сторінку прокручено нижче рядка часу.
  // Поки в полі введення фокус, режим не міняємо: клавіатура може стиснути макет і «перевернути» орієнтацію за медіазапитом.
  const landRaw = usePhoneLandscape();
  const [frozenLand, setFrozenLand] = useState<boolean | null>(null);
  const land = frozenLand ?? landRaw;
  const reduceMotion = useReducedMotion();

  const { vv, inset, kbUp, setTyping, typingRef } = useDockViewport();
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

  const { top, setTop, videoTop, slim, landHidden, ctx } = useChatDockLayout({
    open,
    layerOpen,
    land,
    landFlow,
    kbOpen,
    vv,
    sectionRef,
    reduceMotion,
  });

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

  // Шар вікон: свайп униз з ручки чи шапки закриває вікно.
  const [layerEl, setLayerEl] = useState<HTMLDivElement | null>(null);
  const closeLayer = overlay.close;
  const layerDy = useLayerSwipe(layerEl, layerOpen, land, closeLayer);

  const { dragH, onPointerDown, onPointerMove, onPointerEnd, onClickCapture, onClick } = useDockSwipe({
    sectionRef,
    expanded,
    top,
    setTop,
    landFlow,
    expand,
    collapse,
  });

  // Жести — нативні події на самому вікні: шапки вікон чату (автор, нік, правила) живуть у порталі, і React-події з них
  // сюди не доходять (Т9, 2026-11-16). Свіжі обробники беремо з ref, щоб жест не обривався перемальовкою.
  const swipeRef = useRef({ onPointerDown, onPointerMove, onPointerEnd, onClickCapture, onClick });
  useLayoutEffect(() => {
    swipeRef.current = { onPointerDown, onPointerMove, onPointerEnd, onClickCapture, onClick };
  });
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const down = (e: Event) => swipeRef.current.onPointerDown(e as never);
    const move = (e: Event) => swipeRef.current.onPointerMove(e as never);
    const end = (e: Event) => swipeRef.current.onPointerEnd(e as never);
    const clickCap = (e: Event) => swipeRef.current.onClickCapture(e as never);
    const click = (e: Event) => swipeRef.current.onClick(e as never);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('click', clickCap, true);
    el.addEventListener('click', click);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('click', clickCap, true);
      el.removeEventListener('click', click);
    };
  }, []);

  const style = dockStyle({ open, land, landFlow, kbOpen, vv, inset, top, dragH });

  const layerKb = layerOpen && kbUp;
  const layerGeo = layerStyle({ land, layerKb, layerTall, layerClosing, layerDy, vv, inset, top, videoTop });
  const onLayerFocus = (e: FocusEvent<HTMLElement>, on: boolean) => {
    if (!(e.target as HTMLElement).matches('input, textarea')) return;
    typingRef.current = on;
    setTyping(on);
    setFrozenLand(on ? landRaw : null);
  };

  return (
    <>
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
    >
      <ChatDockCollapsed
        buttonRef={collapsedRef}
        roomLabel={roomLabel}
        count={count}
        replies={replies}
        arriving={arriving}
        inert={open || landHidden}
        onExpand={expand}
      />
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
    <ChatDockLayer
      layerRef={setLayerEl}
      land={land}
      hidden={!layerOpen && !layerClosing}
      closing={layerClosing}
      style={layerGeo}
      onLayerFocus={onLayerFocus}
      onClose={() => overlay.close()}
    />
    </>
  );
}
