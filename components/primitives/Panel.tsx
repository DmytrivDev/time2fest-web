'use client';

/**
 * P18 ChatSlotPanel (десктоп) і P19 InFlowSlot.
 *
 * ChatSlotPanel — панель на місці колонки чату, та сама геометрія (sticky, висота вікна):
 * рендериться в контейнер `#chat-slot` з LiveShell (якщо його немає — на місці).
 * - `form` (O-NICK, O-FIRST-ROW, O-REMIND, O-SHARE): фокус усередині (FocusScope trapped),
 *   дотик поза панеллю не закриває (не губимо введене);
 * - `nonmodal` (O-AUTHOR, мова, профіль): «Назад» / Esc повертає фокус на тригер;
 * - `accent`: як `form`, з жовтою межею («Перший ряд»).
 * Основа — Radix Dialog `modal={false}` + FocusScope.
 *
 * InFlowSlot — зарезервоване місце одразу під рядком дій плеєра для вікон без введення
 * (штамп, оцінка, пропозиції, «Що дає», смуга cookies): одне за раз, `aria-live="polite"`,
 * фокус не переносить, висота резервується заздалегідь (вміст під ним не стрибає).
 */
import { Dialog } from 'radix-ui';
import { FocusScope } from 'radix-ui/internal';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { IconButton } from './IconButton';

export const CHAT_SLOT_ID = 'chat-slot';
/** Слот секцій на всю ширину під сіткою «колонка | чат» (LiveShell). */
export const WIDE_SLOT_ID = 'page-wide';

export type ChatSlotPanelVariant = 'form' | 'nonmodal' | 'accent';

export interface ChatSlotPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: ChatSlotPanelVariant;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** TODO(i18n): з messages. */
  closeLabel?: string;
  backLabel?: string;
  /** Шапка за макетом O-NICK: заголовок 18/700 з підзаголовком, × 44 px, без лінії під шапкою, тіло без відступів. */
  boardHeader?: boolean;
  className?: string;
}

/** Контейнер колонки чату; вікно відкривається лише на клієнті (дією людини), тож читання DOM тут безпечне. */
function chatSlot(open: boolean): HTMLElement | null {
  if (!open || typeof document === 'undefined') return null;
  return document.getElementById(CHAT_SLOT_ID);
}

export function ChatSlotPanel({
  open,
  onOpenChange,
  variant = 'form',
  title,
  description,
  children,
  closeLabel = 'Закрити',
  backLabel = 'Назад',
  boardHeader = false,
  className,
}: ChatSlotPanelProps) {
  const container = chatSlot(open);
  const isForm = variant !== 'nonmodal';

  const content = (
    <Dialog.Content
      data-chat-slot-panel={variant}
      className={cn(
        'absolute inset-0 z-20 flex flex-col bg-surface text-text',
        variant === 'accent' ? 'border-2 border-highlight' : 'border-l border-border',
        className,
      )}
      onInteractOutside={isForm ? (e) => e.preventDefault() : undefined}
      {...(description ? {} : { 'aria-describedby': undefined })}
    >
      <FocusScope.Root asChild trapped={isForm && open} loop={isForm}>
        <div className="flex min-h-0 flex-1 flex-col">
          {boardHeader ? (
            <div className="flex shrink-0 items-start gap-1 pe-1 ps-4 pt-2" data-board-header="">
              <div className="min-w-0 flex-1 pt-1.5">
                <Dialog.Title className="t2f-board-title">{title}</Dialog.Title>
                {description ? <Dialog.Description className="text-caption text-text-muted">{description}</Dialog.Description> : null}
              </div>
              <Dialog.Close asChild>
                <IconButton icon="close" aria-label={closeLabel} />
              </Dialog.Close>
            </div>
          ) : null}
          {!boardHeader ? (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
              {variant === 'nonmodal' ? (
                <Dialog.Close asChild>
                  <Button variant="ghost" iconLeft="chevron-left">
                    {backLabel}
                  </Button>
                </Dialog.Close>
              ) : null}
              <Dialog.Title className="flex-1 text-headline-sm">{title}</Dialog.Title>
              {isForm ? (
                <Dialog.Close asChild>
                  <IconButton icon="close" aria-label={closeLabel} />
                </Dialog.Close>
              ) : null}
            </div>
          ) : null}
          {description && !boardHeader ? (
            <Dialog.Description className="px-4 pt-3 text-body text-text-secondary">{description}</Dialog.Description>
          ) : null}
          <div className={cn('min-h-0 flex-1 overflow-y-auto', !boardHeader && 'p-4')}>{children}</div>
        </div>
      </FocusScope.Root>
    </Dialog.Content>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {container ? <Dialog.Portal container={container}>{content}</Dialog.Portal> : open ? content : null}
    </Dialog.Root>
  );
}

export interface InFlowSlotProps {
  /** Одне вікно за раз; `null` — порожній слот. */
  children?: ReactNode;
  /** Зарезервована висота, px (щоб вміст під слотом не стрибав). */
  reserveHeight?: number;
  /** Доступна назва області. TODO(i18n). */
  label?: string;
  className?: string;
}

export function InFlowSlot({ children, reserveHeight = 0, label = 'Повідомлення під відео', className }: InFlowSlotProps) {
  const occupied = children !== null && children !== undefined && children !== false;
  return (
    <section
      aria-label={label}
      aria-live="polite"
      data-in-flow-slot={occupied ? 'occupied' : 'empty'}
      className={cn('w-full', className)}
      style={reserveHeight ? { minHeight: reserveHeight } : undefined}
    >
      {occupied ? children : null}
    </section>
  );
}
