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
import type { KeyboardEvent, ReactNode } from 'react';
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
      className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-highlight text-on-highlight"
    >
      <Icon name="star" size={16} className="size-3" />
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

  // Приховане модерацією бачить лише автор.
  if (message.moderation === 'hidden') {
    if (!message.author?.isMine) return null;
    return (
      <li data-kind="moderated" className={cn('text-caption italic text-text-muted', className)}>
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
      body = (
        <>
          <strong className="font-bold">{s.participantName}</strong> <Flag code={s.flagCode} size="xs" name={lookup?.countryName?.(s.flagCode)} decorative={!lookup?.countryName?.(s.flagCode)} />{' '}
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
        <li data-kind="system" data-system="greetings-counter" className={cn('flex items-center gap-1.5 text-label-badge-chat text-text-muted', className)}>
          {body}
        </li>
      );
    }
    return (
      <li
        data-kind="system"
        data-system={s?.kind}
        className={cn('flex items-center gap-2 rounded-sm bg-highlight-tint px-2 py-1 text-caption text-highlight', className)}
      >
        <Mark />
        <span className="min-w-0">{body}</span>
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
        className={cn('flex flex-col gap-1 rounded-sm border-s-3 border-highlight bg-highlight-tint py-2 pe-2.5 ps-3', className)}
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
    <li data-kind="regular" data-own={a?.isMine ? 'true' : undefined} className={cn('flex flex-col gap-px', className)}>
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
            className="t2f-focus t2f-transition -mx-1 -my-3.5 inline-flex min-h-touch-min items-center gap-1.5 rounded-sm px-1 text-label-sm text-text hover:bg-surface-raised"
          >
            <Flag code={a.flagCode} size="xs" decorative />
            {a.nick}
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
          <MessageActionsMenu message={message} tabStop={tabStop} onReact={onReact} onReply={onReply} onReport={onReport} className="-my-3.5 -me-2" />
        ) : actions === 'sheet' ? (
          <IconButton
            icon="more"
            compact
            iconSize={16}
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('actionsLabel', { nick: a?.nick ?? '' })}
            onClick={() => onOpenActions?.(message)}
            className="-my-3.5 -me-2"
          />
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
