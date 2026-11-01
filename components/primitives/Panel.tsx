'use client';

/**
 * P18 ChatSlotPanel (десктоп) і P19 InFlowSlot.
 *
 * ChatSlotPanel — панель на місці колонки чату, та сама геометрія (sticky, висота вікна):
 * рендериться в контейнер `#chat-slot` з LiveShell (якщо його немає — на місці).
 * - `form` (O-NICK, O-FIRST-ROW, O-REMIND, O-SHARE): фокус усередині (FocusScope trapped),
 *   дотик поза панеллю не закриває (не губимо введене);
 * - `nonmodal` (O-AUTHOR, мова, профіль): «Назад» / Esc повертає фокус на тригер;
 * - `accent`: як `form` («Перший ряд»); рамка — як у чату (жовту межу прибрано, рішення 2026-10-29).
 * Основа — Radix Dialog `modal={false}` + FocusScope.
 *
 * InFlowSlot — зарезервоване місце одразу під рядком дій плеєра для вікон без введення
 * (штамп, оцінка, пропозиції, «Що дає», смуга cookies): одне за раз, `aria-live="polite"`,
 * фокус не переносить, висота резервується заздалегідь (вміст під ним не стрибає).
 */
import { Dialog } from 'radix-ui';
import { FocusScope } from 'radix-ui/internal';
import { useState, type ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export const CHAT_SLOT_ID = 'chat-slot';
/** Контейнер усередині розгорнутого вікна чату на телефоні (`ChatDock`). */
export const CHAT_DOCK_SLOT_ID = 'chat-dock-slot';
/** Шар вікна покупки «Першого ряду» поверх вікна чату на телефоні (`ChatDock`, рішення 2026-10-29). */
export const SEAT_DOCK_SLOT_ID = 'seat-dock-slot';
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
  /** Шапка O-AUTHOR: «‹ Назад» ліворуч, приглушений заголовок праворуч; тіло без відступів і прокрутки (її веде вміст). */
  authorHeader?: boolean;
  /** З `boardHeader`: рядок «‹ Назад» і «×» над назвою (вікно другого рівня). */
  onBack?: () => void;
  /** Контейнер, куди порталиться панель: колонка чату (за замовчуванням) або вікно чату внизу на телефоні. */
  containerId?: string;
  className?: string;
}

/** Контейнер колонки чату; вікно відкривається лише на клієнті (дією людини), тож читання DOM тут безпечне. */
function chatSlot(open: boolean, id: string): HTMLElement | null {
  if (!open || typeof document === 'undefined') return null;
  return document.getElementById(id);
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
  authorHeader = false,
  onBack,
  containerId = CHAT_SLOT_ID,
  className,
}: ChatSlotPanelProps) {
  const container = chatSlot(open, containerId);
  const isForm = variant !== 'nonmodal';
  // Вміст прокручено — під шапкою з’являється лінія: текст форми не зливається з підрядком шапки.
  const [scrolled, setScrolled] = useState(false);

  const content = (
    <Dialog.Content
      data-chat-slot-panel={variant}
      className={cn(
        'absolute inset-0 z-20 flex flex-col bg-surface text-text',
        'border-l border-border',
        className,
      )}
      // Дотик до ручки вікна чату на телефоні (згорнути/розгорнути) — не «поза панеллю»: вікно лишається (рішення 2026-10-28).
      // Так само — дотик до того, що відкриває іншу картку на цьому ж місці (фішки «Першого ряду», `data-opens-author`):
      // картка не закривається, а змінюється на нову людину (правка власника 2026-10-31).
      onInteractOutside={(e) => {
        const target = e.target as HTMLElement | null;
        if (isForm || target?.closest?.('[data-chat-dock]') || (!isForm && target?.closest?.('[data-opens-author]'))) e.preventDefault();
      }}
      // Фокус, що повертається на тригер після закриття меню (напр. «Правила чату» з «⋯»), не закриває панель.
      onFocusOutside={(e) => e.preventDefault()}
      {...(description ? {} : { 'aria-describedby': undefined })}
    >
      <FocusScope.Root asChild trapped={isForm && open} loop={isForm}>
        <div className="flex min-h-0 flex-1 flex-col">
          {boardHeader ? (
            <div
              className={cn('flex shrink-0 items-start gap-1 border-b pb-3 pe-2 ps-4 pt-2', scrolled ? 'border-border' : 'border-transparent')}
              data-board-header=""
              data-scrolled={scrolled ? 'true' : undefined}
            >
              {/* З «‹ Назад» рядок із × стоїть на тій самій висоті, що × у звичайних вікнах (правило 2026-11-01). */}
              <div className={cn('min-w-0 flex-1', onBack ? 'pt-0' : 'pt-2.5')}>
                {onBack ? (
                <div className="flex min-h-11 items-center justify-between" data-back-row="">
                  <button type="button" onClick={onBack} data-action="back" className="t2f-focus t2f-transition t2f-author-back t2f-back-flush">
                    <Icon name="chevron-left" size={18} className="[stroke-width:2]" />
                    {backLabel}
                  </button>
                  <Dialog.Close asChild>
                    <IconButton icon="close" aria-label={closeLabel} />
                  </Dialog.Close>
                </div>
              ) : null}
                <Dialog.Title className="t2f-board-title">{title}</Dialog.Title>
                {description ? <Dialog.Description className="mt-1 text-caption text-text-muted">{description}</Dialog.Description> : null}
              </div>
              {onBack ? null : (
                <Dialog.Close asChild>
                  <IconButton icon="close" aria-label={closeLabel} />
                </Dialog.Close>
              )}
            </div>
          ) : null}
          {authorHeader ? (
            <div className="t2f-author-header" data-author-header="">
              <Dialog.Close asChild>
                <button type="button" className="t2f-focus t2f-transition t2f-author-back">
                  <Icon name="chevron-left" size={18} className="[stroke-width:2]" />
                  {backLabel}
                </button>
              </Dialog.Close>
              <span className="flex-1" />
              <Dialog.Title className="text-caption font-normal text-text-muted">{title}</Dialog.Title>
            </div>
          ) : null}
          {!boardHeader && !authorHeader ? (
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
          {description && !boardHeader && !authorHeader ? (
            <Dialog.Description className="px-4 pt-3 text-body text-text-secondary">{description}</Dialog.Description>
          ) : null}
          {authorHeader ? (
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          ) : (
            <div
              className={cn('t2f-chat-log min-h-0 flex-1 overflow-x-hidden overflow-y-auto', !boardHeader && 't2f-slot-body p-4')}
              data-slot-body=""
              onScroll={boardHeader ? (e) => setScrolled(e.currentTarget.scrollTop > 0) : undefined}
            >
              {children}
            </div>
          )}
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
