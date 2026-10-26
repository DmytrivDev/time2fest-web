'use client';

import { ErrorContent } from '@/components/shell/ErrorContent';
import { StaticShell } from '@/components/shell/StaticShell';

/** Помилка в сторінці: корінь макета (шрифт, провайдер i18n) лишається, хедер і футер малює сама сторінка помилки. */
export default function Error({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <StaticShell>
      <ErrorContent onRetry={retry} />
    </StaticShell>
  );
}
