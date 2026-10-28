'use client';

/**
 * ChatDock — закріплене вікно чату внизу на телефоні (рішення 2026-10-27, макети `Phone-Chat-Dock`, `Phone-Chat-Expanded`).
 * Замінює вкладки «Події | Чат»: чат завжди на екрані. Згорнутий — ручка 36×4 і рядок «Розгорнути чат» зі жовтою
 * пілюлею «N нових» (нові з моменту згортання, власні не рахуємо), 56 px + безпечна зона (≥ 68 px). Розгорнутий — накриває
 * все під смугою «Перший ряд» (відео, рядок часу й смуга лишаються), сторінка не прокручується.
 * Жести лише на шапці (ручка + рядок інструментів): свайп угору розгортає, униз згортає; вікно йде за пальцем,
 * відпустили далі середини або швидким рухом — доїжджає (200 мс, без анімації за «зменшити рух»). Дотик до шапки поза
 * кнопками перемикає стан; Esc і шеврон «Згорнути чат» згортають, фокус іде на шапку.
 * Вікна чату (O-NICK, O-AUTHOR, правила, «Моя емоція») відкриваються всередині вікна — у `#chat-dock-slot`.
 */
import { useTranslations } from 'next-intl';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Icon } from '@/components/primitives/Icon';
import { CHAT_DOCK_SLOT_ID } from '@/components/primitives/Panel';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { RoomId } from '@/lib/data/types';
import { useNow } from '@/lib/time/TimeProvider';
import { formatCount, useChatUi, useHiddenCount } from '@/stores/chat';
import { useChatDock } from '@/stores/chatDock';

/** Висота зони жестів у згорнутому стані: ручка + рядок. */
const COLLAPSED_ROW = 56;
const MOVE_THRESHOLD = 6;
const FLICK_PX_PER_MS = 0.5;
/** Усе, що в шапці працює саме по собі (дотик не перемикає вікно). */
const INTERACTIVE = 'button, a, input, textarea, select, [role="radiogroup"], [role="group"], [role="menu"]';
const ZONE = '[data-dock-grip], .t2f-dock-grip-handle';

/** Нижній край того, що лишається видимим над вікном: відео, рядок часу, смуга «Перший ряд». */
function measureTop(): number {
  let bottom = 0;
  document.querySelectorAll<HTMLElement>('[data-dock-above]').forEach((el) => {
    bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
  });
  if (!bottom) {
    const slot = document.querySelector<HTMLElement>('[data-player-slot="main"]');
    const fallback = slot ?? document.querySelector<HTMLElement>('header');
    if (fallback) bottom = fallback.getBoundingClientRect().bottom;
  }
  return Math.max(0, Math.min(Math.round(bottom), Math.max(0, window.innerHeight - 240)));
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

/** Керування вікном з будь-якого місця сторінки (смуга «Перший ряд», вікна). */
export function useChatDockControls() {
  const now = useNow();
  const overlay = useOverlay();
  const setExpanded = useChatDock((s) => s.setExpanded);
  const markHidden = useChatUi((s) => s.markHidden);
  const expand = useCallback(() => {
    markHidden(null);
    setExpanded(true);
  }, [markHidden, setExpanded]);
  const collapse = useCallback(() => {
    markHidden(now);
    if (overlay.current?.inChat) overlay.close();
    setExpanded(false);
  }, [markHidden, now, overlay, setExpanded]);
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
  const { expand, collapse } = useChatDockControls();
  const count = useHiddenCount(room);

  const sectionRef = useRef<HTMLElement>(null);
  const collapsedRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const [top, setTop] = useState(0);
  const [dragH, setDragH] = useState<number | null>(null);

  // Згорнутий з першого показу: нові рахуємо від завантаження сторінки.
  const hiddenAt = useChatUi((s) => s.hiddenAt);
  const markHidden = useChatUi((s) => s.markHidden);
  const now = useNow();
  useEffect(() => {
    if (!expanded && hiddenAt === null) markHidden(now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Нижній відступ сторінки на висоту згорнутого вікна (globals.css).
  useEffect(() => {
    document.documentElement.setAttribute('data-has-chat-dock', '');
    return () => document.documentElement.removeAttribute('data-has-chat-dock');
  }, []);

  // Розгорнутий чат: смуга cookies тимчасово ховається (inline-стиль не потрібен — правило в primitives.css).
  useEffect(() => {
    if (!expanded) return;
    document.documentElement.setAttribute('data-chat-dock-expanded', '');
    return () => document.documentElement.removeAttribute('data-chat-dock-expanded');
  }, [expanded]);

  // Розгорнутий: вікно починається під смугою «Перший ряд»; сторінка нагорі й не прокручується.
  useLayoutEffect(() => {
    if (!expanded) return;
    const y = window.scrollY;
    window.scrollTo({ top: 0, behavior: 'instant' });
    const html = document.documentElement;
    const prevHtml = html.style.overflow;
    const prevBody = document.body.style.overflow;
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    const measure = () => setTop(measureTop());
    measure();
    const frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    document.querySelectorAll('[data-dock-above], [data-player-slot="main"]').forEach((el) => ro?.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
      ro?.disconnect();
      html.style.overflow = prevHtml;
      document.body.style.overflow = prevBody;
      window.scrollTo({ top: y, behavior: 'instant' });
    };
  }, [expanded]);

  // Фокус іде на шапку після розгортання/згортання (не при першому показі й не коли фокус забрало вікно чату).
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (overlay.current) return;
    if (expanded) sectionRef.current?.querySelector<HTMLElement>('[data-chat-collapse]')?.focus();
    else collapsedRef.current?.focus();
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

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const inCollapsedRow = !!target.closest('.t2f-dock-collapsed');
    if (!inCollapsedRow && !target.closest(ZONE)) return;
    if (overlay.current?.inChat) return;
    const el = sectionRef.current;
    if (!el) return;
    const collapsedH = !expanded && el.offsetHeight ? el.offsetHeight : COLLAPSED_ROW + 12;
    const expandedH = Math.max(collapsedH + 1, window.innerHeight - (expanded ? top : measureTop()));
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
      if (d.startH <= d.collapsedH + 1) setTop(measureTop());
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = 0.6 * d.v + 0.4 * ((e.clientY - d.lastY) / dt);
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    d.h = Math.max(d.collapsedH, Math.min(d.expandedH, d.startH - dy));
    setDragH(d.h);
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
    const progress = (d.h - d.collapsedH) / (d.expandedH - d.collapsedH);
    const goExpanded = Math.abs(d.v) > FLICK_PX_PER_MS ? d.v < 0 : progress > 0.5;
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
    if (!expanded) return;
    const target = e.target as HTMLElement;
    if (!target.closest(ZONE) || target.closest(INTERACTIVE)) return;
    collapse();
  };

  const style: CSSProperties & Record<'--dock-top', string> = {
    '--dock-top': `${top}px`,
    ...(dragH !== null ? { height: dragH } : null),
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
    <section
      ref={sectionRef}
      aria-label={t('dockLabel', { room: roomLabel })}
      data-chat-dock=""
      data-state={expanded ? 'expanded' : 'collapsed'}
      data-dragging={dragH !== null ? 'true' : 'false'}
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
        aria-label={
          count > 0
            ? t('dockExpandLabelUnread', { room: roomLabel, count })
            : t('dockExpandLabel', { room: roomLabel })
        }
        className="t2f-focus t2f-dock-collapsed"
        inert={expanded}
        onClick={expand}
        data-dock-expand=""
      >
        <span aria-hidden="true" className="t2f-dock-handle" />
        <span className="t2f-dock-row">
          <Icon name="chevron-up" size={20} strokeWidth={2} />
          <span>{t('expand')}</span>
          <span className="flex-1" />
          {count > 0 ? (
            <span aria-hidden="true" className="t2f-dock-pill" data-dock-pill="">
              {t('dockNewPill', { count: formatCount(count) })}
            </span>
          ) : null}
        </span>
      </button>
      <div className="t2f-dock-body" inert={!expanded}>
        <div aria-hidden="true" className="t2f-dock-grip-handle">
          <span className="t2f-dock-handle" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        <div id={CHAT_DOCK_SLOT_ID} className="pointer-events-none absolute inset-0 z-20 [&>*]:pointer-events-auto" />
      </div>
    </section>
  );
}
