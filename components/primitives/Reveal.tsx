'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export interface RevealProps {
  open: boolean;
  id?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Плавне розкриття вмісту акордеона чи «розгорнути» (правило власника 2026-10-30: усі акордеони на сайті
 * відкриваються плавно). Висота анімується через `grid-template-rows: 0fr → 1fr` (`.t2f-reveal` у primitives.css);
 * «Зменшити рух» — без анімації. Згорнутий вміст лишається в DOM, але `inert` і схований від читачів екрана.
 * Для Radix Accordion / Collapsible — клас `t2f-acc-content` на `Content`.
 */
export function Reveal({ open, id, className, children }: RevealProps) {
  return (
    <div id={id} className={cn('t2f-reveal', className)} data-open={open} aria-hidden={!open || undefined} inert={!open || undefined}>
      <div className="t2f-reveal-inner">{children}</div>
    </div>
  );
}
