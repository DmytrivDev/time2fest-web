'use client';

/**
 * C9 ChatPanel — повний чат на сторінці (US4, FR-050…056): склеює `Chat` (шапка, стрічка), `Composer`, вікна O-NICK,
 * O-AUTHOR, дії над повідомленням, «Моя емоція» і стан «сховано». Дані — імітатор на пристрої (`lib/chat-sim`):
 * потік `useChatFeed`, власні повідомлення додаються тут і лишаються видимими лише цьому пристрою.
 *
 * Кімнати: головна — «Світ» (+ «Перший ряд» учасникам події); сторінка країни — «Країна» (за замовчуванням), «Світ»
 * (+ «Перший ряд»). Перше власне повідомлення без ніка відкриває O-NICK; текст лишається в полі й надсилається після «Готово».
 * Недоступність (`useTestControls.chatAvailable`) замінює чат на «Чат тимчасово недоступний…», решта сайту працює.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthorPanel } from '@/components/live/AuthorPanel';
import { passInfoSpec } from '@/components/offers/OfferWindows';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { SegmentedControl, type SegmentOption } from '@/components/primitives/SegmentedControl';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { MyEmotionButton } from '@/components/windows/Emoji';
import { Nick } from '@/components/windows/Nick';
import { authorHasPass, buildAuthorPath } from '@/lib/chat-sim/authorPath';
import { slowSecondsAt } from '@/lib/chat-sim/simulator';
import { sendMessage, slowRemainingSec, type SendContext } from '@/lib/chat-sim/send';
import { useChatFeed, useChatMessages } from '@/lib/chat-sim/store';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ReactionId, RoomId } from '@/lib/data/types';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useClock, useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { excerptOf } from '@/lib/chat-sim/send';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { Chat } from './Chat';
import { Composer, type ComposerError } from './Composer';
import { useChatLookup } from './useChatLookup';

export const NICK_WINDOW_ID = 'O-NICK';
export const AUTHOR_WINDOW_ID = 'O-AUTHOR';
export const RULES_WINDOW_ID = 'O-CHAT-RULES';

type RoomKey = 'world' | 'country' | 'firstrow';

export interface ChatPanelProps {
  /** Сторінка країни: з’являється кімната «Країна». */
  country?: { iso: string; name: string };
  /** Подія сторінки: за нею — кімната «Перший ряд» (лише учасникам). */
  eventId?: string | null;
  /** Місто події для підписів «Перший ряд · Лондон». */
  cityName?: string;
  /** Сховати чат (кнопка в шапці); без значення — кнопки немає. */
  onHide?: () => void;
  /** «До подій» у стані «чат недоступний». */
  onToEvents?: () => void;
  className?: string;
}

export function ChatPanel({
  country,
  eventId,
  cityName,
  onHide,
  onToEvents,
  className,
}: ChatPanelProps) {
  const t = useTranslations('chat');
  const tPass = useTranslations('pass');
  const clock = useClock();
  const announce = useAnnounce();
  const overlay = useOverlay();
  const column = useChatColumn();
  const source = useTimeSource();
  const now = useNow();
  const lookup = useChatLookup();

  const guest = useGuestStore();
  const { setNick, setDetectedFlag, recordSent, setLastRoom } = guest;
  const available = useTestControls((s) => s.chatAvailable);
  const offline = useTestControls((s) => s.offlineSimulated);
  const replyTo = useChatUi((s) => s.replyTo);
  const setReplyTo = useChatUi((s) => s.setReplyTo);

  const participant = !!eventId && guest.firstRow[eventId]?.seat !== undefined;
  const [roomKey, setRoomKey] = useState<RoomKey>(country ? 'country' : 'world');
  const activeKey: RoomKey =
    roomKey === 'firstrow' && !participant ? (country ? 'country' : 'world') : roomKey;
  const roomId: RoomId =
    activeKey === 'firstrow' && eventId
      ? `firstrow:${eventId}`
      : activeKey === 'country' && country
        ? `country:${country.iso}`
        : 'world';
  const roomLabel =
    activeKey === 'firstrow'
      ? t('roomFirstRow')
      : activeKey === 'country' && country
        ? t('roomCountryPicker', { country: country.name })
        : t('roomWorld');

  useEffect(() => setLastRoom(roomId), [roomId, setLastRoom]);

  const messages = useChatMessages(roomId);
  const append = useChatFeed((s) => s.append);
  const react = useChatFeed((s) => s.react);

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

  const slowTotal = slowSecondsAt(CHAT_SCRIPT, roomId, now);
  const slowRemaining = slowRemainingSec(guest.chat.sentAt, now, slowTotal);
  const emojiId = eventId ? guest.firstRow[eventId]?.draft?.emojiId : undefined;

  const focusField = useCallback(() => {
    // Після закриття вікна фокус повертається на тригер; поле беремо наступним кадром.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  /** Відправлення; `override` — свіжі нік і прапор одразу після O-NICK (стан гостя ще не оновився). */
  const trySend = useCallback(
    (text: string, override?: { nick: string; flagCode: string }): 'sent' | 'nick' | 'error' => {
      const nowMs = source.now();
      const store = useGuestStore.getState();
      const ctx: SendContext = {
        now: nowMs,
        guestId: store.id,
        nick: override?.nick ?? store.nick,
        flagCode: override?.flagCode ?? store.flagCode ?? store.detectedFlag,
        hasPass: store.hasPass,
        canWrite: (r) => !r.startsWith('firstrow:') || participant,
        slowSeconds: slowSecondsAt(CHAT_SCRIPT, roomId, nowMs),
        sentAt: store.chat.sentAt,
        available:
          useTestControls.getState().chatAvailable && !useTestControls.getState().offlineSimulated,
        ...(emojiId ? { firstRowEmojiId: emojiId } : {}),
        ...(replyTo && replyTo.room === roomId
          ? { replyTo: { id: replyTo.id, nick: replyTo.nick, excerpt: replyTo.excerpt } }
          : {}),
      };
      seq.current += 1;
      const res = sendMessage(
        { clientId: `${store.id}:${nowMs}:${seq.current}`, room: roomId, text },
        ctx,
      );
      if (res.ok) {
        append([res.message]);
        recordSent(nowMs);
        setDraft('');
        setError(null);
        setReplyTo(null);
        return 'sent';
      }
      if (res.error === 'link-forbidden') setError('link');
      else if (res.error === 'too-long') setError('too-long');
      else setError(null);
      return res.error === 'nick-required' ? 'nick' : 'error';
    },
    [source, roomId, participant, emojiId, replyTo, append, recordSent, setReplyTo, setDraft],
  );

  const flagOptions = useMemo(
    () => getData().countries.map((c) => ({ code: c.flagCode, name: c.name.uk })),
    [],
  );
  const takenNicks = useMemo(() => CHAT_SCRIPT.authors.map((a) => a.nick), []);

  const openNick = useCallback(
    (pendingText: string | null) => {
      const store = useGuestStore.getState();
      const detected = store.detectedFlag ?? detectFlag();
      if (detected && detected !== store.detectedFlag) setDetectedFlag(detected);
      overlay.open({
        id: NICK_WINDOW_ID,
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
            onDone={({ nick, flagCode }) => {
              setNick(nick, flagCode);
              overlay.close(NICK_WINDOW_ID);
              if (pendingText) trySend(pendingText, { nick, flagCode });
            }}
          />
        ),
      });
    },
    [overlay, t, flagOptions, takenNicks, setNick, setDetectedFlag, trySend, focusField],
  );

  const submit = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      if (trySend(text) === 'nick') openNick(text);
    },
    [trySend, openNick],
  );

  const onReact = useCallback(
    (m: ChatMessage, reaction: ReactionId, on: boolean) => react(m.room, m.id, reaction, on),
    [react],
  );
  const onReply = useCallback(
    (m: ChatMessage) => {
      if (!m.author) return;
      setReplyTo({ id: m.id, room: m.room, nick: m.author.nick, excerpt: excerptOf(m.text ?? '') });
      overlay.close(AUTHOR_WINDOW_ID);
      focusField();
    },
    [setReplyTo, overlay, focusField],
  );
  const onReport = useCallback(() => {
    setReported(true);
    announce(t('reported'));
  }, [announce, t]);

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
      const path = buildAuthorPath(author, CHAT_SCRIPT, getData());
      const viewerHasPass = useGuestStore.getState().hasPass;
      overlay.open({
        id: AUTHOR_WINDOW_ID,
        kind: 'nonmodal',
        chrome: 'author',
        coral: !viewerHasPass,
        title: t('author.title'),
        content: (
          <AuthorPanel
            author={author}
            countryName={lookup.countryName?.(author.flagCode)}
            message={message}
            roomLabel={roomLabel}
            hasPass={hasPass}
            path={path}
            viewerHasPass={viewerHasPass}
            onReply={onReply}
            onReport={onReport}
            onPassInfo={() => {
              overlay.open(passInfoSpec({ now: () => clock.getSnapshot() }, tPass('infoTitle')));
              useGuestStore.getState().showOffer('pass-info', useGuestStore.getState().stamps.at(-1)?.eventId ?? '', clock.getSnapshot());
            }}
            onMention={(a) => {
              setDraft((v) => `${v}${v && !v.endsWith(' ') ? ' ' : ''}@${a.nick} `);
              overlay.close(AUTHOR_WINDOW_ID);
              focusField();
            }}
          />
        ),
      });
    },
    [overlay, t, tPass, clock, lookup, roomLabel, onReply, onReport, focusField, setDraft],
  );

  const openRules = useCallback(
    () =>
      overlay.open({
        id: RULES_WINDOW_ID,
        kind: 'nonmodal',
        title: t('rules'),
        content: (
          <ul className="flex list-disc flex-col gap-2 ps-5 text-body text-text-secondary">
            {(['kind', 'length', 'links', 'slow'] as const).map((k) => (
              <li key={k}>{t(`rulesList.${k}`)}</li>
            ))}
          </ul>
        ),
      }),
    [overlay, t],
  );

  const options: SegmentOption[] = [
    ...(country
      ? [
          { value: 'country', label: t('roomCountry') },
          { value: 'world', label: t('roomWorld') },
        ]
      : [{ value: 'world', label: t('roomWorld') }]),
    ...(participant ? [{ value: 'firstrow', label: t('roomFirstRow'), dot: true }] : []),
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
  ) : activeKey === 'firstrow' ? (
    <p
      className="border-b border-border px-3.5 py-2 text-caption text-text-secondary"
      data-row="room-note"
    >
      {t('firstRowRoomNote', { city: cityName ?? '' })}
    </p>
  ) : undefined;

  return (
    <Chat
      room={{ id: roomId, label: roomLabel }}
      messages={messages}
      state={available ? 'live' : 'unavailable'}
      lookup={lookup}
      roomSwitcher={switcher}
      headerExtra={
        activeKey === 'firstrow' && eventId ? (
          <MyEmotionButton
            eventId={eventId}
            seatLabel={cityName ? t('firstRowSeatLabel', { city: cityName }) : undefined}
          />
        ) : undefined
      }
      banner={banner}
      onAuthorOpen={openAuthor}
      onHide={onHide}
      onToEvents={onToEvents}
      onRules={openRules}
      announceNew
      messageActions={{ menuAlways: !column, onReact, onReply, onMention, onReport }}
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
        />
      }
      className={className}
    />
  );
}
