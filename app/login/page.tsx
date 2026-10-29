import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/AuthPage';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Увійти — Time2Fest' };

export default function LoginPage() {
  return (
    <AuthShell>
      <AuthPage mode="signin" />
    </AuthShell>
  );
}
