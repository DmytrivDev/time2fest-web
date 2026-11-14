/**
 * «Налаштування чату» / «Правила чату» на місці стрічки в `Chat`: стан панелі, фокус на заголовок, повернення фокусу
 * на «⋯», Esc, автоповернення до стрічки після власного повідомлення.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/data/types';

export function useChatSettingsPanel(roomId: string, visible: readonly ChatMessage[]) {
  // «Налаштування чату» на місці стрічки.
  // «Правила чату» — теж на місці стрічки, з налаштувань («‹» повертає до них).
  const [panel, setPanel] = useState<null | 'settings' | 'rules'>(null);
  const settingsOpen = panel !== null;
  const setSettingsOpen = useCallback((v: boolean) => setPanel(v ? 'settings' : null), []);
  const openRulesPanel = useCallback(() => setPanel('rules'), []);
  const dotsRef = useRef<HTMLButtonElement>(null);
  const settingsTitleRef = useRef<HTMLHeadingElement | null>(null);
  const settingsId = `chat-settings-${roomId.replace(/[^a-z0-9]/gi, '-')}`;
  const closeSettings = useCallback(
    (restoreFocus = true) => {
      setSettingsOpen(false);
      if (restoreFocus) requestAnimationFrame(() => dotsRef.current?.focus());
    },
    [setSettingsOpen],
  );
  useEffect(() => {
    if (panel) settingsTitleRef.current?.focus();
  }, [panel]);
  // Надіслав повідомлення з відкритими налаштуваннями — показуємо чат із новим повідомленням.
  const lastMine = [...visible].reverse().find((m) => m.author?.isMine)?.id ?? null;
  const [seenMine, setSeenMine] = useState(lastMine);
  if (lastMine !== seenMine) {
    setSeenMine(lastMine);
    if (settingsOpen) setSettingsOpen(false);
  }
  // Esc у налаштуваннях — назад до стрічки, фокус на «⋯».
  const settingsBoxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !settingsBoxRef.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      closeSettings();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [settingsOpen, closeSettings]);

  return {
    panel,
    setPanel,
    settingsOpen,
    setSettingsOpen,
    openRulesPanel,
    dotsRef,
    settingsTitleRef,
    settingsId,
    closeSettings,
    settingsBoxRef,
  };
}
