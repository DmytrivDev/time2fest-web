'use client';

import { useTranslations } from 'next-intl';
import { Dialog, VisuallyHidden } from 'radix-ui';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Logo } from '@/components/primitives/Logo';
import { useSheetTop } from '@/lib/overlay/sheetTop';
import { useSwipeDown } from '@/lib/overlay/useSwipeDown';
import ms from './menu.module.css';

/** Шторка, а не бічна панель: телефон і планшет-портрет (збігається з `menu.module.css`). */
const isSheetViewport = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(max-width: 767.98px), (min-width: 768px) and (max-width: 1199.98px) and (orientation: portrait)').matches;

/**
 * Бічне вікно поза `(live)` (службові сторінки, пас, вхід, 404) — Radix Dialog: десктоп — панель праворуч під шапкою,
 * телефон і планшет-портрет — шторка до низу відео / шапки + 16:9 без затемнення (2026-11-10), планшет-альбом — на весь екран. Спільне для меню й сповіщень.
 */
export function SideDialog({
  open,
  onOpenChange,
  title,
  onBack,
  logo = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Другий рівень («‹ Назад»). */
  onBack?: () => void;
  /** Лого замість назви на планшеті (меню). */
  logo?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('menu');
  const th = useTranslations('header');
  // Телефон і планшет-портрет — шторка; верх — за правилом сайту (під відео / шапка + 16:9, 2026-11-10).
  const top = useSheetTop('video', open);
  // Вікно відкривається без Dialog.Trigger (кнопка — у хедері), тож Radix не знає, куди повернути фокус:
  // запам’ятовуємо елемент з фокусом до відкриття й повертаємо на нього після закриття (WCAG 2.4.3).
  const returnFocus = useRef<HTMLElement | null>(null);
  // Свайп униз за ручку й шапку закриває шторку (телефон і планшет-портрет; Т9, 2026-11-16).
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);
  const dragY = useSwipeDown(panelEl, open, () => onOpenChange(false), { when: isSheetViewport });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          ref={setPanelEl}
          data-menu=""
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
          }}
          onCloseAutoFocus={(e) => {
            if (!returnFocus.current?.isConnected) return;
            e.preventDefault();
            returnFocus.current.focus();
          }}
          className={cn('text-text', ms.panel)}
          style={
            {
              ...(top !== undefined ? { '--menu-top': `${top}px` } : null),
              ...(dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : null),
            } as CSSProperties
          }
        >
          <span aria-hidden="true" className={ms.handle} data-swipe-zone="" />
          <header className={ms.head} data-swipe-zone="">
            {onBack ? (
              <button type="button" onClick={onBack} className={cn('t2f-focus', ms.back)}>
                <Icon name="chevron-left" size={18} />
                {t('back')}
              </button>
            ) : null}
            {logo && !onBack ? <Logo label={th('logoLabel')} className={cn('me-auto', ms.logo)} /> : null}
            <span aria-hidden="true" className={cn(ms.title, !logo && ms.titleAlways)}>
              {title}
            </span>
            <VisuallyHidden.Root asChild>
              <Dialog.Title>{title}</Dialog.Title>
            </VisuallyHidden.Root>
            <Dialog.Close asChild>
              <IconButton icon="close" iconSize={20} aria-label={t('closeWindow')} className={ms.close} />
            </Dialog.Close>
          </header>
          <div className={ms.body}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
