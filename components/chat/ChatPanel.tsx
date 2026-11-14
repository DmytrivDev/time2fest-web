'use client';

/**
 * C9 ChatPanel — повний чат на сторінці (US4, FR-050…056): склеює `Chat` (шапка, стрічка), `Composer`, вікна O-NICK,
 * O-AUTHOR, дії над повідомленням і стан «сховано». Дані — сервіс чату через хуки (`lib/api/hooks/chat`, шов E5a):
 * стрічка кімнати, стан з’єднання, повільний режим; поле перевіряє текст саме (`lib/chat/send`), сервіс — ще раз.
 *
 * Кімнати: головна — «Світ»; сторінка країни — «Країна» (за замовчуванням) і «Світ» (кімнату «Перший ряд» прибрано
 * разом із рядом, рішення власника 2026-11-12). Перше власне повідомлення без ніка відкриває O-NICK; текст лишається в полі й надсилається після «Готово».
 * Недоступність (стан з’єднання кімнати) замінює чат на «Чат тимчасово недоступний…», решта сайту працює.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useCanToast } from '@/components/toast/useToastSeason';
import { AuthorPanel } from '@/components/live/AuthorPanel';
import { passGateSpec } from '@/components/offers/OfferWindows';
import { GATE_KEYS, type PassGateFeature } from '@/components/windows/PassGate';
import { currentStamps } from '@/lib/api/hooks/passport';
import { isQuietHidden, quietHiddenCount } from '@/lib/chat/quiet';
import { useChatPref } from '@/stores/chatPrefs';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { SegmentedControl, type SegmentOption } from '@/components/primitives/SegmentedControl';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { Icon } from '@/components/primitives/Icon';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { Nick } from '@/components/windows/Nick';
import { useGetPass, usePassDetails } from '@/components/pass/PassWindow';
import { chatActions, chatDev, useChatConnection, useRoomMessages, useSlowModeSeconds } from '@/lib/api/hooks/chat';
import { authorHasPass, buildOwnPath } from '@/lib/chat/authorPath';
import { slowRemainingSec, validateSend, type SendContext, type SendError } from '@/lib/chat/send';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ReactionId, RoomId } from '@/lib/data/types';
import { detectFlag } from '@/lib/geo/detectFlag';
import { Flag } from '@/components/primitives/Flag';
import { useClock, useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { excerptOf } from '@/lib/chat/send';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { Chat } from './Chat';
import { ChatSettings } from './ChatSettings';
import { Composer, type ComposerError } from './Composer';
import { TRANSLATE_GATE_WINDOW_ID, TranslateGate } from './TranslateGate';
import { useChatLookup } from './useChatLookup';
import { hasPassNow, profileActions, useHasPass } from '@/lib/api/hooks/auth';

export const NICK_WINDOW_ID = 'O-NICK';
export const AUTHOR_WINDOW_ID = 'O-AUTHOR';

type RoomKey = 'world' | 'country';

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
  const tPass = useTranslations('pass');
  const clock = useClock();
  const announce = useAnnounce();
  const overlay = useOverlay();
  const openAuthWindow = useOpenAuthWindow();
  const openToast = useOpenToastWindow();
  // Келих у полі — лише поки свято йде (рішення власника 2026-11-13).
  const canToast = useCanToast();
  const getPass = useGetPass();
  const passDetails = usePassDetails();
  const column = useChatColumn();
  const source = useTimeSource();
  const now = useNow();
  const lookup = useChatLookup();

  const guest = useGuestStore();
  const viewerPass = useHasPass();
  const { recordSent, setLastRoom } = guest;
  // «Немає з’єднання» — стан мережі пристрою (тестова панель імітує його для всього сайту, не лише чату).
  const offline = useTestControls((s) => s.offlineSimulated);
  const slowForced = useTestControls((s) => s.slowForcedSec);
  const replyTo = useChatUi((s) => s.replyTo);
  const setReplyTo = useChatUi((s) => s.setReplyTo);

  const [roomKey, setRoomKey] = useState<RoomKey>(country && !startInWorld ? 'country' : 'world');
  const activeKey: RoomKey = roomKey === 'country' && !country ? 'world' : roomKey;
  const roomId: RoomId = activeKey === 'country' && country ? `country:${country.iso}` : 'world';
  const roomLabel = activeKey === 'country' && country ? t('roomCountryPicker', { country: country.name }) : t('roomWorld');

  useEffect(() => setLastRoom(roomId), [roomId, setLastRoom]);
  const available = useChatConnection(roomId) !== 'unavailable';
  // Чат повернувся: лічильник «нових» у згорнутому/схованому чаті рахуємо відтоді (рішення 2026-10-28).
  const wasAvailable = useRef(available);
  useEffect(() => {
    if (available && !wasAvailable.current && useChatUi.getState().hiddenAt !== null) {
      useChatUi.getState().markHidden(source.now());
    }
    wasAvailable.current = available;
  }, [available, source]);
  // Стрічка кімнати — сервіс чату (перемикач «Порожня кімната «Країна»» враховує адаптер `sim`).
  const roomMessages = useRoomMessages(roomId);
  // Тихий режим (пас): без банальних привітань і лічильників однакових привітань.
  const quiet = useChatPref('quiet');
  const myNick = guest.nick;
  const messages = useMemo(
    () => (quiet ? roomMessages.filter((m) => !isQuietHidden(m, myNick)) : roomMessages),
    [quiet, roomMessages, myNick],
  );
  const quietHidden = useMemo(() => (quiet ? quietHiddenCount(roomMessages, myNick) : 0), [quiet, roomMessages, myNick]);

  const draft = useChatUi((s) => s.draft);
  const setDraft = useChatUi((s) => s.setDraft);
  const [error, setError] = useState<ComposerError>(null);
  const [reported, setReported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!reported) return;
    const id = setTimeout(() => setReported(false), 4_000);
    return () => clearTimeout(id);
  }, [reported]);

  const slowTotal = useSlowModeSeconds(roomId, now);
  // Увімкнули повільний режим перемикачем — у кімнаті з’являється системне повідомлення, як на початку вікна сценарію.
  useEffect(() => {
    if (!slowForced) return;
    chatDev.forcedSlowNotice(roomId, source.now());
  }, [slowForced, roomId, source]);
  const slowRemaining = slowRemainingSec(guest.chat.sentAt, now, slowTotal);

  const focusField = useCallback(() => {
    // Після закриття вікна фокус повертається на тригер; поле беремо наступним кадром.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  /**
   * Відправлення; `override` — свіжі нік і прапор одразу після O-NICK (стан гостя ще не оновився). Поле перевіряє текст
   * саме (та сама `validateSend`, що в сервісі) — відповідь «нік потрібен» відкриває O-NICK без очікування сервера;
   * сервіс перевіряє ще раз (відмова — текст повертається в поле з тією ж причиною).
   */
  const trySend = useCallback(
    (text: string, override?: { nick: string; flagCode: string }): 'sent' | 'nick' | 'error' => {
      const nowMs = source.now();
      const store = useGuestStore.getState();
      const reply = replyTo && replyTo.room === roomId ? replyTo : null;
      const ctx: SendContext = {
        now: nowMs,
        guestId: store.id,
        nick: override?.nick ?? store.nick,
        flagCode: override?.flagCode ?? store.flagCode ?? store.detectedFlag,
        hasPass: hasPassNow(),
        canWrite: () => true,
        slowSeconds: chatActions.slowSeconds(roomId, nowMs),
        sentAt: store.chat.sentAt,
        available: chatActions.connection(roomId) !== 'unavailable' && !useTestControls.getState().offlineSimulated,
        ...(reply ? { replyTo: { id: reply.id, nick: reply.nick, excerpt: reply.excerpt } } : {}),
      };
      seq.current += 1;
      const req = { clientId: `${store.id}:${nowMs}:${seq.current}`, room: roomId, text };
      const showError = (error: SendError | string | undefined) => {
        if (error === 'link-forbidden') setError('link');
        else if (error === 'too-long') setError('too-long');
        else setError(null);
      };
      const bad = validateSend(req, ctx);
      if (bad) {
        showError(bad.error);
        return bad.error === 'nick-required' ? 'nick' : 'error';
      }
      // У `sim` повідомлення з’являється в стрічці ще до повернення з виклику (як раніше — одразу).
      void chatActions.send({ ...req, ...(reply ? { replyToId: reply.id } : {}) }).then((res) => {
        if (res.ok) return;
        setDraft(text);
        showError(res.error.reason);
      });
      recordSent(nowMs);
      setDraft('');
      setError(null);
      setReplyTo(null);
      return 'sent';
    },
    [source, roomId, replyTo, recordSent, setReplyTo, setDraft, setError],
  );

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
            onDone={({ nick, flagCode }) => {
              // Нік і прапор — профіль (шов, залишки E5); у `sim` запис синхронний — відправлення нижче бачить нік.
              void profileActions.update({ nick, ...(flagCode ? { flagCode } : {}) });
              overlay.close(NICK_WINDOW_ID);
              if (pendingText) trySend(pendingText, { nick, flagCode });
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

  const onReact = useCallback((m: ChatMessage, reaction: ReactionId, on: boolean) => void chatActions.react(m.room, m.id, reaction, on), []);
  const onReply = useCallback(
    (m: ChatMessage) => {
      if (!m.author) return;
      setReplyTo({ id: m.id, room: m.room, nick: m.author.nick, excerpt: excerptOf(m.text ?? '') });
      overlay.close(AUTHOR_WINDOW_ID);
      focusField();
    },
    [setReplyTo, overlay, focusField],
  );
  // Своє повідомлення: видалити назавжди (у стрічці лишається рядок «Твоє повідомлення видалено»), фокус — у поле.
  const onDelete = useCallback(
    (m: ChatMessage) => {
      void chatActions.remove(m.room, m.id);
      announce(t('deletedOwn'));
      focusField();
    },
    [announce, t, focusField],
  );
  const onReport = useCallback(
    (m?: ChatMessage) => {
      if (m) void chatActions.report(m.room, m.id);
      setReported(true);
      announce(t('reported'));
    },
    [announce, t],
  );

  const onMention = useCallback(
    (m: ChatMessage) => {
      const nick = m.author?.nick;
      if (!nick) return;
      setDraft((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${nick} `);
      overlay.close(AUTHOR_WINDOW_ID);
      focusField();
    },
    [overlay, focusField, setDraft],
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
              if (m) void chatActions.report(m.room, m.id);
              setReported(true);
            }}
            onEditProfile={author.isMine ? () => openNick(null) : undefined}
            onGetPass={() => getPass()}
            onPassInfo={passDetails}
          />
        ),
      });
    },
    [overlay, t, clock, lookup, openNick, getPass, passDetails],
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

  const multi = !!countries && countries.length > 1 && !!country;
  const options: SegmentOption[] = [
    { value: 'world', label: t('roomWorld') },
    ...(country
      ? [
          {
            value: 'country',
            label: country.iso.toUpperCase(),
            flag: country.iso,
            ariaLabel: t('roomCountryAria', { country: country.name }),
            ...(multi
              ? {
                  menu: {
                    selected: country.iso,
                    items: countries!.map((c) => ({ value: c.iso, label: c.name, flag: c.iso })),
                    onSelect: (iso: string) => {
                      onCountryChange?.(iso);
                      setRoomKey('country');
                    },
                  },
                }
              : {}),
          } satisfies SegmentOption,
        ]
      : []),
  ];
  const switcher =
    options.length > 1 ? (
      <SegmentedControl
        label={t('roomsLabel')}
        value={activeKey}
        onValueChange={(v) => setRoomKey(v as RoomKey)}
        options={options}
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
      ? {
          flagCode: country.iso,
          sub: (
            <>
              {t('emptyCountryRoom', { country: country.name })}
              {ownFlag ? (
                <>
                  {' '}
                  {t('emptyCountryFlag')}{' '}
                  <Flag code={ownFlag} size="xs" name={getData().countries.find((c) => c.flagCode === ownFlag)?.name.uk} className="inline-block align-text-bottom" />
                </>
              ) : null}
            </>
          ),
        }
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
