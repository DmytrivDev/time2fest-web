import NextLink from 'next/link';
import { cn } from './cn';

export type LogoProps = {
  /** `header` — 112×32 (телефон/десктоп), `tv` — верх бічної колонки ТВ (140×40). */
  variant?: 'header' | 'tv';
  href?: string;
  /** Доступна назва посилання, напр. «Time2Fest — на головну». */
  label: string;
  className?: string;
};

/** Знак Time2Fest: слово з жовтою «2». Розмір задано атрибутами SVG. */
export function LogoMark({ variant = 'header' }: { variant?: 'header' | 'tv' }) {
  const w = variant === 'tv' ? 140 : 112;
  const h = variant === 'tv' ? 40 : 32;
  return (
    <svg width={w} height={h} viewBox="0 0 112 32" aria-hidden="true" focusable="false" className="block">
      <text
        x="0"
        y="23"
        fontFamily="var(--font-manrope), var(--font-sans)"
        fontWeight="700"
        fontSize="22"
        fill="var(--color-text)"
      >
        Time
        <tspan fill="var(--color-highlight)">2</tspan>
        Fest
      </text>
    </svg>
  );
}

/** P33. Посилання на головну; ціль щонайменше 44 px, фокус двошаровий. */
export function Logo({ variant = 'header', href = '/', label, className }: LogoProps) {
  return (
    <NextLink
      href={href}
      aria-label={label}
      className={cn('t2f-focus inline-flex min-h-touch-min items-center rounded-sm text-text', className)}
    >
      <LogoMark variant={variant} />
    </NextLink>
  );
}
