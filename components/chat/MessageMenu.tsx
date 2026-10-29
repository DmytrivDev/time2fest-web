'use client';

/**
 * C12. MessageMenu — меню «⋯» над повідомленням (макети `Desk-Chat-MessageMenu`, `Phone-Chat-MessageMenu`, варіант 2).
 * На всю ширину колонки чату, 4 px від повідомлення: «Відповісти» і «Згадати» поруч, сітка емодзі 3×8 (клітинки 44×44,
 * без видимих підписів — `aria-label` на кожній), роздільник, «Поскаржитись». Живе в шарі самого чату (абсолютно
 * позиціонується в обгортці стрічки) і переставляється при прокрутці й зміні розміру; під повідомленням, якщо вистачає
 * місця, інакше над ним. Esc, клік поза меню, Tab — закривають; Esc/Tab повертають фокус на «⋯».
 * Стрілки рухають фокус між елементами (по рядках і стовпцях).
 */
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ChatMessage } from '@/lib/data/types';
import {
  MENU_HEIGHT_GUESS,
  chooseMenuPlacement,
  menuTopInContainer,
  type MenuPlacement,
} from './menuPlacement';
import { reactOptimistic, type MessageActionHandlers } from './MessageActions';
import { EmojiGrid, arrowTarget } from './EmojiGrid';

export interface MessageMenuProps extends MessageActionHandlers {
  message: ChatMessage;
  /** Рядок повідомлення (`<li>`), від якого відкрито меню. */
  anchor: HTMLElement;
  /** Обгортка стрічки: у ній меню позиціонується абсолютно (власний шар чату). */
  container: HTMLElement;
  /** Прокручувана стрічка: її видимий низ вирішує «під чи над». */
  scroller: HTMLElement;
  /** Телефон: меню стоїть у потоці стрічки під повідомленням (не плаває), прокручується разом зі стрічкою. */
  inline?: boolean;
  /** `restoreFocus` — повернути фокус на «⋯» (лише після клавіатури: Esc, Tab, Enter на клітинці чи пункті). */
  onClose: (opts?: { restoreFocus?: boolean }) => void;
}

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function MessageMenu({
  message,
  anchor,
  container,
  scroller,
  inline = false,
  onClose,
  onReact,
  onReply,
  onMention,
  onReport,
}: MessageMenuProps) {
  const t = useTranslations('chat');
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    placement: MenuPlacement;
  } | null>(null);

  // Положення: перераховується при відкритті, прокрутці стрічки, зміні розміру вікна й обгортки.
  useLayoutEffect(() => {
    if (inline) return;
    const place = () => {
      const menu = ref.current;
      const c = container.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const v = scroller.getBoundingClientRect();
      const menuHeight = menu?.offsetHeight || MENU_HEIGHT_GUESS;
      const placement = chooseMenuPlacement({
        anchorBottom: a.bottom,
        viewBottom: v.bottom,
        menuHeight,
      });
      const top = menuTopInContainer({
        placement,
        anchorTop: a.top,
        anchorBottom: a.bottom,
        containerTop: c.top,
        containerHeight: c.height,
        menuHeight,
      });
      setPos((p) => {
        const next = { top, left: a.left - c.left, width: a.width, placement };
        return p &&
          p.top === next.top &&
          p.left === next.left &&
          p.width === next.width &&
          p.placement === next.placement
          ? p
          : next;
      });
    };
    place();
    scroller.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    ro?.observe(container);
    return () => {
      scroller.removeEventListener('scroll', place);
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [anchor, container, scroller, inline]);

  // Фокус — на «Відповісти» при відкритті (щойно меню стало видимим: у прихованого елемента фокусу не буває).
  const placed = inline || pos !== null;
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!placed || focused.current) return;
    focused.current = true;
    ref.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus({ preventScroll: true });
  }, [placed]);

  // Клік поза меню закриває (клік по «⋯» обробляє сама кнопка — перемикає).
  useLayoutEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || ref.current?.contains(target) || target.closest('[data-msg-trigger]')) return;
      onClose({ restoreFocus: false });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose({ restoreFocus: true });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      onClose({ restoreFocus: true });
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const root = ref.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLElement>('[data-menu-item]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    const target = arrowTarget(items, i, e.key);
    target?.focus();
  };

  const done = (fn: (() => void) | undefined, restoreFocus: boolean) => {
    fn?.();
    onClose({ restoreFocus });
  };

  return (
    // Меню лежить у шарі чату; `role="menu"` + власна клавіатурна модель (стрілки, Esc, Tab).
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      ref={ref}
      role="menu"
      aria-label={t('actionsTitle')}
      data-message-menu=""
      data-placement={inline ? 'inline' : pos?.placement}
      onKeyDown={onKeyDown}
      className={inline ? 't2f-mm t2f-mm-inline' : 't2f-mm'}
      style={
        inline
          ? undefined
          : {
              top: pos?.top ?? 0,
              left: pos?.left ?? 0,
              width: pos?.width,
              visibility: pos ? 'visible' : 'hidden',
            }
      }
    >
      <div className="t2f-mm-row">
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          className="t2f-mm-item t2f-mm-action"
          onClick={() => done(() => onReply?.(message), false)}
        >
          <Svg>
            <path d="M10 7 4 12l6 5" />
            <path d="M4 12h9a7 7 0 0 1 7 7v0" />
          </Svg>
          {t('reply')}
        </button>
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          className="t2f-mm-item t2f-mm-action"
          onClick={() => done(() => onMention?.(message), false)}
        >
          <Svg>
            <circle cx="12" cy="12" r="4" />
            <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
          </Svg>
          {t('mention')}
        </button>
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          aria-label={t('menuClose')}
          className="t2f-mm-item t2f-mm-close"
          onClick={(e) => onClose({ restoreFocus: e.detail === 0 })}
        >
          <Svg>
            <path d="M6 6l12 12M18 6L6 18" />
          </Svg>
        </button>
      </div>
      <div aria-hidden="true" className="t2f-mm-sep" />
      <EmojiGrid
        cellRole="menuitemcheckbox"
        checked={(id) => message.reactions?.[id]?.mine ?? false}
        groupLabel={t('reactionsPick')}
        onPick={(id, _symbol, e) => {
          reactOptimistic(message, id, onReact);
          // Фокус на «⋯» — лише після клавіатури (Enter/Пробіл дають detail 0); після миші «⋯» не лишається видимим.
          onClose({ restoreFocus: e.detail === 0 });
        }}
      />
      <div aria-hidden="true" className="t2f-mm-sep" />
      <div className="t2f-mm-row">
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          className="t2f-mm-item t2f-mm-action t2f-mm-report"
          onClick={(e) => done(() => onReport?.(message), e.detail === 0)}
        >
          <Svg>
            <path d="M5 21V4" />
            <path d="M5 4h11l-2 4 2 4H5" />
          </Svg>
          {t('report')}
        </button>
      </div>
    </div>
  );
}
