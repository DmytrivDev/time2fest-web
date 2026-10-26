import { Toggle } from 'radix-ui';
import NextLink from 'next/link';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from './cn';
import { useCoralWindowOpen } from '@/lib/overlay/coral';
import { Icon, type IconName, type IconSize } from './Icon';

export type IconButtonVariant = 'plain' | 'ring' | 'filled' | 'toggle';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'onChange'> {
  /** Обов'язкова доступна назва (іконкові кнопки без підпису). */
  'aria-label': string;
  icon: IconName;
  /** `plain` — без заливки · `ring` — кругла з межею («+», «−») · `filled` — коралова (лише звук на телефоні) · `toggle` — `aria-pressed`. */
  variant?: IconButtonVariant;
  /** 44 px; `tv` — 56 px. */
  size?: 'md' | 'tv';
  /** Видимий круг менший (32 px), зона дотику лишається 44. */
  compact?: boolean;
  iconSize?: IconSize;
  /** Для `toggle`: стан натиснутості. */
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  /** Лише для `filled`: нейтральна, коли відкрито вікно з власною коралою (ІНВ 5.3). */
  yieldToCoralWindow?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

const SURFACE: Record<IconButtonVariant | 'neutral', string> = {
  plain: 'border-transparent text-text group-hover:bg-surface-raised',
  ring: 'border-border-strong text-text group-hover:bg-surface-raised',
  filled: 'border-transparent bg-primary-fill text-on-primary group-hover:bg-primary-fill-hover',
  neutral: 'border-border-strong bg-surface-raised text-text group-hover:bg-border',
  toggle: 'border-transparent text-text group-hover:bg-surface-raised group-aria-pressed:border-text group-aria-pressed:bg-surface-raised',
};

const DISABLED = 'group-disabled:border-border group-disabled:bg-transparent group-disabled:text-text-muted group-disabled:group-hover:bg-transparent';

/** P2. Кнопка-іконка: зона дотику 44×44 (ТВ 56) незалежно від розміру видимого кола. */
export function IconButton({
  icon,
  variant = 'plain',
  size = 'md',
  compact = false,
  iconSize,
  pressed,
  onPressedChange,
  yieldToCoralWindow = false,
  className,
  disabled,
  type,
  ref,
  ...rest
}: IconButtonProps) {
  const foreignCoral = useCoralWindowOpen();
  const neutral = variant === 'filled' && yieldToCoralWindow && foreignCoral;
  const key: IconButtonVariant | 'neutral' = neutral ? 'neutral' : variant;
  const glyph: IconSize = iconSize ?? (size === 'tv' ? 22 : 20);
  const box = size === 'tv' ? 'size-14' : 'size-touch-min';
  const circle = compact ? 'size-8' : 'size-full';

  const classes = cn(
    't2f-focus t2f-press t2f-transition group inline-flex shrink-0 items-center justify-center rounded-full',
    box,
    className,
  );
  const inner = (
    <span
      className={cn(
        't2f-transition inline-flex items-center justify-center rounded-full border',
        circle,
        SURFACE[key],
        DISABLED,
      )}
    >
      <Icon name={icon} size={glyph} />
    </span>
  );
  // coral для правила «одна коралова кнопка»: `filled` позначаємо як coral, нейтральну — як neutral
  const dataVariant = variant === 'filled' ? (neutral ? 'neutral' : 'coral') : variant;

  if (variant === 'toggle') {
    return (
      <Toggle.Root
        ref={ref}
        className={classes}
        data-variant={dataVariant}
        pressed={pressed}
        onPressedChange={onPressedChange}
        disabled={disabled}
        {...rest}
      >
        {inner}
      </Toggle.Root>
    );
  }
  return (
    <button ref={ref} type={type ?? 'button'} className={classes} data-variant={dataVariant} disabled={disabled} {...rest}>
      {inner}
    </button>
  );
}

export interface IconLinkProps {
  icon: IconName;
  href: string;
  'aria-label': string;
  size?: 'md' | 'tv';
  iconSize?: IconSize;
  compact?: boolean;
  className?: string;
}

/** Посилання, що виглядає як `IconButton plain` (вхід, профіль): та сама зона дотику 44×44. */
export function IconLink({ icon, href, size = 'md', iconSize, compact = false, className, ...rest }: IconLinkProps) {
  const box = size === 'tv' ? 'size-14' : 'size-touch-min';
  return (
    <NextLink
      href={href}
      data-variant="plain"
      className={cn('t2f-focus t2f-press t2f-transition group inline-flex shrink-0 items-center justify-center rounded-full', box, className)}
      {...rest}
    >
      <span
        className={cn(
          't2f-transition inline-flex items-center justify-center rounded-full border border-transparent text-text group-hover:bg-surface-raised',
          compact ? 'size-8' : 'size-full',
        )}
      >
        <Icon name={icon} size={iconSize ?? (size === 'tv' ? 22 : 20)} />
      </span>
    </NextLink>
  );
}
