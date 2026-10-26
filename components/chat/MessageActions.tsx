'use client';

/**
 * C12. MessageActions — дії над повідомленням.
 * - телефон: `MessageActionsSheet` — вміст аркуша (OverlayManager): повідомлення-цитата, рядок із 6 реакцій
 *   («Хлопавка, Серце, Келихи, Феєрверк, Сміх, Обійми»), «Відповісти», «Поскаржитись»;
 * - десктоп: `MessageActionsMenu` — DropdownMenu із тими ж пунктами біля повідомлення.
 * - `ReactionsRow` — реакції під текстом: кнопка-лічильник «Реакція Хлопавка: 12, твоя. Прибрати».
 */
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import type { ChatMessage, ReactionId } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { REACTION_ORDER, REACTION_SYMBOLS } from './reactions';

export interface MessageActionHandlers {
  onReact?: (message: ChatMessage, reaction: ReactionId, on: boolean) => void;
  onReply?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
}

export interface ReactionsRowProps {
  message: ChatMessage;
  onReact?: MessageActionHandlers['onReact'];
  /** Рухомий tabindex: лише для повідомлення з єдиним Tab-стопом. */
  tabStop?: boolean;
  className?: string;
}

/** Реакції під повідомленням; без реакцій нічого не малюється. */
export function ReactionsRow({ message, onReact, tabStop = false, className }: ReactionsRowProps) {
  const t = useTranslations('chat');
  const entries = REACTION_ORDER.filter((id) => (message.reactions?.[id]?.count ?? 0) > 0);
  if (!entries.length) return null;
  return (
    <div role="group" aria-label={t('reactionsGroup')} data-row="reactions" className={cn('flex flex-wrap gap-1.5', className)}>
      {entries.map((id) => {
        const r = message.reactions![id]!;
        const name = t(`reactions.${id}`);
        if (!onReact) {
          return (
            <span
              key={id}
              role="img"
              aria-label={t('reactionLabelStatic', { name, count: r.count })}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-border-strong px-2 text-caption text-text"
            >
              <span aria-hidden="true">{REACTION_SYMBOLS[id]}</span>
              <span aria-hidden="true">{r.count}</span>
            </span>
          );
        }
        return (
          <button
            key={id}
            type="button"
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('reactionLabel', { name, count: r.count, mine: r.mine ? 'yes' : 'no' })}
            onClick={() => onReact?.(message, id, !r.mine)}
            className="t2f-focus t2f-transition -my-2.5 inline-flex min-h-touch-min items-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-caption text-text',
                r.mine ? 'border-text bg-surface-raised' : 'border-border-strong',
              )}
            >
              <span>{REACTION_SYMBOLS[id]}</span>
              {r.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface MessageActionsSheetProps extends MessageActionHandlers {
  message: ChatMessage;
  /** Закрити аркуш після дії. */
  onDone?: () => void;
}

/** Вміст аркуша дій (телефон). Реакція застосовується одразу й закриває аркуш. */
export function MessageActionsSheet({ message, onReact, onReply, onReport, onDone }: MessageActionsSheetProps) {
  const t = useTranslations('chat');
  const a = message.author;
  return (
    <div className="flex flex-col gap-4">
      <blockquote className="flex flex-col gap-1 border-s-2 border-border-strong ps-3" data-row="quote">
        <p className="text-label-sm text-text">
          {a?.nick} <span className="text-text-muted">· {formatClock(message.createdAt)}</span>
        </p>
        <p className="text-chat text-text-secondary">{message.text}</p>
      </blockquote>
      <div role="group" aria-label={t('reactionsPick')} className="flex flex-wrap gap-1">
        {REACTION_ORDER.map((id) => {
          const mine = message.reactions?.[id]?.mine ?? false;
          return (
            <button
              key={id}
              type="button"
              aria-label={t('reactionPickLabel', { name: t(`reactions.${id}`) })}
              aria-pressed={mine}
              onClick={() => {
                onReact?.(message, id, !mine);
                onDone?.();
              }}
              className="t2f-focus t2f-transition inline-flex size-touch-min items-center justify-center rounded-lg border-2 border-transparent text-headline-sm hover:bg-surface-raised aria-pressed:border-text aria-pressed:bg-surface-raised"
            >
              <span aria-hidden="true">{REACTION_SYMBOLS[id]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-col">
        <Button
          variant="ghost"
          iconLeft="send"
          className="w-full justify-start"
          onClick={() => {
            onReply?.(message);
            onDone?.();
          }}
        >
          {t('reply')}
        </Button>
        <Button
          variant="ghost"
          iconLeft="alert"
          className="w-full justify-start"
          onClick={() => {
            onReport?.(message);
            onDone?.();
          }}
        >
          {t('report')}
        </Button>
      </div>
    </div>
  );
}

export interface MessageActionsMenuProps extends MessageActionHandlers {
  message: ChatMessage;
  tabStop?: boolean;
  className?: string;
}

/** Меню дій (десктоп): кнопка «Дії з повідомленням» відкриває DropdownMenu. */
export function MessageActionsMenu({ message, onReact, onReply, onReport, tabStop = false, className }: MessageActionsMenuProps) {
  const t = useTranslations('chat');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon="more"
          compact
          iconSize={16}
          tabIndex={tabStop ? 0 : -1}
          aria-label={t('actionsLabel', { nick: message.author?.nick ?? '' })}
          className={className}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('reactionsPick')}</DropdownMenuLabel>
        {REACTION_ORDER.map((id) => {
          const mine = message.reactions?.[id]?.mine ?? false;
          return (
            <DropdownMenuItem key={id} onSelect={() => onReact?.(message, id, !mine)}>
              <span aria-hidden="true">{REACTION_SYMBOLS[id]}</span>
              <span className="flex-1">{t(`reactions.${id}`)}</span>
              {mine ? <Icon name="check" size={16} /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onReply?.(message)}>
          <Icon name="send" size={16} />
          {t('reply')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onReport?.(message)}>
          <Icon name="alert" size={16} />
          {t('report')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
