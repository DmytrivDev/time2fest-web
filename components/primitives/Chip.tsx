'use client';

import { Toggle } from 'radix-ui';
import { useTranslations } from 'next-intl';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';
import { Flag } from './Flag';
import { Icon } from './Icon';

export type ChipVariant = 'country' | 'zone' | 'filter' | 'more';
export type ZoneChipState = 'past' | 'live' | 'next' | 'future';

interface BaseProps {
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
}

export interface CountryChipProps extends BaseProps {
  variant: 'country';
  /** Код прапора (ISO). */
  flag: string;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}
export interface ZoneChipProps extends BaseProps {
  variant: 'zone';
  zoneState: ZoneChipState;
  /** Час події («03:00») для найближчого поясу. */
  time?: string;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}
export interface FilterChipProps extends BaseProps {
  variant: 'filter';
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}
export interface MoreChipProps extends BaseProps, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'> {
  variant: 'more';
  /** Скільки ще схоже: «Ще 14». */
  count?: number;
  expanded?: boolean;
}
export type ChipProps = CountryChipProps | ZoneChipProps | FilterChipProps | MoreChipProps;

const BASE =
  't2f-focus t2f-press t2f-transition inline-flex min-h-touch-min shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-label-sm';
const LOOK =
  'border-border-strong bg-surface text-text hover:bg-surface-raised aria-pressed:border-text aria-pressed:bg-surface-raised disabled:border-border disabled:bg-transparent disabled:text-text-muted disabled:hover:bg-transparent';

/** P5. Чип. `country` — прапор і назва; `zone` — стан поясу; `filter` — перемикач; `more` — «Ще N» / «Згорнути». */
export function Chip(props: ChipProps) {
  const t = useTranslations('primitives.chip');

  if (props.variant === 'more') {
    const { variant: _v, count, expanded, className, children, ...rest } = props;
    void _v;
    return (
      <button
        type="button"
        aria-expanded={expanded ?? false}
        data-variant="more"
        className={cn(BASE, LOOK, 'text-text-secondary', className)}
        {...rest}
      >
        {children ?? (expanded ? t('less') : t('more', { count: count ?? 0 }))}
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} />
      </button>
    );
  }

  const { selected, onSelectedChange, className, children, disabled } = props;

  let content: ReactNode = children;
  let look = cn(BASE, LOOK, className);
  if (props.variant === 'country') {
    content = (
      <>
        <Flag code={props.flag} size="xs" decorative />
        {children}
      </>
    );
  } else if (props.variant === 'zone') {
    const { zoneState, time } = props;
    const zone: Record<ZoneChipState, string> = {
      past: 'text-text-muted',
      live: 'border-primary text-text',
      next: 'text-highlight',
      future: 'text-text-muted',
    };
    look = cn(BASE, LOOK, 'text-caption', zone[zoneState], className);
    content = (
      <>
        {zoneState === 'past' && <Icon name="check" size={16} />}
        {zoneState === 'live' && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
        {zoneState === 'next' && <Icon name="clock" size={16} />}
        {children}
        {zoneState === 'live' && <span className="text-text">{t('zoneLive')}</span>}
        {zoneState === 'next' && time ? <span>{time}</span> : null}
        {zoneState === 'past' && <span className="sr-only">{t('zonePast')}</span>}
      </>
    );
  }

  return (
    <Toggle.Root
      pressed={selected}
      onPressedChange={onSelectedChange}
      disabled={disabled}
      data-variant={props.variant}
      className={look}
    >
      {content}
    </Toggle.Root>
  );
}

/** Ряд чипів: підпис групи для зчитувача, переноситься або гортається вбік. */
export function ChipGroup({
  label,
  scroll = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { label: string; scroll?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex gap-2', scroll ? 't2f-no-scrollbar overflow-x-auto' : 'flex-wrap', className)}
      {...rest}
    />
  );
}
