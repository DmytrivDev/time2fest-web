'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

export type BadgeVariant =
  | 'live'
  | 'live-quiet'
  | 'on-air'
  | 'soon'
  | 'recording'
  | 'replay'
  | 'verified'
  | 'stream-status'
  | 'in-schedule'
  | 'vip'
  | 'first-row'
  | 'count'
  | 'discount'
  | 'your-midnight'
  | 'you';

export type StreamStatus = 'live' | 'expected' | 'possible' | 'countdown-only';

export interface BadgeProps {
  variant: BadgeVariant;
  /** Свій текст замість типового (напр. «за 5 хв» для `soon`, «−50%» для `discount`, «це ти» для `you`). */
  children?: ReactNode;
  /** `stream-status`: який із чотирьох статусів. */
  status?: StreamStatus;
  /** `count`: число; понад 99 показується «99+». */
  value?: number;
  /** `recording`: сезон, напр. «2025/26». */
  season?: string;
  /** ТВ-розмір (`live`: 22 px текст, 40 px висота). */
  size?: 'md' | 'tv';
  /** Без точки з ореолом (для `live`, коли поруч уже є рух). */
  className?: string;
}

const BOX = 'inline-flex shrink-0 items-center whitespace-nowrap';

function Dot({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)} aria-hidden="true">
      <span className="t2f-halo absolute inset-0 rounded-full bg-current opacity-60" />
      <span className="relative size-2 rounded-full bg-current" />
    </span>
  );
}

/** P6. Позначка: жодна не інтерактивна; стан передається і текстом, не лише кольором. */
export function Badge({ variant, children, status = 'live', value = 0, season = '2025/26', size = 'md', className }: BadgeProps) {
  const t = useTranslations('primitives.badge');

  switch (variant) {
    case 'live': {
      const tv = size === 'tv';
      return (
        <span
          data-variant="live"
          className={cn(
            BOX,
            'gap-1.5 rounded-sm bg-primary-fill-hover text-on-primary uppercase',
            tv ? 'h-10 px-3 text-tv-text' : 'h-5.5 px-2 text-label-badge-chat font-semibold',
            className,
          )}
        >
          <Dot />
          {children ?? t('live')}
        </span>
      );
    }
    case 'live-quiet':
      return (
        <span data-variant="live-quiet" className={cn(BOX, 'gap-1.5 rounded-sm text-label-badge text-primary', className)}>
          <Dot />
          {children ?? t('live')}
        </span>
      );
    case 'on-air':
      return (
        <span
          data-variant="on-air"
          className={cn(BOX, 'h-5.5 gap-1 rounded-sm bg-surface-raised px-2 text-label-badge text-text', className)}
        >
          <Icon name="broadcast" size={16} />
          {children ?? t('onAir')}
        </span>
      );
    case 'soon':
      return (
        <span
          data-variant="soon"
          className={cn(BOX, 'h-5.5 rounded-sm bg-surface-raised px-2 text-label-badge text-highlight', className)}
        >
          {children ?? t('soon')}
        </span>
      );
    case 'recording':
      return (
        <span
          data-variant="recording"
          className={cn(BOX, 'h-5.5 rounded-sm bg-surface-raised px-2 text-label-badge text-text-muted', className)}
        >
          {children ?? t('recording', { season })}
        </span>
      );
    case 'replay':
      return (
        <span
          data-variant="replay"
          className={cn(BOX, 'h-5.5 gap-1 rounded-sm bg-surface-raised px-2 text-label-badge text-text-muted', className)}
        >
          <Icon name="play" size={16} />
          {children ?? t('replay')}
        </span>
      );
    case 'verified':
      return (
        <span data-variant="verified" className={cn(BOX, 'gap-1 text-caption text-text-muted', className)}>
          <Icon name="check" size={16} />
          {children ?? t('verified')}
        </span>
      );
    case 'stream-status': {
      const base = cn(BOX, 'h-5.5 gap-1 rounded-sm border px-2 text-label-badge');
      if (status === 'live') {
        return (
          <span
            data-variant="stream-status"
            data-status="live"
            className={cn(base, 'border-primary-fill bg-primary-fill text-on-primary', className)}
          >
            <Dot />
            {children ?? t('status.live')}
          </span>
        );
      }
      const look: Record<Exclude<StreamStatus, 'live'>, { cls: string; icon: 'broadcast' | 'broadcast-dashed' | 'clock'; label: string }> = {
        expected: { cls: 'border-text text-text', icon: 'broadcast', label: t('status.expected') },
        possible: { cls: 'border-dashed border-text-muted text-text-secondary', icon: 'broadcast-dashed', label: t('status.possible') },
        'countdown-only': { cls: 'border-border-strong text-text-secondary', icon: 'clock', label: t('status.countdownOnly') },
      };
      const l = look[status];
      return (
        <span data-variant="stream-status" data-status={status} className={cn(base, l.cls, className)}>
          <Icon name={l.icon} size={16} />
          {children ?? l.label}
        </span>
      );
    }
    case 'in-schedule':
      return (
        <span
          data-variant="in-schedule"
          className={cn(
            BOX,
            'h-5.5 gap-1 rounded-full border border-highlight bg-highlight-tint px-2 text-label-badge-chat text-highlight',
            className,
          )}
        >
          <Icon name="calendar-check" size={16} />
          {children ?? t('inSchedule')}
        </span>
      );
    case 'vip': {
      const label = typeof children === 'string' ? children : t('vip');
      return (
        <Tooltip content={label}>
          <button
            type="button"
            aria-label={label}
            data-variant="vip"
            className={cn(
              't2f-focus inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-highlight text-on-highlight',
              className,
            )}
          >
            <Icon name="ticket" size={16} className="size-3" />
          </button>
        </Tooltip>
      );
    }
    case 'first-row':
      return (
        <span
          data-variant="first-row"
          className={cn(BOX, 'h-5 rounded-full bg-highlight px-2 text-label-badge-chat text-on-highlight', className)}
        >
          {children ?? t('firstRow')}
        </span>
      );
    case 'count':
      return (
        <span
          data-variant="count"
          className={cn(
            BOX,
            'h-5 min-w-5 justify-center rounded-full bg-surface-raised px-1.5 text-label-badge-chat text-text',
            className,
          )}
        >
          {children ?? (value > 99 ? t('countMax') : String(value))}
        </span>
      );
    case 'discount':
      return (
        <span
          data-variant="discount"
          className={cn(BOX, 'h-5.5 rounded-sm bg-surface-raised px-2 text-label-badge text-highlight', className)}
        >
          {children ?? t('discount')}
        </span>
      );
    case 'your-midnight':
      return (
        <span
          data-variant="your-midnight"
          className={cn(
            BOX,
            'h-5.5 rounded-full border border-highlight bg-highlight-tint px-2 text-label-badge-chat text-highlight',
            className,
          )}
        >
          {children ?? t('yourMidnight')}
        </span>
      );
    case 'you':
      return (
        <span
          data-variant="you"
          className={cn(BOX, 'h-5 rounded-full border border-text px-2 text-label-badge-chat text-text', className)}
        >
          {children ?? t('you')}
        </span>
      );
  }
}
