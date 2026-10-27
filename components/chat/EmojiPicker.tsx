'use client';

/**
 * Вибір емодзі в полі введення: сітка з меню «⋯» без кнопок дій, над рядком поля (від лівого краю поля до правого краю
 * «Надіслати», відступ 4 px), поверх низу стрічки, без зсуву розкладки. Живе всередині `position: relative` рядка
 * композера. Закривається Esc, кліком поза ним і повторним натисканням кнопки-емодзі; стрілки рухають фокус між
 * клітинками, Enter/Пробіл вставляють, Esc повертає фокус на кнопку.
 */
import { useTranslations } from 'next-intl';
import { useLayoutEffect, useRef, type KeyboardEvent } from 'react';
import { EmojiGrid, arrowTarget } from './EmojiGrid';

export interface EmojiPickerProps {
  id?: string;
  /** Вставити емодзі в позицію курсора поля. */
  onInsert: (symbol: string) => void;
  /** `restoreFocus` — повернути фокус на кнопку-емодзі (Esc). */
  onClose: (opts?: { restoreFocus?: boolean }) => void;
  /** Фокус на першу клітинку (відкрито з клавіатури). */
  focusFirst?: boolean;
}

export function EmojiPicker({ id, onInsert, onClose, focusFirst = false }: EmojiPickerProps) {
  const t = useTranslations('chat');
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (focusFirst)
      ref.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus({ preventScroll: true });
  }, [focusFirst]);

  // Клік поза вибором закриває (кнопка-емодзі перемикає сама).
  useLayoutEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || ref.current?.contains(target) || target.closest('[data-emoji-trigger]'))
        return;
      onClose({ restoreFocus: false });
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    arrowTarget(items, i, e.key)?.focus();
  };

  return (
    // Клавіатурна модель сітки (стрілки) живе на контейнері; кожна клітинка — окрема кнопка.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      id={id}
      ref={ref}
      role="group"
      aria-label={t('emojiPicker')}
      data-emoji-picker=""
      onKeyDown={onKeyDown}
      className="t2f-mm t2f-ep"
    >
      <EmojiGrid
        groupLabel={t('emojiButton')}
        label="emojiInsertLabel"
        keepFocus
        onPick={(_id, symbol) => onInsert(symbol)}
      />
    </div>
  );
}
