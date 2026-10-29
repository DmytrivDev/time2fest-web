import type { Metadata } from 'next';
import { AuthPage } from '@/components/auth/AuthPage';
import { AuthShell } from '@/components/auth/AuthShell';

export const metadata: Metadata = { title: 'Створити акаунт — Time2Fest' };

export default function SignupPage() {
  return (
    <AuthShell>
      <AuthPage mode="signup" />
    </AuthShell>
  );
}
