import type { Metadata } from 'next';
import { PassShell } from '@/components/pass/PassShell';
import { PassportPage } from '@/components/passport/PassportPage';

export const metadata: Metadata = { title: 'Мій паспорт Нових років — Time2Fest' };

export default function Passport() {
  return (
    <PassShell passCurrent={false}>
      <PassportPage />
    </PassShell>
  );
}
