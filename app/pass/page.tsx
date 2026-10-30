import type { Metadata } from 'next';
import { PassPage } from '@/components/pass/PassPage';
import { PassShell } from '@/components/pass/PassShell';

export const metadata: Metadata = { title: 'Новорічний пас — Time2Fest' };

export default function Pass() {
  return (
    <PassShell>
      <PassPage />
    </PassShell>
  );
}
