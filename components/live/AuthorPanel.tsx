'use client';

/**
 * C13 AuthorPanel — O-AUTHOR (FR-055). Немодальне вікно: десктоп — `ChatSlotPanel` `nonmodal` на місці колонки чату,
 * телефон — Sheet (розміщення дає `OverlayManager`; «Назад»/Esc повертає фокус на нік повідомлення).
 * З пасом: автор (прапор, нік, країна, «Новорічний пас») · повідомлення, яке відкрили, реакція · `PathMap`
 * «Шлях <нік> · N країн · ще M у графіку» · текстовий маршрут · «Весь шлях» (Collapsible) · «Відповісти»,
 * «Згадати @нік», «Поскаржитись» · для глядача без пасу «Оформи пас, щоб інші бачили твій шлях».
 * Без пасу автора: лише нік, прапор, повідомлення й «Згадати». Свій нік: лише «це ти».
 */
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Collapsible } from '@/components/primitives/Collapsible';
import { Flag } from '@/components/primitives/Flag';
import { REACTION_ORDER, REACTION_SYMBOLS } from '@/components/chat/reactions';
import { pathSummary, routeCities, type PathPoint } from '@/lib/chat-sim/authorPath';
import type { Author, ChatMessage, ReactionId } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { PathLegend, PathMap } from './PathMap';
import type { ZoneMapGeometry } from './MapModel';

export interface AuthorPanelProps {
  author: Author;
  /** Назва країни прапора автора («Єгипет»). */
  countryName?: string;
  /** Повідомлення, яке відкрили, і назва кімнати («Світ»). */
  message?: ChatMessage;
  roomLabel?: string;
  /** Автор має пас (показуємо шлях). */
  hasPass: boolean;
  /** Шлях автора; порожній — «шлях приховано». */
  path?: readonly PathPoint[];
  /** У глядача є пас: рядок «Оформи пас» не показуємо. */
  viewerHasPass?: boolean;
  onReact?: (message: ChatMessage, reaction: ReactionId, on: boolean) => void;
  onReply?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
  /** «Згадати @нік»: вставити в поле чату й закрити панель. */
  onMention?: (author: Author) => void;
  /** Готова геометрія мапи (історії, тести). */
  geometry?: ZoneMapGeometry;
  className?: string;
}

export function AuthorPanel({
  author,
  countryName,
  message,
  roomLabel,
  hasPass,
  path = [],
  viewerHasPass = false,
  onReact,
  onReply,
  onReport,
  onMention,
  geometry,
  className,
}: AuthorPanelProps) {
  const t = useTranslations('chat.author');
  const ch = useTranslations('chat');
  const w = useTranslations('windows.author');
  const isMine = !!author.isMine;
  const showPath = hasPass && path.length > 0 && !isMine;
  const { met, planned } = pathSummary(path);
  const route = routeCities(path);
  const routeText = [route.met.join(' → '), route.planned.length ? t('routeNext', { cities: route.planned.join(', ') }) : ''].filter(Boolean).join(' · ');
  const summary = `${t('summaryMet', { count: met })}${planned ? ` · ${t('summaryPlanned', { count: planned })}` : ''}`;

  return (
    <div data-window="O-AUTHOR" data-pass={hasPass ? 'yes' : 'no'} className={cn('flex flex-col gap-5', className)}>
      <header className="flex items-center gap-3">
        <Flag round code={author.flagCode} size="md" name={countryName} decorative={!countryName} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex flex-wrap items-center gap-2 text-headline-sm text-text">
            <span className="break-words">{author.nick}</span>
            {isMine ? <Badge variant="you" /> : null}
          </p>
          {countryName ? <p className="text-caption text-text-secondary">{countryName}</p> : null}
        </div>
        {hasPass ? (
          <span data-badge="pass" className="inline-flex h-5 items-center rounded-full bg-highlight px-2 text-label-badge-chat text-on-highlight">
            {t('passLabel')}
          </span>
        ) : null}
      </header>

      {message ? (
        <section aria-label={t('messageHeading')} className="flex flex-col gap-2 rounded-md bg-surface p-3" data-row="message">
          <p className="text-caption text-text-muted">{t('messageMeta', { time: formatClock(message.createdAt), room: roomLabel ?? '' })}</p>
          <p className="text-chat text-text">{message.text}</p>
          {onReact ? (
            <div role="group" aria-label={t('reactionHeading')} className="flex flex-wrap gap-1">
              {REACTION_ORDER.map((id) => {
                const mine = message.reactions?.[id]?.mine ?? false;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={t('reactWith', { name: ch(`reactions.${id}`) })}
                    aria-pressed={mine}
                    onClick={() => onReact(message, id, !mine)}
                    className="t2f-focus t2f-transition inline-flex size-touch-min items-center justify-center rounded-lg border-2 border-transparent text-headline-sm hover:bg-surface-raised aria-pressed:border-text aria-pressed:bg-surface-raised"
                  >
                    <span aria-hidden="true">{REACTION_SYMBOLS[id]}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {showPath ? (
        <section aria-labelledby="author-path-title" className="flex flex-col gap-3" data-row="path">
          <div className="flex flex-col gap-0.5">
            <h3 id="author-path-title" className="text-headline-sm text-text">
              {w('pathOf', { name: author.nick })}
            </h3>
            <p className="text-caption text-text-secondary">{summary}</p>
          </div>
          <PathMap points={path} authorName={author.nick} summary={routeText} geometry={geometry} />
          <PathLegend />
          <p className="text-body text-text" data-row="route">
            {routeText}
          </p>
          <Collapsible title={w('wholePath')} meta={path.length}>
            <ol className="flex flex-col gap-2">
              {path.map((p) => (
                <li key={p.id} className="flex items-center gap-3" data-planned={p.planned ? '' : undefined}>
                  <Flag round code={p.flagCode} size="xs" decorative />
                  <span className="flex-1 text-body text-text">
                    {p.city}
                    <span className="text-text-muted">
                      {' '}
                      · {p.country}
                      {p.firstRowSeat ? ` · ${t('pointSeat', { seat: p.firstRowSeat })}` : ''}
                      {p.planned ? ` · ${w('legendSchedule')}` : ''}
                    </span>
                  </span>
                  <time dateTime={new Date(p.midnightMs).toISOString()} className="text-caption text-text-muted">
                    {formatClock(p.midnightMs)}
                  </time>
                </li>
              ))}
            </ol>
          </Collapsible>
        </section>
      ) : null}

      {!isMine ? (
        <div className="flex flex-col">
          {message && onReply ? (
            <Button variant="ghost" iconLeft="send" className="w-full justify-start" onClick={() => onReply(message)}>
              {t('reply')}
            </Button>
          ) : null}
          <Button variant="ghost" iconLeft="user" className="w-full justify-start" onClick={() => onMention?.(author)}>
            {t('mention', { nick: author.nick })}
          </Button>
          {message && onReport ? (
            <Button variant="ghost" iconLeft="alert" className="w-full justify-start" onClick={() => onReport(message)}>
              {t('report')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {!viewerHasPass ? (
        <p className="flex flex-wrap items-center gap-x-3 text-caption text-text-secondary" data-row="upsell">
          {w('upsell')}
        </p>
      ) : null}
    </div>
  );
}
