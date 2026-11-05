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
import { EmojiText } from '@/components/primitives/Emoji';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { AuthorPanel } from '@/components/live/AuthorPanel';
import { passGateSpec } from '@/components/offers/OfferWindows';
import { GATE_KEYS, type PassGateFeature } from '@/components/windows/PassGate';
import { isQuietHidden, quietHiddenCount } from '@/lib/chat/quiet';
import { useChatPref } from '@/stores/chatPrefs';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { SegmentedControl, type SegmentOption } from '@/components/primitives/SegmentedControl';
import { emojiSymbol } from '@/components/live/SeatPill';
import { momentMessages } from '@/lib/chat-sim/simulator';
import { chatMoments } from '@/lib/chat-sim/useChatSimulator';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { useChatColumn, useOverlay } from '@/components/shell/OverlayManager';
import { guestGreetingMessages } from '@/components/firstrow/controller';
import { STAMP_DELAY } from '@/lib/engine/config';
import { pickSeatRoomEvent } from '@/lib/firstrow/rooms';
import { zoneRowLabel, zoneRows } from '@/lib/firstrow/zone';
import { MyEmotionPill, type SavedEmotion } from '@/components/windows/Emoji';
import { Nick } from '@/components/windows/Nick';
import { useGetPass, usePassDetails } from '@/components/pass/PassWindow';
import { authorHasPass, buildAuthorPath, buildOwnPath } from '@/lib/chat-sim/authorPath';
import { slowSecondsAt } from '@/lib/chat-sim/simulator';
import { sendMessage, slowRemainingSec, type SendContext } from '@/lib/chat-sim/send';
import { useChatFeed, useChatMessages } from '@/lib/chat-sim/store';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { getData } from '@/lib/data/load';
import type { Author, ChatMessage, ReactionId, RoomId } from '@/lib/data/types';
import { detectFlag } from '@/lib/geo/detectFlag';
import { Flag } from '@/components/primitives/Flag';
import { useClock, useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { excerptOf } from '@/lib/chat-sim/send';
import { useChatUi } from '@/stores/chat';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { Chat } from './Chat';
import { ChatSettings } from './ChatSettings';
import { Composer, type ComposerError } from './Composer';
import { useChatLookup } from './useChatLookup';

export const NICK_WINDOW_ID = 'O-NICK';
export const AUTHOR_WINDOW_ID = 'O-AUTHOR';

type RoomKey = 'world' | 'country' | 'firstrow';

export interface ChatPanelProps {
  /** Кімната «Країна»: країна сторінки; на головній — країна ефіру, що йде зараз (без країни чипа немає). */
  country?: { iso: string; name: string };
  /** Лише кімната перегляду з вікнами кількох країн: список країн (чип «Країна» відкриває його). */
  countries?: { iso: string; name: string }[];
  onCountryChange?: (iso: string) => void;
  /** Головна: чат відкривається у «Світ», хоча кімната країни є. */
  startInWorld?: boolean;
  /** Не використовується: кімната «Перший ряд» визначається місцем гостя й часом (`pickSeatRoomEvent`). */
  eventId?: string | null;
  /** Місто події для підписів «Перший ряд · Лондон». */
  cityName?: string;
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
  const getPass = useGetPass();
  const passDetails = usePassDetails();
  const column = useChatColumn();
  const source = useTimeSource();
  const now = useNow();
  const lookup = useChatLookup();

  const guest = useGuestStore();
  const { setNick, setDetectedFlag, recordSent, setLastRoom } = guest;
  const available = useTestControls((s) => s.chatAvailable);
  const offline = useTestControls((s) => s.offlineSimulated);
  const slowForced = useTestControls((s) => s.slowForcedSec);
  const emptyCountry = useTestControls((s) => s.emptyCountry);
  // Чат повернувся: лічильник «нових» у згорнутому/схованому чаті рахуємо відтоді (рішення 2026-10-28).
  const wasAvailable = useRef(available);
  useEffect(() => {
    if (available && !wasAvailable.current && useChatUi.getState().hiddenAt !== null) {
      useChatUi.getState().markHidden(source.now());
    }
    wasAvailable.current = available;
  }, [available, source]);
  const replyTo = useChatUi((s) => s.replyTo);
  const setReplyTo = useChatUi((s) => s.setReplyTo);

  // Кімната «Перший ряд» — події, на яку є місце й кімната відкрита зараз (на будь-якій сторінці з чатом).
  const seatFirstRow = guest.firstRow;
  const seatEvent = useMemo(() => pickSeatRoomEvent(zoneRows(getData()), seatFirstRow, now), [seatFirstRow, now]);
  const eventId = seatEvent?.id ?? null;
  const cityName = seatEvent ? zoneRowLabel(getData(), seatEvent) : undefined;
  const participant = !!seatEvent;
  const [roomKey, setRoomKey] = useState<RoomKey>(country && !startInWorld ? 'country' : 'world');
  const activeKey: RoomKey =
    (roomKey === 'firstrow' && !participant) || (roomKey === 'country' && !country)
      ? country && !startInWorld
        ? 'country'
        : 'world'
      : roomKey;
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

  const rawMessages = useChatMessages(roomId);
  const ownSeat = eventId ? guest.firstRow[eventId]?.seat : undefined;
  // Привітання власного місця гості дає `guestGreetingMessages` («це ти»); сид того самого місця не дублюємо.
  const roomMessages = useMemo(() => {
    // Перемикач «Порожня кімната «Країна»» (машина часу): лишаються тільки свої повідомлення.
    if (emptyCountry && roomId.startsWith('country:')) return rawMessages.filter((m) => m.author?.isMine);
    return ownSeat === undefined
      ? rawMessages
      : rawMessages.filter((m) => !(m.kind === 'greeting' && m.greeting && !m.greeting.mine && m.greeting.seat === ownSeat && m.greeting.eventId === eventId));
  }, [rawMessages, ownSeat, eventId, emptyCountry, roomId]);
  // Тихий режим (пас): без банальних привітань і лічильників однакових привітань.
  const quiet = useChatPref('quiet');
  const myNick = guest.nick;
  const messages = useMemo(
    () => (quiet ? roomMessages.filter((m) => !isQuietHidden(m, myNick)) : roomMessages),
    [quiet, roomMessages, myNick],
  );
  const quietHidden = useMemo(() => (quiet ? quietHiddenCount(roomMessages, myNick) : 0), [quiet, roomMessages, myNick]);
  const append = useChatFeed((s) => s.append);
  const react = useChatFeed((s) => s.react);

  // Кімната «Перший ряд» опівночі: привітання всіх власників місць (симулятор світу кімнату не слухає).
  const mirroredDone = useRef(0);
  const mirrored = useMemo(() => {
    if (!participant || !eventId) return [];
    const ev = getData().eventsById.get(eventId);
    const moment =
      chatMoments().find((m) => (m.firstRowEventId ?? m.eventId) === eventId) ??
      (ev
        ? {
            t0: ev.midnightMs,
            eventId,
            cityId: ev.cityId,
            countries: [{ iso: ev.countryIso, gender: getData().countriesByIso.get(ev.countryIso)?.gender ?? null }],
            eventIds: [eventId],
          }
        : undefined);
    return moment ? momentMessages(CHAT_SCRIPT, moment, `firstrow:${eventId}`).filter((m) => m.kind === 'greeting') : [];
  }, [participant, eventId]);
  useEffect(() => {
    mirroredDone.current = 0;
  }, [mirrored]);
  useEffect(() => {
    if (!(now > 0) || mirroredDone.current >= mirrored.length) return;
    const due = mirrored.filter((m) => m.createdAt <= now);
    if (due.length > mirroredDone.current) {
      append(due);
      mirroredDone.current = due.length;
    }
  }, [mirrored, now, append]);

  // Власне привітання на «+15 с» своєї півночі — і коли сторінка показує інший ефір.
  const greetAt = seatEvent ? seatEvent.midnightMs + STAMP_DELAY : 0;
  const ownGreetDue = !!seatEvent && now >= greetAt;
  useEffect(() => {
    if (ownGreetDue && seatEvent) append(guestGreetingMessages(seatEvent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownGreetDue, eventId, ownSeat]);

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

  const slowAt = useCallback(
    (at: number) => slowForced || slowSecondsAt(CHAT_SCRIPT, roomId, at),
    [slowForced, roomId],
  );
  const slowTotal = slowAt(now);
  // Увімкнули повільний режим перемикачем — у кімнаті з’являється системне повідомлення, як на початку вікна сценарію.
  useEffect(() => {
    if (!slowForced) return;
    const at = source.now();
    append([
      { id: `slow-forced:${roomId}:${at}`, room: roomId, kind: 'system', createdAt: at, system: { kind: 'slow-mode', seconds: slowForced }, moderation: 'ok' },
    ]);
  }, [slowForced, roomId, source, append]);
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
        slowSeconds: slowAt(nowMs),
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
    [source, roomId, slowAt, participant, emojiId, replyTo, append, recordSent, setReplyTo, setDraft, setError],
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
              setNick(nick, flagCode);
              overlay.close(NICK_WINDOW_ID);
              if (pendingText) trySend(pendingText, { nick, flagCode });
            }}
          />
        ),
      });
    },
    [overlay, t, flagOptions, takenNicks, setNick, setDetectedFlag, trySend, focusField, openAuthWindow, getPass],
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
  // Своє повідомлення: видалити назавжди (у стрічці лишається рядок «Твоє повідомлення видалено»), фокус — у поле.
  const remove = useChatFeed((s) => s.remove);
  const onDelete = useCallback(
    (m: ChatMessage) => {
      remove(m.room, m.id);
      announce(t('deletedOwn'));
      focusField();
    },
    [remove, announce, t, focusField],
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
      const guest = useGuestStore.getState();
      const path = author.isMine
        ? buildOwnPath(guest.stamps, guest.schedule, getData(), clock.getSnapshot())
        : buildAuthorPath(author, CHAT_SCRIPT, getData());
      const viewerHasPass = useGuestStore.getState().hasPass;
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
            routeHidden={!author.isMine && !!CHAT_SCRIPT.authors.find((x) => x.id === author.id)?.pathHidden}
            path={path}
            viewerHasPass={viewerHasPass}
            onReport={onReport}
            onEditProfile={author.isMine ? () => openNick(null) : undefined}
            onGetPass={() => getPass()}
            onPassInfo={passDetails}
          />
        ),
      });
    },
    [overlay, t, clock, lookup, onReport, openNick, getPass, passDetails],
  );


  const openPassGate = useCallback(
    (feature: PassGateFeature) =>
      overlay.open(
        passGateSpec({ now: () => clock.getSnapshot() }, { feature, trigger: '', title: tPass(GATE_KEYS[feature].title) }),
      ),
    [overlay, clock, tPass],
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
    ...(participant ? [{ value: 'firstrow', label: t('roomFirstRowShort'), ariaLabel: t('roomFirstRowAria'), dot: true }] : []),
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

  const [saved, setSaved] = useState<SavedEmotion | null>(null);
  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(null), 10_000);
    return () => clearTimeout(id);
  }, [saved]);

  const banner = offline ? (
    <StatusMessage kind="offline">{t('offline')}</StatusMessage>
  ) : reported ? (
    <StatusMessage kind="success">{t('reportedVisible')}</StatusMessage>
  ) : activeKey === 'firstrow' && eventId ? (
    <>
      {saved ? (
        <p
          role="status"
          data-row="emotion-saved"
          className="flex items-start gap-2 border-b border-border bg-highlight-tint px-3.5 py-2 text-caption text-text"
        >
          <Icon name="check" size={16} className="mt-0.5 shrink-0 text-highlight" />
          <span>
            <EmojiText text={t('emotionSaved', { emoji: emojiSymbol(saved.emojiId) })} />
            {saved.greetingChanged ? ` ${t('emotionSavedGreeting')}` : ''}
          </span>
        </p>
      ) : null}
      <div
        className={cn('flex shrink-0 items-center gap-2 border-b border-border pe-1 ps-3.5', column ? 'h-10' : 'h-9')}
        data-row="room-note"
      >
        <span className="min-w-0 flex-1 truncate text-caption text-text-muted">
          {column ? t('emotionRoomRowShort') : t('emotionRoomRow', { city: cityName ?? '' })}
        </span>
        <MyEmotionPill eventId={eventId} onSaved={setSaved} />
      </div>
    </>
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
                  <Flag round code={ownFlag} size="xs" name={getData().countries.find((c) => c.flagCode === ownFlag)?.name.uk} className="inline-block align-text-bottom" />
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
          hasPass={guest.hasPass}
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
      messageActions={{ menuAlways: !column, onReact, onReply, onMention, onReport, onDelete, onTranslateLocked: guest.hasPass ? undefined : () => openPassGate('translate') }}
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
