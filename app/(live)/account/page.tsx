import type { Metadata } from 'next';
import { AccountPage } from '@/components/account/AccountPage';

export const metadata: Metadata = { title: 'Кабінет — Time2Fest' };

/** Кабінет — у макеті `(live)`: на десктопі праворуч на місці чату меню кабінету (рішення власника 2026-11-08). */
export default function Account() {
  return <AccountPage />;
}
