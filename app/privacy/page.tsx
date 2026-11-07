import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Політика конфіденційності — Time2Fest', description: 'Які дані збирає Time2Fest і навіщо.' };

/** Службова сторінка «Політика конфіденційності» (S-LEGAL, дошка `Desk-Legal-New` варіант B, 2026-11-07). */
export default function Page() {
  return <LegalPage id="privacy" />;
}
