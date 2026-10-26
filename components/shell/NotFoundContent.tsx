'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import NextLink from 'next/link';
import { StatusPage } from './StatusPage';

/** Посилання в кнопках — `next/link`, а не примітив `Link`: його колір і накреслення перекривали кнопкові (контраст коралової 3,8:1).
 * 404 (Phone-404, Desk-404): одна коралова дія — «На головну»; «Список країн» — другорядна. */
export function NotFoundContent() {
  const t = useTranslations('states');
  return (
    <StatusPage icon="globe" title={t('notFound')} text={t('notFoundHint')}>
      <Button variant="coral" size="lg" asChild>
        <NextLink href="/">{t('toHome')}</NextLink>
      </Button>
      <Button variant="secondary" size="lg" asChild>
        <NextLink href="/countries">{t('toCountries')}</NextLink>
      </Button>
    </StatusPage>
  );
}
