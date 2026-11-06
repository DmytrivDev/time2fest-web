'use client';

/**
 * Чат на сторінці без плеєра (як на «Країнах і містах»): десктоп — колонка чату макета `(live)` (`#chat-slot`),
 * телефон — плашка згорнутого чату внизу (`ChatDock`). Кімната «Світ» з імітатором.
 */
import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChatDock, useChatDockControls } from '@/components/chat/ChatDock';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatVisibility } from '@/components/chat/useChatVisibility';
import { CHAT_SLOT_ID } from '@/components/primitives/Panel';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useChatSimulator } from '@/lib/chat-sim/useChatSimulator';

export function PageChat() {
  const tChat = useTranslations('chat');
  const chatColumn = useChatColumn();
  const vis = useChatVisibility();
  const { collapse } = useChatDockControls();
  useChatSimulator(useMemo(() => ['world' as const], []));
  const chatSlot = chatColumn && typeof document !== 'undefined' ? document.getElementById(CHAT_SLOT_ID) : null;
  const panel = (cls?: string) => (
    <ChatPanel startInWorld onHide={chatColumn ? vis.hide : collapse} collapseMode={!chatColumn} onToEvents={chatColumn ? undefined : collapse} className={cls} />
  );
  return (
    <>
      {chatSlot && !vis.hidden ? createPortal(panel('h-full'), chatSlot) : null}
      {!chatColumn ? (
        <ChatDock room="world" roomLabel={tChat('roomWorld')}>
          {panel('min-h-0 flex-1')}
        </ChatDock>
      ) : null}
    </>
  );
}
