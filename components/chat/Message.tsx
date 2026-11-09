'use client';

/**
 * C10. Message — рядок чату. Варіанти за `ChatMessage.kind`:
 * - `regular`: прапор xs + нік (одна ціль дотику на висоту рядка, назва «Аміра, Канада») · час праворуч · текст 15/400;
 *   + позначка пасу (не клікабельна), «Перший ряд» з емоцією, «це ти», цитата відповіді;
 * - `system`: знак Time2Fest + текст («Франція, Німеччина й Італія зустріли Новий рік» — через `metPhrase`),
 *   «<ім’я> тепер у першому ряду · <місто>», лічильник «+1 240 людей привітали», повільний режим, голосування;
 * - `greeting`: картка з жовтою межею ліворуч, «Перший ряд», привітання від Time2Fest.
 * Позначки не клікабельні. Емодзі в доступних назвах — назвами з набору O-EMOJI. Назви країн — лише в називному.
 * Реакції під текстом і кнопка «⋯» (C12): при наведенні чи фокусі вона стає на місце часу (час ховається на місці);
 * на телефоні (`menuAlways`) завжди видно, час лівіше. Меню відкриває Chat (`onOpenMenu`); без `onOpenMenu` дій немає.
 * Клік по рядку (крім «⋯» і чипів) відкриває панель автора. Кнопка «⋯» і реакції потрапляють у Tab лише в повідомленні
 * з єдиним Tab-стопом (`tabStop`), решта — `tabindex=-1`.
 * `mention`: «@нік» у тексті виділено.
 * Компонент повертає `<li>`; обгортку `<ol>` дає Chat (або історія).
 */
import { useTranslations } from 'next-intl';
import { Emoji, EmojiText } from '@/components/primitives/Emoji';
import type { KeyboardEvent, ReactNode } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { emojiSymbol } from '@/components/live/SeatPill';
import { canonicalEmotion } from '@/lib/firstrow/emotions';
import type { Author, ChatMessage, Country, Gender } from '@/lib/data/types';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatClock } from '@/lib/i18n/time';
import { useTranslateMessage } from '@/lib/chat/translate';
import { useChatPref } from '@/stores/chatPrefs';
import { ReactionsRow, type MessageActionHandlers } from './MessageActions';

export interface MessageLookup {
  /** Назва країни за кодом прапора («Австралія»). */
  countryName?: (flagCode: string) => string | undefined;
  /** Країна за ISO — для системного «<країна> зустріла Новий рік». */
  country?: (iso: string) => Pick<Country, 'name' | 'gender'> | undefined;
  /** Назва міста за `cityId` («Лондон»). */
  cityName?: (cityId: string) => string | undefined;
  /** Назва «Першого ряду» поясу за id події ряду («UTC+0 · Лондон, Лісабон»). */
  firstRowLabel?: (eventId: string) => string | undefined;
}

export interface MessageProps extends Pick<MessageActionHandlers, 'onReact'> {
  message: ChatMessage;
  /** Кнопка «⋯» відкриває меню повідомлення (його малює Chat у своєму шарі); без значення дій немає. */
  onOpenMenu?: (message: ChatMessage, trigger: HTMLElement) => void;
  /** Своє повідомлення: замість «⋯» — червоний «×», клік видаляє одразу, без підтвердження (рішення власника 2026-10-29). */
  onDelete?: (message: ChatMessage) => void;
  /** Повідомлення, на яке відповідали, видалено — у цитаті «Повідомлення видалено». */
  quoteDeleted?: boolean;
  /** Меню цього повідомлення відкрито: рядок лишається підсвіченим, «⋯» натиснуто. */
  menuOpen?: boolean;
  /** Телефон: «⋯» завжди видно в куті, час лівіше нього. */
  menuAlways?: boolean;
  lookup?: MessageLookup;
  /** Нік — єдиний Tab-стоп чату (рухомий tabindex): `true` лише для одного повідомлення. */
  tabStop?: boolean;
  /** Відкрити O-AUTHOR (дотик, Enter). */
  onAuthorOpen?: (author: Author) => void;
  onAuthorFocus?: () => void;
  onAuthorKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
}

function Mark({ label = true }: { label?: boolean }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label ? 'Time2Fest' : undefined}
      aria-hidden={label ? undefined : true}
      className="t2f-sys-mark flex size-4 shrink-0 items-center justify-center bg-highlight text-on-highlight"
    >
      {/* Макет `Main`: чотирипроменева зірка 10 px на жовтому квадраті 16 px (радіус 4). */}
      <svg width="0.625rem" height="0.625rem" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" />
      </svg>
    </span>
  );
}

function PassMark({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="-ms-px flex size-4 shrink-0 items-center justify-center rounded-full bg-highlight text-on-highlight"
    >
      <Icon name="ticket" size={16} className="size-3" />
    </span>
  );
}

const ROW = 'flex h-4.5 items-center gap-1.5';

/** Прапор показуємо лише для відомого коду: гість без прапора — без значка (не порожнє коло). */
function hasFlag(code: string | undefined): code is string {
  return !!code && code.toUpperCase() !== 'UN';
}

/** «@Аміра» у тексті — виділено (mention); відомі емодзі — фірмові значки (символ лишається для копіювання). */
export function withMentions(text: string | undefined): ReactNode {
  if (!text) return text;
  const parts = text.split(/(@[\p{L}\d_-]+)/u);
  if (parts.length === 1) return <EmojiText text={text} />;
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} data-mention="" className="font-semibold text-highlight">
        {part}
      </span>
    ) : (
      <EmojiText key={i} text={part} />
    ),
  );
}

/**
 * Текст повідомлення. З «Перекладати повідомлення» (пас) чи після «Перекласти» в меню — переклад мовою сайту й
 * рядок «Перекладено з {мова} · Оригінал» («Оригінал» повертає текст автора для цього повідомлення).
 */
function MessageText({ message }: { message: ChatMessage }) {
  const t = useTranslations('chat.translate');
  const auto = useChatPref('translate');
  const tr = useTranslateMessage(message, auto);
  if (tr.lang && !tr.showing && tr.text !== undefined) {
    // Переклад був, людина повернула оригінал — дати змогу знову побачити переклад.
    return (
      <>
        <p className="t2f-msg-text text-chat text-text">{withMentions(message.text)}</p>
        <p className="t2f-msg-tr" data-row="original">
          <button type="button" onClick={tr.toggle} className="t2f-focus t2f-msg-tr-btn">
            {t('show')}
          </button>
        </p>
      </>
    );
  }
  if (!tr.showing || tr.text === undefined) return <p className="t2f-msg-text text-chat text-text">{withMentions(message.text)}</p>;
  return (
    <>
      <p className="t2f-msg-text text-chat text-text" lang="uk">
        {withMentions(tr.text)}
      </p>
      <p className="t2f-msg-tr" data-row="translated">
        <Icon name="translate" size={12} className="shrink-0" />
        <span>{t('from', { lang: t(`langs.${tr.lang ?? 'en'}`) })}</span>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={tr.toggle} className="t2f-focus t2f-msg-tr-btn">
          {t('original')}
        </button>
      </p>
    </>
  );
}

export function Message({
  message,
  lookup,
  tabStop = false,
  onOpenMenu,
  onDelete,
  quoteDeleted,
  menuOpen = false,
  menuAlways = false,
  onReact,
  onAuthorOpen,
  onAuthorFocus,
  onAuthorKeyDown,
  className,
}: MessageProps) {
  const t = useTranslations('chat');
  const met = useTranslations('met');
  const names = useTranslations('windows.emoji.names');
  const badges = useTranslations('primitives.badge');
  const time = formatClock(message.createdAt);

  // Видалене автором: тонкий рядок замість повідомлення — бачать усі (своє — «Твоє повідомлення видалено»).
  if (message.deleted) {
    const own = !!message.author?.isMine;
    return (
      <li data-kind="deleted" data-own={own ? 'true' : undefined} data-msg-id={message.id} className={cn('t2f-msg-deleted', className)}>
        <svg width="0.875rem" height="0.875rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h16M9 6V3.5h6V6M6 6l1 14h10l1-14" />
        </svg>
        {own || !message.author ? (
          <span>{own ? t('deletedOwn') : t('deletedQuote')}</span>
        ) : (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Flag round code={message.author.flagCode} size="xs" decorative />
            <span className="truncate">{t('deletedOther', { nick: message.author.nick })}</span>
          </span>
        )}
        <time dateTime={new Date(message.createdAt).toISOString()} className="ms-auto">
          {time}
        </time>
      </li>
    );
  }

  // Приховане модерацією бачить лише автор.
  if (message.moderation === 'hidden') {
    if (!message.author?.isMine) return null;
    return (
      <li
        data-kind="moderated"
        data-msg-id={message.id}
        className={cn('px-2 py-1.5 text-caption italic text-text-muted', className)}
      >
        {t('removed')}
      </li>
    );
  }

  const emotionName = (id: string) => names(canonicalEmotion(id));

  if (message.kind === 'system') {
    const s = message.system;
    let body: ReactNode = message.text ?? null;
    let counter = false;
    if (s?.kind === 'country-midnight') {
      const countries = s.countries.map((c) => {
        const found = lookup?.country?.(c.iso);
        return {
          name: { uk: found?.name.uk ?? c.iso },
          gender: (found?.gender ?? c.gender) as Gender,
        };
      });
      if (countries.length > 0) {
        const p = metPhrase(countries);
        body =
          p.kind === 'single'
            ? met('single', p.params)
            : p.kind === 'multi'
              ? met('multi', { names: joinNamesUk(p.params.names) })
              : met('fallback', p.params);
      }
    } else if (s?.kind === 'firstrow-joined') {
      const city = lookup?.firstRowLabel?.(s.eventId) || lookup?.cityName?.(s.cityId) || s.cityId;
      // Макет `Main`: «Олена і друзі 🇺🇦 тепер у першому ряду · UTC+0 · Лондон, Лісабон» — один рядок, без жирного, з трьома крапками.
      body = (
        <>
          {s.participantName}{' '}
          {hasFlag(s.flagCode) ? (
            <>
              <Flag
                code={s.flagCode}
                size="xs"
                name={lookup?.countryName?.(s.flagCode)}
                decorative={!lookup?.countryName?.(s.flagCode)}
                className="t2f-sys-flag"
              />{' '}
            </>
          ) : null}
          {t('systemFirstRowTail', { city })}
        </>
      );
    } else if (s?.kind === 'greetings-counter') {
      counter = true;
      body = (
        <>
          <span>{t('repeat', { count: new Intl.NumberFormat('uk').format(s.count) })}</span>
          <span aria-hidden="true" className="ms-1.5 inline-flex">
            {s.flagCodes.slice(0, 5).map((code, i) => (
              <Flag
                round
                key={code + i}
                code={code}
                size="xs"
                decorative
                className={i > 0 ? '-ms-1' : undefined}
              />
            ))}
          </span>
        </>
      );
    } else if (s?.kind === 'slow-mode') {
      body = t('systemSlowMode', { seconds: s.seconds });
    } else if (s?.kind === 'poll-open') {
      body = t('systemPoll');
    } else if (s?.kind === 'rating-leader') {
      // «Новий лідер рейтингу святкувань — Варшава · ★ 4,8 · Рейтинг ›» (рішення власника 2026-11-07).
      body = (
        <>
          {t('systemRatingLeader', { city: s.city, score: s.score.toFixed(1).replace('.', ',') })}{' '}
          <a href="/rating/" className="t2f-focus font-semibold underline underline-offset-2">
            {t('systemRatingLink')}
          </a>
        </>
      );
    }
    if (counter) {
      return (
        <li
          data-kind="system"
          data-system="greetings-counter"
          data-msg-id={message.id}
          className={cn(
            'flex items-center gap-1.5 px-2 py-1.5 text-label-badge-chat text-text-muted',
            className,
          )}
        >
          {body}
        </li>
      );
    }
    return (
      <li
        data-kind="system"
        data-system={s?.kind}
        data-msg-id={message.id}
        className={cn(
          't2f-sys mx-2 my-1.5 flex items-center gap-2 rounded-sm bg-highlight-tint px-2 py-1 text-highlight',
          className,
        )}
      >
        <Mark />
        <span className={cn('min-w-0', s?.kind === 'firstrow-joined' && 'truncate')}>{body}</span>
      </li>
    );
  }

  if (message.kind === 'greeting' && message.greeting) {
    const g = message.greeting;
    const city = lookup?.firstRowLabel?.(g.eventId) || lookup?.cityName?.(g.cityId) || g.cityId;
    const country = lookup?.countryName?.(g.flagCode);
    return (
      <li
        data-kind="greeting"
        data-msg-id={message.id}
        className={cn(
          'mx-2 my-1.5 flex flex-col gap-1 rounded-sm border-s-3 border-highlight bg-highlight-tint py-2 pe-2.5 ps-3',
          className,
        )}
      >
        <div className={ROW}>
          <Mark label={false} />
          <span className="text-label-badge-chat font-bold text-highlight">Time2Fest</span>
          <Badge variant="first-row" />
          {g.mine ? (
            <span className="text-label-badge-chat font-semibold text-highlight" data-mine="">
              {t('greetingMine')}
            </span>
          ) : null}
          <time
            dateTime={new Date(message.createdAt).toISOString()}
            className="ms-auto text-label-badge-chat text-text-muted"
          >
            {time}
          </time>
        </div>
        <p className="text-chat text-text">
          {t('greetingPrefix')} <strong className="font-bold">{g.participantName}</strong>{' '}
          {hasFlag(g.flagCode) ? (
            <>
              <Flag round code={g.flagCode} size="xs" name={country} decorative={!country} />{' '}
            </>
          ) : null}
          <Emoji char={emojiSymbol(g.emojiId)} label={t('emotionLabel', { emotion: emotionName(g.emojiId) })} />{' '}
          {t('greetingSuffix', { city, seat: g.seat })}
        </p>
        {g.text ? (
          <p className="text-chat text-text-secondary">
            <EmojiText text={t('greetingQuote', { text: g.text })} />
          </p>
        ) : null}
      </li>
    );
  }

  // regular
  const a = message.author;
  const country = a ? lookup?.countryName?.(a.flagCode) : undefined;
  const authorLabel = a ? (country ? t('authorLabel', { name: a.nick, country }) : a.nick) : '';
  const firstRow = a?.badges.includes('first-row') ?? false;
  const pass = a?.badges.includes('pass') || a?.badges.includes('vip');
  const del = a?.isMine ? onDelete : undefined;
  const more = del ? undefined : onOpenMenu;
  return (
    // Клік по рядку (крім ⋯ і чипів реакцій) відкриває панель автора — те саме, що клік по ніку (рішення власника 2026-10-27).
    // Enter на сфокусованому рядку — так само. Кнопка ⋯ відкриває меню дій окремо.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      data-kind="regular"
      data-own={a?.isMine ? 'true' : undefined}
      data-toast={message.toast ? 'true' : undefined}
      data-msg-id={message.id}
      data-actions-open={menuOpen ? 'true' : undefined}
      data-menu-always={menuAlways && (more || del) ? 'true' : undefined}
      tabIndex={a && onAuthorOpen ? -1 : undefined}
      onClick={(e) => {
        if (!a || !onAuthorOpen) return;
        const target = e.target as HTMLElement;
        // Портали (меню дій) спливають через React-дерево, але лежать поза рядком.
        if (
          !e.currentTarget.contains(target) ||
          target.closest('button, a, input, textarea, [role="menu"], [role="menuitem"]')
        )
          return;
        onAuthorOpen(a);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.target !== e.currentTarget || !a || !onAuthorOpen) return;
        e.preventDefault();
        onAuthorOpen(a);
      }}
      className={cn(
        't2f-msg t2f-focus relative flex flex-col gap-0.5 my-px px-2.5 py-2',
        a && onAuthorOpen && 'cursor-pointer',
        className,
      )}
    >
      <div className={cn(ROW, 't2f-msg-head')}>
        {a ? (
          <button
            type="button"
            data-chat-author=""
            aria-label={authorLabel}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => onAuthorOpen?.(a)}
            onFocus={onAuthorFocus}
            onKeyDown={onAuthorKeyDown}
            className="t2f-nick -mx-1 -my-3.5 inline-flex min-h-touch-min items-center px-1 text-text"
          >
            {/* Ціль 44 px невидима; наведення — підсвітка всього рядка повідомлення, фокус — рамка лише навколо
                прапора й імені (раніше підсвітка 44-піксельної цілі заходила на попереднє повідомлення). */}
            <span className="t2f-nick-label inline-flex items-center gap-1.5 rounded-sm">
              <Flag round code={a.flagCode} size="xs" decorative />
              <span className="t2f-nick-name">{a.nick}</span>
            </span>
          </button>
        ) : null}
        {pass ? <PassMark label={badges('vip')} /> : null}
        {firstRow ? (
          <>
            <Badge variant="first-row" />
            {a?.firstRowEmojiId ? (
              <Emoji
                char={emojiSymbol(a.firstRowEmojiId)}
                size={16}
                label={t('emotionLabel', { emotion: emotionName(a.firstRowEmojiId) })}
              />
            ) : null}
          </>
        ) : null}
        {message.toast ? (
          <span data-toast-badge="" className="t2f-toast-badge">
            {t('toastBadge')}
          </span>
        ) : null}
        {a?.isMine ? <Badge variant="you" /> : null}
        <time
          dateTime={new Date(message.createdAt).toISOString()}
          className="ms-auto text-text-muted"
        >
          {time}
        </time>
        {del ? (
          <button
            type="button"
            data-msg-delete=""
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('deleteOwn')}
            title={t('deleteOwn')}
            onClick={() => del(message)}
            className="t2f-msg-more t2f-msg-del"
          >
            <span aria-hidden="true">
              <Icon name="close" size={16} strokeWidth={2.25} />
            </span>
          </button>
        ) : more ? (
          <button
            type="button"
            data-msg-trigger=""
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('actionsLabel', { nick: a?.nick ?? '' })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => more(message, e.currentTarget)}
            className="t2f-msg-more"
          >
            <span aria-hidden="true">
              <Icon name="more" size={18} />
            </span>
          </button>
        ) : null}
      </div>
      {message.replyTo ? (
        <p className="t2f-quote" data-row="reply">
          <Icon name="reply" size={14} strokeWidth={2} className="shrink-0" />
          <span className="sr-only">{t('replyTo', { nick: message.replyTo.nick })}</span>
          <span aria-hidden="true" className="t2f-quote-nick">
            {message.replyTo.nick}
          </span>
          <span className="t2f-quote-text">{quoteDeleted ? t('deletedQuote') : message.replyTo.excerpt}</span>
        </p>
      ) : null}
      <MessageText message={message} />
      <ReactionsRow
        message={message}
        tabStop={tabStop}
        onReact={onOpenMenu ? onReact : undefined}
        className="pt-1"
      />
    </li>
  );
}
