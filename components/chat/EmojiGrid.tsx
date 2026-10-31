'use client';

/**
 * Сітка емодзі 3×8 (клітинки 44×44, без видимих підписів — `aria-label` на кожній): спільна для меню «⋯» повідомлення
 * (`MessageMenu`) і вибору емодзі в полі введення (`Composer`). Стилі — `t2f-mm-grid`, `t2f-mm-item`, `t2f-mm-emoji`.
 */
import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';
import type { ReactionId } from '@/lib/data/types';
import { MENU_REACTION_ROWS, REACTION_SYMBOLS } from './reactions';
import { Emoji } from '@/components/primitives/Emoji';

export interface EmojiGridProps {
  /** Роль клітинки (меню: `menuitemcheckbox`); без значення — звичайна кнопка. */
  cellRole?: 'menuitemcheckbox';
  /** Для `menuitemcheckbox`: чи обрано реакцію. */
  checked?: (id: ReactionId) => boolean;
  /** Ключ повідомлення для підпису клітинки: `reactionPickLabel` («Реакція …») або `emojiInsertLabel` («Вставити …»). */
  label?: 'reactionPickLabel' | 'emojiInsertLabel';
  /** Доступна назва ряду. */
  groupLabel: string;
  onPick: (id: ReactionId, symbol: string, e: MouseEvent<HTMLButtonElement>) => void;
  /** Не забирати фокус із поля введення при натисканні мишею. */
  keepFocus?: boolean;
}

export function EmojiGrid({
  cellRole,
  checked,
  label = 'reactionPickLabel',
  groupLabel,
  onPick,
  keepFocus = false,
}: EmojiGridProps) {
  const t = useTranslations('chat');
  return (
    <div className="t2f-mm-grid">
      {MENU_REACTION_ROWS.map((row, r) => (
        <div key={r} role="group" aria-label={groupLabel} className="t2f-mm-gridrow">
          {row.map((id) => (
            <button
              key={id}
              type="button"
              {...(cellRole ? { role: cellRole, 'aria-checked': checked?.(id) ?? false } : {})}
              data-menu-item=""
              aria-label={t(label, { name: t(`reactions.${id}`) })}
              className="t2f-mm-item t2f-mm-emoji"
              onMouseDown={keepFocus ? (e) => e.preventDefault() : undefined}
              onClick={(e) => onPick(id, REACTION_SYMBOLS[id], e)}
            >
              <Emoji char={REACTION_SYMBOLS[id]} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Куди йде фокус від клавіші-стрілки: ←/→ — сусідні (по колу), ↑/↓ — найближчий по горизонталі елемент сусіднього ряду. */
export function arrowTarget(
  items: readonly HTMLElement[],
  i: number,
  key: string,
): HTMLElement | undefined {
  if (key === 'ArrowRight') return items[(i + 1) % items.length];
  if (key === 'ArrowLeft') return items[(i - 1 + items.length) % items.length];
  if (key === 'Home') return items[0];
  if (key === 'End') return items[items.length - 1];
  const rect = (el: HTMLElement) => el.getBoundingClientRect();
  const cur = rect(items[i]!);
  const cx = cur.left + cur.width / 2;
  const dir = key === 'ArrowDown' ? 1 : -1;
  const rowTops = [...new Set(items.map((el) => Math.round(rect(el).top)))].sort((x, y) => x - y);
  const rowIndex = rowTops.indexOf(Math.round(cur.top));
  const nextTop = rowTops[(rowIndex + dir + rowTops.length) % rowTops.length]!;
  const row = items.filter((el) => Math.round(rect(el).top) === nextTop);
  return row.reduce((best, el) => {
    const r = rect(el);
    const b = rect(best);
    return Math.abs(r.left + r.width / 2 - cx) < Math.abs(b.left + b.width / 2 - cx) ? el : best;
  });
}
