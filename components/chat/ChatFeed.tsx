'use client';

/**
 * Список повідомлень `Chat` (`<ol>`): повідомлення, меню «⋯» у потоці (телефон) просто під повідомленням.
 */
import { Fragment, type KeyboardEvent } from 'react';
import type { Author, ChatMessage } from '@/lib/data/types';
import { Message, type MessageLookup } from './Message';
import type { MessageActionHandlers } from './MessageActions';
import { MessageMenu } from './MessageMenu';
import type { ChatMenuState } from './useChatMenu';

export function ChatFeed({
  visible,
  deletedIds,
  lookup,
  stopId,
  onAuthorOpen,
  onAuthorFocus,
  onAuthorKeyDown,
  messageActions,
  openMenu,
  closeMenu,
  menu,
  menuMessage,
  inlineMenu,
}: {
  visible: readonly ChatMessage[];
  deletedIds: ReadonlySet<string>;
  lookup?: MessageLookup;
  stopId: string | null;
  onAuthorOpen?: (author: Author, message: ChatMessage) => void;
  onAuthorFocus: (id: string) => void;
  onAuthorKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  messageActions?: MessageActionHandlers & { menuAlways?: boolean };
  openMenu: (message: ChatMessage, trigger: HTMLElement) => void;
  closeMenu: (opts?: { restoreFocus?: boolean }) => void;
  menu: ChatMenuState | null;
  menuMessage: ChatMessage | null;
  inlineMenu: boolean;
}) {
  return (
    <ol className="t2f-chat-feed flex min-h-full list-none flex-col justify-end px-1.5 py-2">
      {visible.map((m) => (
        <Fragment key={m.id}>
          <Message
            message={m}
            lookup={lookup}
            tabStop={m.id === stopId}
            onAuthorOpen={onAuthorOpen ? (a) => onAuthorOpen(a, m) : undefined}
            onAuthorFocus={() => onAuthorFocus(m.id)}
            onAuthorKeyDown={onAuthorKeyDown}
            onReact={messageActions?.onReact}
            onOpenMenu={messageActions && !m.deleted ? openMenu : undefined}
            onDelete={messageActions?.onDelete}
            quoteDeleted={!!m.replyTo && deletedIds.has(m.replyTo.id)}
            menuOpen={menuMessage?.id === m.id}
            menuAlways={messageActions?.menuAlways}
          />
          {inlineMenu && menu && menuMessage?.id === m.id ? (
            <li role="presentation" className="t2f-mm-inline-item">
              <MessageMenu
                key={m.id}
                inline
                message={m}
                anchor={menu.anchor}
                container={menu.container}
                scroller={menu.scroller}
                onClose={closeMenu}
                onReact={messageActions?.onReact}
                onReply={messageActions?.onReply}
                onMention={messageActions?.onMention}
                onReport={messageActions?.onReport}
                onTranslateLocked={messageActions?.onTranslateLocked}
              />
            </li>
          ) : null}
        </Fragment>
      ))}
    </ol>
  );
}
