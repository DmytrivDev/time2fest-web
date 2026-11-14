'use client';

/**
 * C9 ChatPanel — повний чат на сторінці (US4, FR-050…056): склеює `Chat` (шапка, стрічка), `Composer`, вікна O-NICK,
 * O-AUTHOR, дії над повідомленням і стан «сховано». Дані — сервіс чату через хуки (`lib/api/hooks/chat`, шов E5a):
 * стрічка кімнати, стан з’єднання, повільний режим; поле перевіряє текст саме (`lib/chat/send`), сервіс — ще раз.
 *
 * Кімнати: головна — «Світ»; сторінка країни — «Країна» (за замовчуванням) і «Світ» (кімнату «Перший ряд» прибрано
 * разом із рядом, рішення власника 2026-11-12). Перше власне повідомлення без ніка відкриває O-NICK; текст лишається в полі й надсилається після «Готово».
 * Недоступність (стан з’єднання кімнати) замінює чат на «Чат тимчасово недоступний…», решта сайту працює.
 *
 * Файл — композиція: кімната й стрічка — `useChatPanelRoom`, надсилання — `useChatSend`/`useChatSlowMode`, вікна —
 * `useChatPanelWindows`, дії над повідомленням — `useChatMessageActions`, перемикач кімнат — `ChatRoomSwitcher`.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useCanToast } from '@/components/toast/useToastSeason';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { useChatColumn } from '@/components/shell/OverlayManager';
import { useGetPass } from '@/components/pass/PassWindow';
import { useHasPass } from '@/lib/api/hooks/auth';
import { getData } from '@/lib/data/load';
import { useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { Chat } from './Chat';
import { ChatEmptyCountrySub, ChatRoomSwitcher } from './ChatRoomSwitcher';
import { ChatSettings } from './ChatSettings';
import { Composer, type ComposerError } from './Composer';
import { useChatLookup } from './useChatLookup';
import { useChatMessageActions } from './useChatMessageActions';
import { useChatPanelRoom } from './useChatPanelRoom';
import { useChatPanelWindows } from './useChatPanelWindows';
import { useChatSend, useChatSlowMode } from './useChatSend';

export { NICK_WINDOW_ID, AUTHOR_WINDOW_ID } from './useChatPanelWindows';

export interface ChatPanelProps {
  /** Кімната «Країна»: країна сторінки; на головній — країна ефіру, що йде зараз (без країни чипа немає). */
  country?: { iso: string; name: string };
  /** Лише кімната перегляду з вікнами кількох країн: список країн (чип «Країна» відкриває його). */
  countries?: { iso: string; name: string }[];
  onCountryChange?: (iso: string) => void;
  /** Головна: чат відкривається у «Світ», хоча кімната країни є. */
  startInWorld?: boolean;
  /** Сховати чат (кнопка в шапці); без значення — кнопки немає. */
  onHide?: () => void;
  /** Телефон: чат у закріпленому вікні — кнопка шапки «Згорнути чат». */
  collapseMode?: boolean;
  /** «До подій» у стані «чат недоступний». */
  onToEvents?: () => void;
  className?: string;
}

export function ChatPanel({
  country,
  countries,
  onCountryChange,
  startInWorld,
  onHide,
  collapseMode,
  onToEvents,
  className,
}: ChatPanelProps) {
  const t = useTranslations('chat');
  const openToast = useOpenToastWindow();
  // Келих у полі — лише поки свято йде (рішення власника 2026-11-13).
  const canToast = useCanToast();
  const getPass = useGetPass();
  const column = useChatColumn();
  const source = useTimeSource();
  const now = useNow();
  const lookup = useChatLookup();

  const guest = useGuestStore();
  const viewerPass = useHasPass();
  const { recordSent } = guest;
  // «Немає з’єднання» — стан мережі пристрою (тестова панель імітує його для всього сайту, не лише чату).
  const offline = useTestControls((s) => s.offlineSimulated);
  const slowForced = useTestControls((s) => s.slowForcedSec);
  const replyTo = useChatUi((s) => s.replyTo);
  const setReplyTo = useChatUi((s) => s.setReplyTo);

  const { setRoomKey, activeKey, roomId, roomLabel, available, messages, quietHidden } = useChatPanelRoom({
    country,
    startInWorld,
    guest,
    source,
  });

  const draft = useChatUi((s) => s.draft);
  const setDraft = useChatUi((s) => s.setDraft);
  const [error, setError] = useState<ComposerError>(null);
  const [reported, setReported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!reported) return;
    const id = setTimeout(() => setReported(false), 4_000);
    return () => clearTimeout(id);
  }, [reported]);

  const { slowTotal, slowRemaining } = useChatSlowMode({ roomId, now, source, slowForced, guest });

  const focusField = useCallback(() => {
    // Після закриття вікна фокус повертається на тригер; поле беремо наступним кадром.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const trySend = useChatSend({ roomId, source, replyTo, recordSent, setReplyTo, setDraft, setError });
  const { openNick, submit, openAuthor, openPassGate, openTranslateGate } = useChatPanelWindows({
    lookup,
    focusField,
    trySend,
    setReported,
  });
  const { onReact, onReply, onDelete, onReport, onMention } = useChatMessageActions({
    focusField,
    setDraft,
    setReplyTo,
    setReported,
  });

  const switcher = country ? (
    <ChatRoomSwitcher
      country={country}
      countries={countries}
      onCountryChange={onCountryChange}
      activeKey={activeKey}
      onRoomChange={setRoomKey}
    />
  ) : undefined;

  const banner = offline ? (
    <StatusMessage kind="offline">{t('offline')}</StatusMessage>
  ) : reported ? (
    <StatusMessage kind="success">{t('reportedVisible')}</StatusMessage>
  ) : undefined;

  const ownFlag = guest.flagCode ?? guest.detectedFlag;
  const emptyInfo =
    activeKey === 'country' && country
      ? { flagCode: country.iso, sub: <ChatEmptyCountrySub country={country} ownFlag={ownFlag} /> }
      : undefined;

  return (
    <Chat
      room={{ id: roomId, label: roomLabel }}
      messages={messages}
      state={available ? 'live' : 'unavailable'}
      lookup={lookup}
      roomSwitcher={switcher}
      emptyInfo={emptyInfo}
      banner={banner}
      onAuthorOpen={openAuthor}
      onHide={onHide}
      collapseMode={collapseMode}
      onToEvents={onToEvents}
      settings={({ titleRef, id, openRules: openRulesPanel }) => (
        <ChatSettings
          id={id}
          titleRef={titleRef}
          hasPass={viewerPass}
          quietHidden={quietHidden}
          nick={guest.nick ?? null}
          flagCode={guest.flagCode ?? guest.detectedFlag ?? null}
          countryName={getData().countries.find((c) => c.flagCode === (guest.flagCode ?? guest.detectedFlag))?.name.uk}
          onEditNick={() => openNick(null)}
          onRules={openRulesPanel}
          onGetPass={() => getPass()}
          onPassGate={openPassGate}
        />
      )}
      announceNew
      messageActions={{ menuAlways: !column, onReact, onReply, onMention, onReport, onDelete, onTranslateLocked: viewerPass ? undefined : openTranslateGate }}
      composer={
        <Composer
          room={{ id: roomId, label: roomLabel }}
          value={draft}
          onValueChange={(v) => {
            setDraft(v);
            if (error) setError(null);
          }}
          onSubmit={() => submit(draft)}
          error={error}
          slowRemaining={slowRemaining}
          slowTotal={slowTotal}
          offline={offline}
          reply={
            replyTo && replyTo.room === roomId
              ? { nick: replyTo.nick, excerpt: replyTo.excerpt }
              : null
          }
          onCancelReply={() => setReplyTo(null)}
          textareaRef={textareaRef}
          onToast={canToast ? () => openToast() : undefined}
        />
      }
      className={className}
    />
  );
}
