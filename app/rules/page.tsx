import type { Metadata } from 'next';
import { LegalPage } from '@/components/legal/LegalPage';

export const metadata: Metadata = { title: 'Правила чату — Time2Fest', description: 'Як спілкуємося в чаті Time2Fest.' };

/** Службова сторінка «Правила чату» (S-LEGAL, дошка `Desk-Legal-New` варіант B, 2026-11-07). */
export default function Page() {
  return <LegalPage id="rules" />;
}
