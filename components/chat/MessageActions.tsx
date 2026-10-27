'use client';

/**
 * C12. MessageActions — дії над повідомленням.
 * - телефон: `MessageActionsSheet` — вміст аркуша (OverlayManager): повідомлення-цитата, рядок із 6 реакцій
 *   («Хлопавка, Серце, Келихи, Феєрверк, Сміх, Обійми»), «Відповісти», «Поскаржитись»;
 * - десктоп: `MessageActionsMenu` — DropdownMenu із тими ж пунктами біля повідомлення.
 * - `ReactionsRow` — реакції під текстом: кнопка-лічильник «Реакція Хлопавка: 12, твоя. Прибрати».
 */
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
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

/** Імітована затримка «надсилання» реакції: поки йде, на чипі крихітний індикатор і повторний клік ігнорується. */
const REACT_PENDING_MS = 450;

/**
 * Реакції під повідомленням; без реакцій нічого не малюється. Клік — оптимістично й одразу (лічильник змінюється
 * миттєво), чип показує крихітне «надсилається» і не приймає повторних кліків. Своя реакція — лічильник жовтий.
 */
export function ReactionsRow({ message, onReact, tabStop = false, className }: ReactionsRowProps) {
  const t = useTranslations('chat');
  const [pending, setPending] = useState<ReadonlySet<ReactionId>>(() => new Set());
  const timers = useRef(new Map<ReactionId, number>());
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((id) => window.clearTimeout(id));
  }, []);
  const entries = REACTION_ORDER.filter((id) => (message.reactions?.[id]?.count ?? 0) > 0);
  if (!entries.length) return null;
  const toggle = (id: ReactionId, mine: boolean) => {
    if (pending.has(id)) return;
    onReact?.(message, id, !mine);
    setPending((p) => new Set(p).add(id));
    timers.current.set(
      id,
      window.setTimeout(() => {
        timers.current.delete(id);
        setPending((p) => {
          const n = new Set(p);
          n.delete(id);
          return n;
        });
      }, REACT_PENDING_MS),
    );
  };
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
        const busy = pending.has(id);
        return (
          <button
            key={id}
            type="button"
            tabIndex={tabStop ? 0 : -1}
            aria-label={t('reactionLabel', { name, count: r.count, mine: r.mine ? 'yes' : 'no' })}
            aria-busy={busy || undefined}
            data-mine={r.mine ? 'true' : undefined}
            onClick={() => toggle(id, r.mine ?? false)}
            className="t2f-chip -my-2.5 inline-flex min-h-touch-min items-center rounded-full"
          >
            <span aria-hidden="true" className="t2f-chip-body inline-flex h-6 items-center gap-1 rounded-full border border-border-strong px-2 text-caption text-text">
              <span>{REACTION_SYMBOLS[id]}</span>
              <span className="t2f-chip-count">{r.count}</span>
              {busy ? <span className="t2f-chip-spin" /> : null}
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
  /** Кероване відкриття (клік по повідомленню відкриває те саме меню). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/** Меню дій (десктоп): кнопка «Дії з повідомленням» відкриває DropdownMenu. */
export function MessageActionsMenu({ message, onReact, onReply, onReport, tabStop = false, open, onOpenChange, className }: MessageActionsMenuProps) {
  const t = useTranslations('chat');
  return (
    <DropdownMenu {...(open !== undefined ? { open, onOpenChange } : {})}>
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
