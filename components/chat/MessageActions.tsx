'use client';

/**
 * C12. Дії над повідомленням: меню «⋯» — `MessageMenu` (окремий файл); тут — типи обробників і `ReactionsRow`:
 * реакції під текстом, кнопка-лічильник «Реакція Хлопавка: 12, твоя. Прибрати».
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import type { ChatMessage, ReactionId } from '@/lib/data/types';
import { markReactPending, reactKey, isReactPending, useReactPending } from './reactPending';
import { REACTION_DISPLAY_ORDER, REACTION_SYMBOLS } from './reactions';

export interface MessageActionHandlers {
  onReact?: (message: ChatMessage, reaction: ReactionId, on: boolean) => void;
  onReply?: (message: ChatMessage) => void;
  onMention?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
  /** Своє повідомлення: видалити назавжди. */
  onDelete?: (message: ChatMessage) => void;
}

export interface ReactionsRowProps {
  message: ChatMessage;
  onReact?: MessageActionHandlers['onReact'];
  /** Рухомий tabindex: лише для повідомлення з єдиним Tab-стопом. */
  tabStop?: boolean;
  className?: string;
}

/** Ставить або знімає реакцію оптимістично: лічильник міняється одразу, чип показує «надсилається» і не приймає повторів. */
export function reactOptimistic(
  message: ChatMessage,
  id: ReactionId,
  onReact: MessageActionHandlers['onReact'],
): void {
  const key = reactKey(message.id, id);
  if (isReactPending(key)) return;
  const mine = message.reactions?.[id]?.mine ?? false;
  onReact?.(message, id, !mine);
  markReactPending(key);
}

function ReactionChip({
  message,
  id,
  tabStop,
  onReact,
}: {
  message: ChatMessage;
  id: ReactionId;
  tabStop: boolean;
  onReact: NonNullable<MessageActionHandlers['onReact']>;
}) {
  const t = useTranslations('chat');
  const busy = useReactPending(reactKey(message.id, id));
  const r = message.reactions![id]!;
  const name = t(`reactions.${id}`);
  return (
    <button
      type="button"
      tabIndex={tabStop ? 0 : -1}
      aria-label={t('reactionLabel', { name, count: r.count, mine: r.mine ? 'yes' : 'no' })}
      aria-busy={busy || undefined}
      data-mine={r.mine ? 'true' : undefined}
      onClick={() => reactOptimistic(message, id, onReact)}
      className="t2f-chip -my-2.5 inline-flex min-h-touch-min items-center rounded-full"
    >
      <span
        aria-hidden="true"
        className="t2f-chip-body inline-flex h-6 items-center gap-1 rounded-full border border-border-strong px-2 text-caption text-text"
      >
        <span>{REACTION_SYMBOLS[id]}</span>
        <span className="t2f-chip-count">{r.count}</span>
        {busy ? <span className="t2f-chip-spin" /> : null}
      </span>
    </button>
  );
}

/** Реакції під повідомленням; без реакцій нічого не малюється. Своя реакція — лічильник жовтий. */
export function ReactionsRow({ message, onReact, tabStop = false, className }: ReactionsRowProps) {
  const t = useTranslations('chat');
  const entries = REACTION_DISPLAY_ORDER.filter((id) => (message.reactions?.[id]?.count ?? 0) > 0);
  if (!entries.length) return null;
  return (
    <div
      role="group"
      aria-label={t('reactionsGroup')}
      data-row="reactions"
      className={cn('flex flex-wrap gap-1.5', className)}
    >
      {entries.map((id) => {
        if (!onReact) {
          const r = message.reactions![id]!;
          return (
            <span
              key={id}
              role="img"
              aria-label={t('reactionLabelStatic', { name: t(`reactions.${id}`), count: r.count })}
              className="inline-flex h-6 items-center gap-1 rounded-full border border-border-strong px-2 text-caption text-text"
            >
              <span aria-hidden="true">{REACTION_SYMBOLS[id]}</span>
              <span aria-hidden="true">{r.count}</span>
            </span>
          );
        }
        return (
          <ReactionChip key={id} message={message} id={id} tabStop={tabStop} onReact={onReact} />
        );
      })}
    </div>
  );
}
