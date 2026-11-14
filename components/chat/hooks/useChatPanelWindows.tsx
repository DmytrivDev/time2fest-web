/**
 * Вікна, які відкриває `ChatPanel`: O-NICK («Нік і прапор»), O-AUTHOR (картка автора), «Потрібен пас» для функції
 * чату, «Переклад повідомлень» (шлюз без пасу). Також `submit` — надсилання з відкриттям O-NICK, якщо ніка ще немає.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { AuthorPanel } from '@/components/chat/parts/AuthorPanel';
import { passGateSpec } from '@/components/offers/OfferWindows';
import { useGetPass, usePassDetails } from '@/components/pass/PassWindow';
import { Icon } from '@/components/primitives/Icon';
import { useOverlay } from '@/components/shell/OverlayManager';
import { GATE_KEYS, type PassGateFeature } from '@/components/pass/PassGate';
import { Nick } from '@/components/chat/parts/Nick';
import { hasPassNow, profileActions } from '@/lib/api/hooks/auth';
import { chatActions } from '@/lib/api/hooks/chat';
import { currentStamps } from '@/lib/api/hooks/passport';
import { authorHasPass, buildOwnPath } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage } from '@/lib/data/types';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useClock } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { TRANSLATE_GATE_WINDOW_ID, TranslateGate } from '@/components/chat/parts/TranslateGate';
import type { MessageLookup } from '@/components/chat/parts/Message';
import { sendReport, type ReportState } from './useChatMessageActions';

export const NICK_WINDOW_ID = 'O-NICK';
export const AUTHOR_WINDOW_ID = 'O-AUTHOR';

export function useChatPanelWindows(o: {
  lookup: MessageLookup;
  focusField: () => void;
  trySend: (text: string, override?: { nick: string; flagCode: string }) => 'sent' | 'nick' | 'error';
  setReported: Dispatch<SetStateAction<ReportState>>;
}) {
  const { lookup, focusField, trySend, setReported } = o;
  const t = useTranslations('chat');
  const tPass = useTranslations('pass');
  const clock = useClock();
  const overlay = useOverlay();
  const openAuthWindow = useOpenAuthWindow();
  const getPass = useGetPass();
  const passDetails = usePassDetails();

  const flagOptions = useMemo(
    () => getData().countries.map((c) => ({ code: c.flagCode, name: c.name.uk })),
    [],
  );
  const takenNicks = useMemo(() => chatActions.takenNicks(), []);

  const openNick = useCallback(
    (pendingText: string | null) => {
      const store = useGuestStore.getState();
      const detected = store.detectedFlag ?? detectFlag();
      if (detected && detected !== store.detectedFlag) void profileActions.update({ detectedFlag: detected });
      overlay.open({
        id: NICK_WINDOW_ID,
        inChat: true,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: t('nick.title'),
        description: t('nick.description'),
        onClose: focusField,
        content: (
          <Nick
            initialNick={store.nick}
            initialFlag={store.flagCode}
            detectedFlag={detected}
            flags={flagOptions}
            takenNicks={takenNicks}
            onSignIn={() => openAuthWindow()}
            onGetPass={() => getPass()}
            onDone={async ({ nick, flagCode }) => {
              // Нік і прапор — профіль (шов, залишки E5). Не збереглося (стан шва №10, рішення 2026-11-14) — вікно
              // лишається з помилкою й «Спробувати ще»; повідомлення зі старим підписом не надсилаємо (текст — у полі).
              const res = await profileActions.update({ nick, ...(flagCode ? { flagCode } : {}) });
              if (!res.ok) return false;
              overlay.close(NICK_WINDOW_ID);
              if (pendingText) trySend(pendingText, { nick, flagCode });
              return true;
            }}
          />
        ),
      });
    },
    [overlay, t, flagOptions, takenNicks, trySend, focusField, openAuthWindow, getPass],
  );

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (trySend(text) === 'nick') openNick(text);
    },
    [trySend, openNick],
  );

  const openAuthor = useCallback(
    (author: Author, message: ChatMessage) => {
      const hasPass = authorHasPass(author);
      const guest = useGuestStore.getState();
      const path = author.isMine
        ? buildOwnPath(currentStamps(), guest.schedule, getData(), clock.getSnapshot())
        : (chatActions.authorPath(author, clock.getSnapshot())?.points ?? []);
      const viewerHasPass = hasPassNow();
      overlay.open({
        id: AUTHOR_WINDOW_ID,
        inChat: true,
        kind: 'nonmodal',
        chrome: 'author',
        coral: !viewerHasPass,
        title: t('author.title'),
        content: (
          <AuthorPanel
            author={author}
            countryName={lookup.countryName?.(author.flagCode)}
            message={message}
            hasPass={hasPass}
            routeHidden={!author.isMine && !!chatActions.authorPath(author, clock.getSnapshot())?.hidden}
            path={path}
            viewerHasPass={viewerHasPass}
            // Підтвердження панель показує сама; у чаті після закриття картки ще кілька секунд — та сама плашка.
            onReport={(m) => {
              setReported(true);
              if (m) void sendReport(m, setReported);
            }}
            onEditProfile={author.isMine ? () => openNick(null) : undefined}
            onGetPass={() => getPass()}
            onPassInfo={passDetails}
          />
        ),
      });
    },
    [overlay, t, clock, lookup, openNick, getPass, passDetails, setReported],
  );

  const openPassGate = useCallback(
    (feature: PassGateFeature) =>
      overlay.open(
        passGateSpec({ now: () => clock.getSnapshot() }, { feature, trigger: '', title: tPass(GATE_KEYS[feature].title) }),
      ),
    [overlay, clock, tPass],
  );

  // «Перекласти» без пасу — вікно «Переклад повідомлень» на місці чату (правка власника 2026-11-10; було — плашка
  // «Потрібен пас» унизу сторінки).
  const openTranslateGate = useCallback(
    (message: ChatMessage) =>
      overlay.open({
        id: TRANSLATE_GATE_WINDOW_ID,
        inChat: true,
        kind: 'form',
        chrome: 'board',
        coral: true,
        title: (
          <span className="inline-flex items-center gap-2">
            <Icon name="translate" size={20} className="text-highlight" />
            {t('translateGate.title')}
          </span>
        ),
        content: <TranslateGate message={message} onGetPass={() => getPass()} onPassInfo={passDetails} />,
      }),
    [overlay, t, getPass, passDetails],
  );

  return { openNick, submit, openAuthor, openPassGate, openTranslateGate };
}
