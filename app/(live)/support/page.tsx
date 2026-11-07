import type { Metadata } from 'next';
import { SupportPage } from '@/components/support/SupportPage';

export const metadata: Metadata = { title: 'Підтримати — Time2Fest' };

/** «Підтримати» — у макеті `(live)` з чатом праворуч (рішення власника 2026-11-07, дошка `Desk-Support-New`, варіант A). */
export default function Support() {
  return <SupportPage />;
}
