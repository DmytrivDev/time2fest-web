'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import NextLink from 'next/link';
import { StatusPage } from './StatusPage';

/** Помилка (Phone-Error): єдина коралова дія — «Спробувати ще раз»; «На головну» — другорядна. */
export function ErrorContent({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('states');
  return (
    <StatusPage icon="alert" title={t('errorTitle')} text={t('errorHint')}>
      <Button variant="coral" size="lg" onClick={onRetry}>
        {t('errorRetry')}
      </Button>
      <Button variant="secondary" size="lg" asChild>
        <NextLink href="/">{t('toHome')}</NextLink>
      </Button>
    </StatusPage>
  );
}
