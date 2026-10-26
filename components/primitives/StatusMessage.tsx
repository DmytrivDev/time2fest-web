import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './Icon';

export type StatusKind = 'info' | 'success' | 'offline' | 'error';

export interface StatusMessageProps {
  kind?: StatusKind;
  children: ReactNode;
  /** Дія: кнопка «Спробувати ще» чи посилання «Перейти ›». */
  action?: ReactNode;
  className?: string;
}

const ICON: Record<StatusKind, { name: IconName; className: string }> = {
  info: { name: 'info', className: 'text-text-secondary' },
  success: { name: 'check', className: 'text-text' },
  offline: { name: 'wifi-off', className: 'text-text-secondary' },
  error: { name: 'alert', className: 'text-primary' }, // коралова іконка + текст
};

/**
 * P22. Коротка смуга статусу під блоком: «Перемкнули на іншу трансляцію з цього місця», «Додано в графік».
 * `role="status"` (ввічлива область); фокус не переносить. Текст має стояти в DOM до оголошення або бути підставлений.
 */
export function StatusMessage({ kind = 'info', children, action, className }: StatusMessageProps) {
  const icon = ICON[kind];
  return (
    <div
      role="status"
      data-kind={kind}
      className={cn(
        'flex min-h-touch-min flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-surface-raised px-4 py-2 text-body text-text',
        className,
      )}
    >
      <Icon name={icon.name} size={20} className={icon.className} />
      <span className="min-w-0 flex-1">{children}</span>
      {action ? <span className="flex shrink-0 items-center">{action}</span> : null}
    </div>
  );
}
