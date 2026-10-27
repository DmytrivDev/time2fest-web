'use client';

/**
 * C10. Message — рядок чату. Варіанти за `ChatMessage.kind`:
 * - `regular`: прапор xs + нік (одна ціль дотику на висоту рядка, назва «Аміра, Канада») · час праворуч · текст 15/400;
 *   + позначка пасу (не клікабельна), «Перший ряд» з емоцією, «це ти», цитата відповіді;
 * - `system`: знак Time2Fest + текст («Франція, Німеччина й Італія зустріли Новий рік» — через `metPhrase`),
 *   «<ім’я> тепер у першому ряду · <місто>», лічильник «+1 240 людей привітали», повільний режим, голосування;
 * - `greeting`: картка з жовтою межею ліворуч, «Перший ряд», привітання від Time2Fest.
 * Позначки не клікабельні. Емодзі в доступних назвах — назвами з набору O-EMOJI. Назви країн — лише в називному.
 * Реакції під текстом і дії над повідомленням (C12): `actions="menu"` — DropdownMenu (десктоп), `actions="sheet"` —
 * кнопка відкриває аркуш через `onOpenActions` (телефон); без `actions` кнопки дій немає. Кнопки дій і реакції
 * потрапляють у Tab лише в повідомленні з єдиним Tab-стопом (`tabStop`), решта — `tabindex=-1`.
 * `mention`: «@нік» у тексті виділено.
 * Компонент повертає `<li>`; обгортку `<ol>` дає Chat (або історія).
 */
import { useTranslations } from 'next-intl';
import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { emojiSymbol } from '@/components/live/SeatPill';
import { IconButton } from '@/components/primitives/IconButton';
import type { Author, ChatMessage, Country, Gender } from '@/lib/data/types';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatClock } from '@/lib/i18n/time';
import { MessageActionsMenu, ReactionsRow, type MessageActionHandlers } from './MessageActions';

export interface MessageLookup {
  /** Назва країни за кодом прапора («Австралія»). */
  countryName?: (flagCode: string) => string | undefined;
  /** Країна за ISO — для системного «<країна> зустріла Новий рік». */
  country?: (iso: string) => Pick<Country, 'name' | 'gender'> | undefined;
  /** Назва міста за `cityId` («Лондон»). */
  cityName?: (cityId: string) => string | undefined;
}

export interface MessageProps extends MessageActionHandlers {
  message: ChatMessage;
  /** Дії над повідомленням: меню (десктоп), кнопка → аркуш (телефон); без значення дій немає. */
  actions?: 'menu' | 'sheet';
  onOpenActions?: (message: ChatMessage) => void;
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
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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

/** «@Аміра» у тексті — виділено (mention). */
function withMentions(text: string | undefined): ReactNode {
  if (!text) return text;
  const parts = text.split(/(@[\p{L}\d_-]+)/u);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} data-mention="" className="font-semibold text-highlight">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function Message({
  message,
  lookup,
  tabStop = false,
  actions,
  onOpenActions,
  onReact,
  onReply,
  onReport,
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
  const [menuOpen, setMenuOpen] = useState(false);

  // Приховане модерацією бачить лише автор.
  if (message.moderation === 'hidden') {
    if (!message.author?.isMine) return null;
    return (
      <li data-kind="moderated" data-msg-id={message.id} className={cn('px-2 py-1.5 text-caption italic text-text-muted', className)}>
        {t('removed')}
      </li>
    );
  }

  const emotionName = (id: string) => (names.has(id as never) ? names(id as never) : names('sparkles'));

  if (message.kind === 'system') {
    const s = message.system;
    let body: ReactNode = message.text ?? null;
    let counter = false;
    if (s?.kind === 'country-midnight') {
      const countries = s.countries.map((c) => {
        const found = lookup?.country?.(c.iso);
        return { name: { uk: found?.name.uk ?? c.iso }, gender: (found?.gender ?? c.gender) as Gender };
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
      const city = lookup?.cityName?.(s.cityId) ?? s.cityId;
      // Макет `Main`: «Олена і друзі 🇺🇦 тепер у першому ряду · Лондон» — один рядок, без жирного, з трьома крапками.
      body = (
        <>
          {s.participantName}{' '}
          <Flag code={s.flagCode} size="xs" name={lookup?.countryName?.(s.flagCode)} decorative={!lookup?.countryName?.(s.flagCode)} className="t2f-sys-flag" />{' '}
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
              <Flag key={code + i} code={code} size="xs" decorative className={i > 0 ? '-ms-1' : undefined} />
            ))}
          </span>
        </>
      );
    } else if (s?.kind === 'slow-mode') {
      body = t('systemSlowMode', { seconds: s.seconds });
    } else if (s?.kind === 'poll-open') {
      body = t('systemPoll');
    }
    if (counter) {
      return (
        <li
          data-kind="system"
          data-system="greetings-counter"
          data-msg-id={message.id}
          className={cn('flex items-center gap-1.5 px-2 py-1.5 text-label-badge-chat text-text-muted', className)}
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
        className={cn('t2f-sys mx-2 my-1.5 flex items-center gap-2 rounded-sm bg-highlight-tint px-2 py-1 text-highlight', className)}
      >
        <Mark />
        <span className={cn('min-w-0', s?.kind === 'firstrow-joined' && 'truncate')}>{body}</span>
      </li>
    );
  }

  if (message.kind === 'greeting' && message.greeting) {
    const g = message.greeting;
    const city = lookup?.cityName?.(g.cityId) ?? g.cityId;
    const country = lookup?.countryName?.(g.flagCode);
    return (
      <li
        data-kind="greeting"
        data-msg-id={message.id}
        className={cn('mx-2 my-1.5 flex flex-col gap-1 rounded-sm border-s-3 border-highlight bg-highlight-tint py-2 pe-2.5 ps-3', className)}
      >
        <div className={ROW}>
          <Mark label={false} />
          <span className="text-label-badge-chat font-bold text-highlight">Time2Fest</span>
          <Badge variant="first-row" />
          <time dateTime={new Date(message.createdAt).toISOString()} className="ms-auto text-label-badge-chat text-text-muted">
            {time}
          </time>
        </div>
        <p className="text-chat text-text">
          {t('greetingPrefix')} <strong className="font-bold">{g.participantName}</strong>{' '}
          <Flag code={g.flagCode} size="xs" name={country} decorative={!country} />{' '}
          <span role="img" aria-label={t('emotionLabel', { emotion: emotionName(g.emojiId) })}>
            {emojiSymbol(g.emojiId)}
          </span>{' '}
          {t('greetingSuffix', { city, seat: g.seat })}
        </p>
        {g.text ? <p className="text-chat text-text-secondary">{t('greetingQuote', { text: g.text })}</p> : null}
      </li>
    );
  }

  // regular
  const a = message.author;
  const country = a ? lookup?.countryName?.(a.flagCode) : undefined;
  const authorLabel = a ? (country ? t('authorLabel', { name: a.nick, country }) : a.nick) : '';
  const firstRow = a?.badges.includes('first-row') ?? false;
  const pass = a?.badges.includes('pass') || a?.badges.includes('vip');
  return (
    // Клік по рядку (крім ⋯ і чипів реакцій) відкриває панель автора — те саме, що клік по ніку (рішення власника 2026-10-27).
    // Enter на сфокусованому рядку — так само. Кнопка ⋯ відкриває меню дій окремо.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <li
      data-kind="regular"
      data-own={a?.isMine ? 'true' : undefined}
      data-msg-id={message.id}
      data-actions-open={menuOpen ? 'true' : undefined}
      tabIndex={a && onAuthorOpen ? -1 : undefined}
      onClick={(e) => {
        if (!a || !onAuthorOpen) return;
        const target = e.target as HTMLElement;
        // Портали (меню дій) спливають через React-дерево, але лежать поза рядком.
        if (!e.currentTarget.contains(target) || target.closest('button, a, input, textarea, [role="menu"], [role="menuitem"]')) return;
        onAuthorOpen(a);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.target !== e.currentTarget || !a || !onAuthorOpen) return;
        e.preventDefault();
        onAuthorOpen(a);
      }}
      className={cn('t2f-msg t2f-focus relative flex flex-col gap-0.5 rounded-md px-2 py-1.5', a && onAuthorOpen && 'cursor-pointer', className)}
    >
      <div className={ROW}>
        {a ? (
          <button
            type="button"
            data-chat-author=""
            aria-label={authorLabel}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => onAuthorOpen?.(a)}
            onFocus={onAuthorFocus}
            onKeyDown={onAuthorKeyDown}
            className="t2f-nick -mx-1 -my-3.5 inline-flex min-h-touch-min items-center px-1 text-label-sm text-text"
          >
            {/* Ціль 44 px невидима; наведення — підсвітка всього рядка повідомлення, фокус — рамка лише навколо
                прапора й імені (раніше підсвітка 44-піксельної цілі заходила на попереднє повідомлення). */}
            <span className="t2f-nick-label inline-flex items-center gap-1.5 rounded-sm">
              <Flag code={a.flagCode} size="xs" decorative />
              <span className="t2f-nick-name">{a.nick}</span>
            </span>
          </button>
        ) : null}
        {pass ? <PassMark label={badges('vip')} /> : null}
        {firstRow ? (
          <>
            <Badge variant="first-row" />
            {a?.firstRowEmojiId ? (
              <span role="img" aria-label={t('emotionLabel', { emotion: emotionName(a.firstRowEmojiId) })} className="text-label-sm leading-none">
                {emojiSymbol(a.firstRowEmojiId)}
              </span>
            ) : null}
          </>
        ) : null}
        {a?.isMine ? <Badge variant="you" /> : null}
        <time dateTime={new Date(message.createdAt).toISOString()} className="ms-auto text-label-badge-chat text-text-muted">
          {time}
        </time>
        {actions === 'menu' ? (
          <span className="t2f-msg-actions">
            <MessageActionsMenu
              message={message}
              tabStop={tabStop}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              onReact={onReact}
              onReply={onReply}
              onReport={onReport}
            />
          </span>
        ) : actions === 'sheet' ? (
          <span className="t2f-msg-actions">
          <IconButton
            icon="more"
            compact
            iconSize={16}
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('actionsLabel', { nick: a?.nick ?? '' })}
            onClick={() => onOpenActions?.(message)}
          />
          </span>
        ) : null}
      </div>
      {message.replyTo ? (
        <p className="border-s-2 border-border-strong ps-2 text-caption text-text-muted" data-row="reply">
          <span className="font-semibold">{t('replyTo', { nick: message.replyTo.nick })}</span> {message.replyTo.excerpt}
        </p>
      ) : null}
      <p className="text-chat text-text">{withMentions(message.text)}</p>
      <ReactionsRow message={message} tabStop={tabStop} onReact={actions ? onReact : undefined} className="pt-1" />
    </li>
  );
}
