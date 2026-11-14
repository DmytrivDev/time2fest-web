'use client';

/**
 * Блоки моменту під рядком дій плеєра (головна, країна, кімната): штамп (окремий блок, кожна сторінка — зі своїми
 * правилами), пропозиція (`OfferBlock`) і місце для вікон у потоці сторінки (`data-moment-slot`: оцінка, тости тощо).
 */
import type { ReactNode } from 'react';
import { OfferBlock } from '@/components/offers/OfferBlock';
import { OverlayInFlowOutlet } from '@/components/shell/OverlayManager';

export function MomentInflow({ stamp, label }: { stamp: ReactNode; label: string }) {
  return (
    <>
      {stamp}
      <OfferBlock />
      <div data-moment-slot="">
        <OverlayInFlowOutlet label={label} />
      </div>
    </>
  );
}
