'use client';

import * as flags from 'country-flag-icons/react/3x2';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import { cn } from './cn';

/** Розміри за ІНВ I-11 (4 штуки): xs чат і чипи, sm рядки й картки, md ТВ і картка мапи, lg герой країни. */
export type FlagSize = 'xs' | 'sm' | 'md' | 'lg';
const DIMENSIONS: Record<FlagSize, { w: number; h: number }> = {
  xs: { w: 16, h: 11 },
  sm: { w: 24, h: 16 },
  md: { w: 30, h: 20 },
  lg: { w: 54, h: 36 },
};

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
  className?: string;
}

function isSpecial(code: string): code is SpecialFlag {
  return (SPECIAL_FLAGS as readonly string[]).includes(code);
}

/** P23. Прапор — SVG, не емодзі; тонка темна обводка однакова для всіх розмірів. */
export function Flag({ code, size = 'sm', name, decorative, className }: FlagProps) {
  const t = useTranslations('primitives.flag');
  const { w, h } = DIMENSIONS[size];
  const style: CSSProperties = { width: w, height: h };
  const hidden = decorative ?? !name;
  const label = name ? t('label', { country: name }) : undefined;

  const common = {
    className: 'block size-full',
    preserveAspectRatio: 'none' as const,
  };

  let art: ReactNode;
  if (isSpecial(code)) {
    art = (
      <svg viewBox="0 0 30 20" {...common}>
        {SPECIAL[code]}
      </svg>
    );
  } else {
    const key = code.replace('-', '_').toUpperCase();
    const Component = (flags as unknown as Record<string, (p: { className?: string }) => ReactNode>)[key];
    art = Component ? (
      Component({ ...common })
    ) : (
      <svg viewBox="0 0 30 20" {...common}>
        <rect width="30" height="20" fill="var(--color-surface-raised)" />
      </svg>
    );
  }

  return (
    <span
      className={cn('relative inline-block shrink-0 overflow-hidden rounded-xs align-middle', className)}
      style={style}
      role={hidden ? undefined : 'img'}
      aria-label={hidden ? undefined : label}
      aria-hidden={hidden ? true : undefined}
      data-flag={code}
      data-size={size}
    >
      {art}
      <span className="pointer-events-none absolute inset-0 rounded-xs ring-1 ring-inset ring-border" aria-hidden="true" />
    </span>
  );
}
