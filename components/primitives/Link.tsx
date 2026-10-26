import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export type LinkVariant = 'inline' | 'chevron' | 'nav' | 'footer';

export interface LinkProps extends ComponentProps<typeof NextLink> {
  /**
   * `inline` — у тексті, підкреслене · `chevron` — «Обрати трансляцію ›» ·
   * `nav` — хедер (ціль 44 px) · `footer` — рядок щонайменше 44 px на телефоні.
   */
  variant?: LinkVariant;
  /** Для `nav`: поточна сторінка (`aria-current="page"`). */
  current?: boolean;
}

const BASE = 't2f-focus t2f-transition rounded-sm';
const VARIANT: Record<LinkVariant, string> = {
  inline: 'text-text underline underline-offset-2 hover:text-text-secondary',
  chevron: 'inline-flex min-h-touch-min items-center gap-1 text-body-strong text-text hover:text-text-secondary',
  nav: 'inline-flex min-h-touch-min items-center rounded-md px-3 text-body-strong text-text-secondary hover:bg-surface-raised hover:text-text',
  footer: 'flex min-h-touch-min items-center text-caption text-text-muted hover:text-text md:inline-flex',
};

/** P4. Посилання (обгортка Next `Link`). */
export function Link({ variant = 'inline', current, className, children, ...rest }: LinkProps) {
  return (
    <NextLink
      className={cn(BASE, VARIANT[variant], variant === 'nav' && current && 'text-text', className)}
      aria-current={current ? 'page' : undefined}
      data-variant={variant}
      {...rest}
    >
      {children}
      {variant === 'chevron' ? <Icon name="chevron-right" size={16} /> : null}
    </NextLink>
  );
}
