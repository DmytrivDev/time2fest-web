'use client';

/**
 * «Скажи тост за $10 · …і Новорічний пас у подарунок» (дошка `Pass-5-New`, рішення власника 2026-11-12): рядок у вікні
 * пасу (між можливостями й оформленням) і на сторінці пасу — інший шлях до пасу. Вікно (є `OverlayManager`) — вікно
 * тосту з обраними $10; сторінка `/pass/` (поза макетом трансляцій, вікон там немає) — перехід на «Підтримати»
 * (`/support/?toast=10`), де вікно тосту відкривається одразу з $10.
 */
import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { formatUsd } from '@/lib/offers/format';
import { useOpenToastWindow } from './ToastWindow';
import s from './toast.module.css';

/** Адреса «Підтримати» з відкритим вікном тосту на $10. */
export const SUPPORT_TOAST_10_HREF = '/support/?toast=10';

function Body() {
  const t = useTranslations('toast.passRow');
  return (
    <>
      <span aria-hidden="true" className={s.giftIcon}>
        <Icon name="glass" size={18} />
      </span>
      <span className={s.giftText}>
        <span className={s.giftTitle}>{t('title', { price: formatUsd(10) })}</span>
        <span className={s.giftSub}>{t('text')}</span>
      </span>
      <span aria-hidden="true" className={s.giftArrow}>
        <Icon name="chevron-right" size={16} />
      </span>
    </>
  );
}

function WindowRow({ className }: { className?: string }) {
  const open = useOpenToastWindow();
  return (
    <button type="button" onClick={() => open({ tier: 10 })} className={cn('t2f-focus', s.gift, className)} data-row="toast-gift">
      <Body />
    </button>
  );
}

export function ToastGift({ variant, className }: { variant: 'window' | 'page'; className?: string }): ReactNode {
  if (variant === 'window') return <WindowRow className={className} />;
  return (
    <NextLink href={SUPPORT_TOAST_10_HREF} className={cn('t2f-focus', s.gift, className)} data-row="toast-gift">
      <Body />
    </NextLink>
  );
}
