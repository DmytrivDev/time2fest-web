'use client';

/**
 * C16. OfferCard — спільна оболонка карток-пропозицій (`pass-offer`, `tips`, `pass-gate`, `pass-info`).
 * Піднята поверхня, `rounded-lg`, відступ 16 (десктоп 20 + місце під «×»), заголовок `headline-sm`, «×».
 * Правила: закривається хрестиком з першого дотику й Esc; без затемнення; фокус сам не забирає
 * (картка з’являється в `InFlowSlot` з `aria-live="polite"`); чат на десктопі лишається.
 */
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import { IconButton } from '@/components/primitives/IconButton';

export type OfferVariant = 'pass-offer' | 'tips' | 'pass-gate' | 'pass-info';

export interface OfferCardProps {
  variant: OfferVariant;
  /** Надзаголовок дрібним жовтим над заголовком («Чайові»). */
  kicker?: ReactNode;
  title: ReactNode;
  /** Доступна назва кнопки «×». */
  closeLabel: string;
  onClose?: () => void;
  children?: ReactNode;
  className?: string;
}

/** Esc закриває картку, коли фокус на сторінці (`body`) або всередині картки; чужі діалоги Esc не віддають. */
function useEscapeToClose(ref: RefObject<HTMLElement | null>, onClose?: () => void) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const active = document.activeElement;
      if (active && active !== document.body && !ref.current?.contains(active)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref, onClose]);
}

export function OfferCard({ variant, kicker, title, closeLabel, onClose, children, className }: OfferCardProps) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  useEscapeToClose(ref, onClose);
  return (
    <section
      ref={ref}
      aria-labelledby={titleId}
      data-offer={variant}
      className={cn('relative flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 md:p-5', className)}
    >
      {kicker ? <p className="-mb-2 text-label-sm font-bold uppercase tracking-wider text-highlight">{kicker}</p> : null}
      <h2 id={titleId} className="pe-10 text-headline-sm text-text">
        {title}
      </h2>
      {onClose ? (
        <IconButton icon="close" variant="plain" iconSize={18} aria-label={closeLabel} className="absolute right-0.5 top-0.5" onClick={onClose} />
      ) : null}
      {children}
    </section>
  );
}

/** Рядок під кнопкою «Оформити пас» / «Підтримати»: оплата ще не підключена (імітація, без фальшивої оплати). */
export function PaymentNotice({ children }: { children: ReactNode }) {
  return (
    <p role="status" data-payment-notice="" className="rounded-md bg-surface px-3 py-2 text-caption text-text">
      {children}
    </p>
  );
}
