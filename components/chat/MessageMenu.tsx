'use client';

/**
 * C12. MessageMenu — меню «⋯» над повідомленням, варіант А (вибір власника 2026-10-30, дошки `Chat · меню повідомлення —
 * варіант А`): угорі сім найчастіших емодзі й «ще» (розгортає повну сітку 3×8 на тому самому місці), під лінією — дії
 * рівними колонками «іконка + підпис»: «Відповісти», «Згадати», «Перекласти» (лише повідомлення іншою мовою; без пасу —
 * значок пасу й «Потрібен Новорічний пас»), «Поскаржитись» (приглушено). Живе в шарі чату (абсолютно в обгортці стрічки),
 * під повідомленням, якщо вистачає місця, інакше над ним; на телефоні — у потоці стрічки. Esc, клік поза меню, Tab —
 * закривають; Esc/Tab повертають фокус на «⋯». Стрілки рухають фокус між елементами (по рядках і стовпцях).
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
import { QUICK_REACTIONS, REACTION_SYMBOLS } from './reactions';
import { Emoji } from '@/components/primitives/Emoji';
import { useTranslateMessage } from '@/lib/chat/translate';
import { useChatPref } from '@/stores/chatPrefs';

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
  onTranslateLocked,
}: MessageMenuProps) {
  const t = useTranslations('chat');
  const tr = useTranslateMessage(message, useChatPref('translate'));
  const [allEmoji, setAllEmoji] = useState(false);
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
    ref.current?.querySelector<HTMLElement>('[data-menu-first]')?.focus({ preventScroll: true });
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
      {allEmoji ? (
        <EmojiGrid
          cellRole="menuitemcheckbox"
          checked={(id) => message.reactions?.[id]?.mine ?? false}
          groupLabel={t('reactionsPick')}
          onPick={(id, _symbol, e) => {
            reactOptimistic(message, id, onReact);
            onClose({ restoreFocus: e.detail === 0 });
          }}
        />
      ) : (
        <div role="group" aria-label={t('reactionsPick')} className="t2f-mm-quick">
          {QUICK_REACTIONS.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={message.reactions?.[id]?.mine ?? false}
              data-menu-item=""
              aria-label={t('reactionPickLabel', { name: t(`reactions.${id}`) })}
              className="t2f-mm-item t2f-mm-emoji"
              onClick={(e) => {
                reactOptimistic(message, id, onReact);
                // Фокус на «⋯» — лише після клавіатури (Enter/Пробіл дають detail 0).
                onClose({ restoreFocus: e.detail === 0 });
              }}
            >
              <Emoji char={REACTION_SYMBOLS[id]} />
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            data-menu-item=""
            aria-label={t('reactionsAll')}
            aria-expanded={false}
            className="t2f-mm-item t2f-mm-emoji t2f-mm-more"
            onClick={() => {
              setAllEmoji(true);
              // фокус — на першу клітинку повної сітки
              requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('.t2f-mm-grid [data-menu-item]')?.focus());
            }}
          >
            <Svg>
              <circle cx="11" cy="12" r="8" />
              <path d="M8 14s1 1.5 3 1.5 3-1.5 3-1.5" />
              <path d="M8.5 9.5h.01M13.5 9.5h.01" strokeWidth="2.4" />
              <path d="M19 3v4M17 5h4" />
            </Svg>
          </button>
        </div>
      )}
      <div aria-hidden="true" className="t2f-mm-sep" />
      <div className="t2f-mm-cols">
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          data-menu-first=""
          className="t2f-mm-item t2f-mm-col"
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
          className="t2f-mm-item t2f-mm-col"
          onClick={() => done(() => onMention?.(message), false)}
        >
          <Svg>
            <circle cx="12" cy="12" r="4" />
            <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1" />
          </Svg>
          {t('mention')}
        </button>
        {tr.lang ? (
          <button
            type="button"
            role="menuitem"
            data-menu-item=""
            data-action="translate"
            className="t2f-mm-item t2f-mm-col"
            onClick={(e) => done(() => (onTranslateLocked ? onTranslateLocked() : tr.showing ? tr.toggle() : tr.translateNow()), e.detail === 0)}
          >
            <span className="t2f-mm-colicon">
              <Svg>
                <path d="M3 5h9M7.5 3v2" />
                <path d="M10 5c-.8 3.6-3 6.4-6 8" />
                <path d="M5.5 8.5c1 1.8 2.6 3.3 4.5 4.3" />
                <path d="M12.5 21l4-9 4 9M13.8 18h5.4" />
              </Svg>
              {onTranslateLocked ? <span className="t2f-mm-passdot" role="img" aria-label={t('passOnly')} /> : null}
            </span>
            {tr.showing ? t('translate.original') : t('translate.action')}
          </button>
        ) : null}
        <button
          type="button"
          role="menuitem"
          data-menu-item=""
          className="t2f-mm-item t2f-mm-col t2f-mm-report"
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
