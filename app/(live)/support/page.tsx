import type { Metadata } from 'next';
import { SupportPage } from '@/components/support/SupportPage';

export const metadata: Metadata = { title: 'Тости світу — Time2Fest' };

/** «Тости світу» (було «Підтримати», рішення власника 2026-11-13) — у макеті `(live)` з чатом праворуч. */
export default function Support() {
  return <SupportPage />;
}
