'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * Розміри — діаметр кола (`ROUND_DIAMETER`): xs чат і чипи, card картки «Зараз і далі», pill фішки з ім’ям, sm рядки,
 * md ТВ і картка мапи, lg герой країни, xl шапка панелі автора.
 */
export type FlagSize = 'xs' | 'card' | 'pill' | 'sm' | 'md' | 'lg' | 'xl';

/** Особливі прапори (O-NICK), яких немає в бібліотеці країн. */
export type SpecialFlag = 'earth' | 'un' | 'pride' | 'trans' | 'bisexual';
export const SPECIAL_FLAGS: readonly SpecialFlag[] = ['earth', 'un', 'pride', 'trans', 'bisexual'];

const SPECIAL: Record<SpecialFlag, ReactNode> = {
  earth: (
    <>
      <rect width="30" height="20" fill="#1a3a6b" />
      <circle cx="15" cy="10" r="7" fill="#2c6bb3" />
      <path d="M11 6c2 0 3 1.5 2.5 3S11 11 12 13M17 5c2 1 3.5 2 3.5 4.5S19 14 17 14" fill="none" stroke="#5aa86a" strokeWidth="1.6" />
    </>
  ),
  un: (
    <>
      <rect width="30" height="20" fill="#5b92e5" />
      <circle cx="15" cy="10" r="6" fill="none" stroke="#fff" strokeWidth="1.2" />
      <path d="M15 4v12M9 10h12M10.5 6.5c3 2 6 2 9 0M10.5 13.5c3-2 6-2 9 0" fill="none" stroke="#fff" strokeWidth="0.8" />
    </>
  ),
  pride: (
    <>
      <rect width="30" height="20" fill="#e40303" />
      <rect y="3.33" width="30" height="3.34" fill="#ff8c00" />
      <rect y="6.67" width="30" height="3.33" fill="#ffed00" />
      <rect y="10" width="30" height="3.33" fill="#008026" />
      <rect y="13.33" width="30" height="3.34" fill="#24408e" />
      <rect y="16.67" width="30" height="3.33" fill="#732982" />
    </>
  ),
  trans: (
    <>
      <rect width="30" height="20" fill="#5bcefa" />
      <rect y="4" width="30" height="12" fill="#f5a9b8" />
      <rect y="8" width="30" height="4" fill="#fff" />
    </>
  ),
  bisexual: (
    <>
      <rect width="30" height="20" fill="#d60270" />
      <rect y="8" width="30" height="12" fill="#9b4f96" />
      <rect y="12" width="30" height="8" fill="#0038a8" />
    </>
  ),
};

export interface FlagProps {
  /** ISO 3166-1 alpha-2 (`UA`), `GB-ENG`/`GB-SCT`/`GB-WLS`, `EU` або особливий прапор (`earth`, `un`, `pride`, …). */
  code: string;
  size?: FlagSize;
  /** Назва країни мовою інтерфейсу (без відмінювання): «Прапор: <країна>». */
  name?: string;
  /** Поруч є текст з назвою — прапор лише прикраса (aria-hidden). */
  decorative?: boolean;
  /** Діаметр у px замість розміру за `size` (підказка мапи: 22 і 24). */
  diameter?: number;
  className?: string;
}

/** Діаметр кола: `xs` — 16 px, як ширина колишнього прямокутного на макетах чату. */
const ROUND_DIAMETER: Record<FlagSize, number> = { xs: 16, card: 16, pill: 18, sm: 20, md: 26, lg: 48, xl: 40 };

/** Шлях до круглого прапора (`public/flags/round`) або `null` для особливих без файлу — для фону аватара в шапці. */
export function roundFlagSrc(code: string): string | null {
  const f = roundFile(code);
  return f ? `/flags/round/${f}.svg` : null;
}

/** Файл у `public/flags/round`: ISO — малими, `GB-ENG` → `gb-eng`, `EU` → `eu`, `un` — ООН; решта особливих — власні SVG. */
function roundFile(code: string): string | null {
  if (code === 'un') return 'un';
  if (isSpecial(code)) return null;
  return code.toLowerCase();
}

function isSpecial(code: string): code is SpecialFlag {
  return (SPECIAL_FLAGS as readonly string[]).includes(code);
}

/**
 * P23. Прапор — SVG, не емодзі, завжди круглий (пакет `circle-flags`, файли в `public/flags/round`; рішення власника
 * 2026-11-13 «усі прапори на сайті — круглі», прямокутний варіант прибрано); тонка темна обводка однакова для всіх розмірів.
 */
export function Flag({ code, size = 'sm', name, decorative, diameter, className }: FlagProps) {
  const t = useTranslations('primitives.flag');
  const hidden = decorative ?? !name;
  const label = name ? t('label', { country: name }) : undefined;
  const d = diameter ?? ROUND_DIAMETER[size];
  const file = roundFile(code);
  return (
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden rounded-full align-middle', className)}
      style={{ width: d, height: d }}
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden ? true : undefined}
      data-flag={code}
      data-size={size}
      data-round="true"
    >
      {file ? (
        // Статичний SVG із нашого домену: next/image для нього зайвий (експорт без оптимізації).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/flags/round/${file}.svg`} alt="" draggable={false} decoding="async" className="block size-full" />
      ) : (
        // Власні особливі прапори — кадр 20×20 із середини прямокутного (30×20), заокруглений контейнером.
        <svg viewBox="5 0 20 20" className="block size-full" preserveAspectRatio="xMidYMid slice">
          {SPECIAL[code as SpecialFlag]}
        </svg>
      )}
      <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset ring-border" aria-hidden="true" />
    </span>
  );
}
