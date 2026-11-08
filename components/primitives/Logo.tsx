import NextLink from 'next/link';
import { cn } from './cn';

export type LogoProps = {
  /** `header` — 112×32 (телефон/десктоп), `footer` — 128×37 (футер, власник 2026-11-08), `tv` — верх бічної колонки ТВ (140×40). */
  variant?: 'header' | 'footer' | 'tv';
  href?: string;
  /** Доступна назва посилання, напр. «Time2Fest — на головну». */
  label: string;
  className?: string;
};

/** Знак Time2Fest — той самий, що на макетах (`/brand/logo.png`, 300×86). */
export function LogoMark({ variant = 'header' }: { variant?: 'header' | 'footer' | 'tv' }) {
  const w = variant === 'tv' ? 140 : variant === 'footer' ? 128 : 112;
  const h = Math.round((w * 86) / 300);
  // eslint-disable-next-line @next/next/no-img-element -- статичний експорт, зображення вже потрібного розміру
  return <img src="/brand/logo.png" alt="" width={w} height={h} className="block" style={{ width: w, height: 'auto' }} />;
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
