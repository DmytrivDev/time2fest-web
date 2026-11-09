/**
 * P28. Фірмовий емодзі (рішення власника 2026-10-31, дошка `Desk-Emoji-Brand`). Малюємо наш значок (`public/emoji`),
 * а під ним лишаємо стандартний символ прозорим текстом: виділення й копіювання дають звичайний емодзі (🥂),
 * пошук і переклад бачать символ. Символ поза набором — як є (системний).
 * - `Emoji` — один символ; `label` — доступна назва (без неї — декоративний, зчитувач читає текст поруч).
 * - `EmojiText` — рядок, де відомі емодзі замінено значками (повідомлення чату, привітання).
 */
import { Fragment, type ReactNode } from 'react';
import { BRAND_EMOJI } from '@/lib/emoji/brand';
import { cn } from './cn';

const strip = (s: string) => s.replace(/️/g, '');

export function brandEmoji(char: string) {
  return BRAND_EMOJI[strip(char)];
}

/** Адреса значка для символу або `undefined`, якщо його немає в наборі. */
export function brandEmojiSrc(char: string): string | undefined {
  const e = brandEmoji(char);
  return e ? `/emoji/${e.file}.svg` : undefined;
}

export interface EmojiProps {
  char: string;
  /** Розмір, px (за замовчуванням — 1.25em від тексту). */
  size?: number;
  /** Назва для зчитувача; без неї емодзі декоративний. */
  label?: string;
  className?: string;
}

export function Emoji({ char, size, label, className }: EmojiProps) {
  const src = brandEmojiSrc(char);
  // У rem — масштабується разом із кеглем кореня (пропорційний макет, 2026-11-09).
  const dim = size ? `${size / 16}rem` : '1.25em';
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true as const };
  if (!src) {
    return (
      <span className={cn('t2f-emoji t2f-emoji-native', className)} data-emoji={char} style={size ? { fontSize: `${(size * 0.85) / 16}rem` } : undefined} {...a11y}>
        {char}
      </span>
    );
  }
  return (
    <span className={cn('t2f-emoji', className)} data-emoji={char} style={{ width: dim, height: dim }} {...a11y}>
      {/* Статичний SVG з нашого домену: next/image зайвий (експорт без оптимізації). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" draggable={false} decoding="async" className="t2f-emoji-img" />
      <span className="t2f-emoji-char">{char}</span>
    </span>
  );
}

/** Емодзі-послідовності (з модифікаторами, ZWJ, прапорами) — щоб не розрізати складені символи. */
const EMOJI_RE = /(\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/u;

/** Текст із фірмовими емодзі замість відомих символів; решта тексту й невідомі емодзі — як є. */
export function EmojiText({ text, size }: { text: string; size?: number }): ReactNode {
  const parts = text.split(EMOJI_RE);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 && brandEmoji(p) ? <Emoji key={i} char={p} size={size} /> : <Fragment key={i}>{p}</Fragment>,
  );
}
