/**
 * Єдиний Tab-стоп стрічки `Chat` із рухомим фокусом: останній сфокусований автор, інакше найновіше повідомлення з автором;
 * ↑/↓/Home/End переходять між авторами.
 */
import { useState, type KeyboardEvent, type RefObject } from 'react';
import type { ChatMessage } from '@/lib/data/types';

export function useChatAuthorStop(visible: readonly ChatMessage[], logRef: RefObject<HTMLDivElement | null>) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Єдиний Tab-стоп: останній сфокусований автор, інакше найновіше повідомлення з автором.
  const authored = visible.filter((m) => m.kind === 'regular' && m.author);
  const stopId = authored.some((m) => m.id === activeId)
    ? activeId
    : (authored[authored.length - 1]?.id ?? null);

  const onAuthorKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    const root = logRef.current;
    if (!root) return;
    const items = [...root.querySelectorAll<HTMLButtonElement>('[data-chat-author]')];
    const i = items.indexOf(e.currentTarget);
    if (i === -1) return;
    const next =
      e.key === 'ArrowUp'
        ? i - 1
        : e.key === 'ArrowDown'
          ? i + 1
          : e.key === 'Home'
            ? 0
            : items.length - 1;
    const target = items[Math.max(0, Math.min(items.length - 1, next))];
    if (!target) return;
    e.preventDefault();
    target.focus();
  };

  return { authoredCount: authored.length, stopId, setActiveId, onAuthorKeyDown };
}
