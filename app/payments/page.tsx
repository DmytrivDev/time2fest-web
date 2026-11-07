import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Оплата й повернення — Time2Fest', description: 'Ціни, оплата через PayPro Global і повернення.' };

/** Службова сторінка «Оплата й повернення» (S-LEGAL, дошка `Desk-Legal-New` варіант B, 2026-11-07). */
export default function Page() {
  return <LegalPage id="payments" />;
}
