import { Slot } from 'radix-ui';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from './cn';
import { useCoralWindowOpen } from '@/lib/overlay/coral';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'coral' | 'secondary' | 'tonal' | 'ghost';
export type ButtonSize = 'md' | 'lg' | 'tv';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `coral` — головна дія, одна на екран (ІНВ 5.3). */
  variant?: ButtonVariant;
  /** md 44 · lg 48 (дія у формі, аркуші, вікні) · tv 56. */
  size?: ButtonSize;
  /** Рендерити дочірній елемент (посилання) замість `<button>`; іконки тоді не додаються. */
  asChild?: boolean;
  iconLeft?: IconName;
  iconRight?: IconName;
  /** Стан завантаження: кнопка неактивна, `aria-busy`. */
  loading?: boolean;
  /** Компактна: кнопки хедера (label-sm 14/600, відступ 12); висота лишається 44. */
  compact?: boolean;
  /**
   * Лише для `coral`: коли відкрито вікно з власною коралою (`useCoralWindowOpen`),
   * кнопка малюється нейтрально (рамка border-strong, фон surface-raised) — правило однієї коралової кнопки (ІНВ 5.3).
   */
  yieldToCoralWindow?: boolean;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
}

const SIZE: Record<ButtonSize, string> = {
  md: 'min-h-touch-min px-5',
  lg: 'min-h-12 px-6',
  tv: 'min-h-14 px-8',
};

const VARIANT: Record<ButtonVariant | 'neutral', string> = {
  coral: 'border-transparent bg-primary-fill text-on-primary hover:bg-primary-fill-hover',
  secondary: 'border-border-strong bg-transparent text-text hover:bg-surface-raised aria-expanded:border-text',
  tonal: 'border-border-strong bg-surface-raised text-text hover:bg-border aria-expanded:border-text',
  ghost: 'border-transparent bg-transparent text-text-muted hover:bg-surface-raised hover:text-text',
  neutral: 'border-border-strong bg-surface-raised text-text hover:bg-border',
};

const DISABLED =
  'disabled:border-border disabled:bg-transparent disabled:text-text-muted disabled:hover:bg-transparent aria-disabled:border-border aria-disabled:bg-transparent aria-disabled:text-text-muted aria-disabled:hover:bg-transparent';

/** P1. Кнопка. Коралова — головна й одна на екран; решта — `secondary`, `tonal`, `ghost`. */
export function Button({
  variant = 'secondary',
  size = 'md',
  asChild = false,
  iconLeft,
  iconRight,
  loading = false,
  compact = false,
  yieldToCoralWindow = false,
  className,
  children,
  disabled,
  type,
  ref,
  ...rest
}: ButtonProps) {
  const foreignCoral = useCoralWindowOpen();
  const neutral = variant === 'coral' && yieldToCoralWindow && foreignCoral;
  const styleKey: ButtonVariant | 'neutral' = neutral ? 'neutral' : variant;
  const iconSize = size === 'tv' ? 22 : 18;
  const isDisabled = Boolean(disabled) || loading;
  // Макети: підписи кнопок без розрядки (токен label-button має 0.04em — на макетах її немає).
  const text = size === 'tv' ? 'text-tv-text' : compact ? 'text-label-sm' : variant === 'ghost' ? 'text-body-strong' : 'text-label-button tracking-normal';

  const classes = cn(
    't2f-focus t2f-press t2f-transition inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border',
    text,
    compact ? 'min-h-touch-min px-3' : SIZE[size],
    VARIANT[styleKey],
    DISABLED,
    className,
  );

  if (asChild) {
    return (
      <Slot.Root
        className={classes}
        data-variant={styleKey}
        data-size={size}
        aria-disabled={isDisabled || undefined}
        {...(rest as object)}
      >
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      data-variant={styleKey}
      data-size={size}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Icon name="clock" size={iconSize} className="t2f-spin" /> : iconLeft ? <Icon name={iconLeft} size={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}
