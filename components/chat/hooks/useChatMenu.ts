/**
 * Меню «⋯» повідомлення в `Chat`: яке повідомлення відкрито, відкриття/закриття (з поверненням фокусу).
 * Меню зникає разом із повідомленням (`menuMessage` = null).
 */
import { useCallback, useState, type RefObject } from 'react';
import type { ChatMessage } from '@/lib/data/types';

export interface ChatMenuState {
  message: ChatMessage;
  anchor: HTMLElement;
  container: HTMLElement;
  scroller: HTMLElement;
}

export function useChatMenu(visible: readonly ChatMessage[], wrapRef: RefObject<HTMLDivElement | null>, logRef: RefObject<HTMLDivElement | null>) {
  const [menu, setMenu] = useState<ChatMenuState | null>(null);

  // Меню «⋯»: перемикається тією ж кнопкою; зникає разом із повідомленням.
  const openMenu = useCallback((message: ChatMessage, trigger: HTMLElement) => {
    const anchor = trigger.closest<HTMLElement>('[data-msg-id]');
    const container = wrapRef.current;
    const scroller = logRef.current;
    if (!anchor || !container || !scroller) return;
    setMenu((cur) =>
      cur?.message.id === message.id ? null : { message, anchor, container, scroller },
    );
  }, [wrapRef, logRef]);
  const closeMenu = useCallback((opts?: { restoreFocus?: boolean }) => {
    setMenu((cur) => {
      if (cur && opts?.restoreFocus)
        cur.anchor.querySelector<HTMLElement>('[data-msg-trigger]')?.focus();
      return null;
    });
  }, []);
  const menuMessage = menu ? (visible.find((m) => m.id === menu.message.id) ?? null) : null;

  return { menu, menuMessage, openMenu, closeMenu };
}
