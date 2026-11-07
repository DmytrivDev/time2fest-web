import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Cookies — Time2Fest', description: 'Які cookies використовує Time2Fest і як змінити вибір.' };

/** Службова сторінка «Cookies» (S-LEGAL, дошка `Desk-Legal-New` варіант B, 2026-11-07). */
export default function Page() {
  return <LegalPage id="cookies" />;
}
