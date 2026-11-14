'use client';

/**
 * Чат на сторінках з ефіром — головна, країна, кімната перегляду, «Країни й міста» — завжди складається однаково:
 * - десктоп: панель чату (`ChatPanel`) у колонці макета (`#chat-slot`, портал), доки чат не сховали; сховали —
 *   «Показати чат» (`ChatHiddenButton`) у рядку назви поруч із таймером;
 * - телефон: закріплене вікно внизу (`ChatDock`) з тією самою панеллю; «Сховати» = згорнути вікно.
 * Хук віддає три готові шматки, а сторінка ставить їх у свої місця розмітки.
 */
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatHiddenButton } from '@/components/chat/ChatHiddenButton';
import { ChatPanel, type ChatPanelProps } from '@/components/chat/ChatPanel';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import type { RoomId } from '@/lib/data/types';

export interface LiveChatOptions {
  /** Десктоп із колонкою чату (`useChatColumn()`); інакше — телефон / планшет-портрет. */
  chatColumn: boolean;
  /** Кімната для лічильника «Показати чат» і для згорнутого вікна на телефоні. */
  room: RoomId;
  /** Підпис згорнутого вікна на телефоні («Світ», «Країна · Франція»). */
  roomLabel: string;
  /** Що панель знає про сторінку: країна, країни вікон кімнати, з якої кімнати почати. */
  panel: Pick<ChatPanelProps, 'country' | 'countries' | 'onCountryChange' | 'startInWorld'>;
}

export interface LiveChat {
  /** «Показати чат» — лише десктоп, коли чат сховано; інакше `null`. */
  showButton: ReactNode;
  /** Панель у колонці чату (портал) — десктоп, чат не сховано; інакше `null`. */
  column: ReactNode;
  /** Закріплене вікно чату — телефон; на десктопі `null`. */
  dock: ReactNode;
}

export function useLiveChat({ chatColumn, room, roomLabel, panel }: LiveChatOptions): LiveChat {
  const vis = useChatVisibility();
  const { collapse } = useChatDockControls();
  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const render = (className: string) => (
    <ChatPanel
      {...panel}
      onHide={chatColumn ? vis.hide : collapse}
      collapseMode={!chatColumn}
      onToEvents={chatColumn ? undefined : collapse}
      className={className}
    />
  );
  return {
    showButton: chatColumn && vis.hidden ? <ChatHiddenButton room={room} onShow={vis.show} /> : null,
    column: chatSlot && !vis.hidden ? createPortal(render('h-full'), chatSlot) : null,
    dock: chatColumn ? null : (
      <ChatDock room={room} roomLabel={roomLabel}>
        {render('min-h-0 flex-1')}
      </ChatDock>
    ),
  };
}
