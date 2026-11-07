import type { Metadata } from 'next';
import { PassportPage } from '@/components/passport/PassportPage';

export const metadata: Metadata = { title: 'Мій паспорт Нових років — Time2Fest' };

/**
 * «Мій паспорт Нових років» — у макеті `(live)` з чатом праворуч, як «Мій графік» (рішення власника 2026-11-07):
 * велика листівка, «Поділитися» й пропозиція пасу відкриваються на місці чату.
 */
export default function Passport() {
  return <PassportPage />;
}
