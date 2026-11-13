'use client';

import { useTranslations } from 'next-intl';
import { cn } from './cn';
import { Icon } from './Icon';

export interface PassMarkProps {
  /**
   * `filled` — золотий значок біля ніку в чаті (стилі вбудовані); `outline` — тихіший значок у тості: вигляд
   * (коло, рамка, розмір 16 px) задає `className` з `toast.module.css`.
   */
  variant?: 'filled' | 'outline';
  className?: string;
}

/** Значок «Новорічний пас» біля імені автора (чат, тост): квиток у колі, підпис — «VIP» зі `primitives.badge`. */
export function PassMark({ variant = 'filled', className }: PassMarkProps) {
  const t = useTranslations('primitives.badge');
  const label = t('vip');
  const outline = variant === 'outline';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        outline ? null : '-ms-px flex size-4 shrink-0 items-center justify-center rounded-full bg-highlight text-on-highlight',
        className,
      )}
    >
      {outline ? <Icon name="ticket" size={12} strokeWidth={2.4} /> : <Icon name="ticket" size={16} className="size-3" />}
    </span>
  );
}
