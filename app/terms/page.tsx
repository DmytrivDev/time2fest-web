import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Умови користування — Time2Fest', description: 'Як користуватися сайтом Time2Fest.' };

/** Службова сторінка «Умови користування» (S-LEGAL, дошка `Desk-Legal-New` варіант B, 2026-11-07). */
export default function Page() {
  return <LegalPage id="terms" />;
}
