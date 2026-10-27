'use client';

import { useTranslations } from 'next-intl';

/** Заглушка сторінки «Умови й правила чату» (`/rules/`): текст правил буде додано окремо. */
export function RulesContent() {
  const t = useTranslations('chat.nick');
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-16">
      <h1 className="text-headline-lg">{t('rulesTitle')}</h1>
      <p className="text-body text-text-secondary">{t('rulesPlaceholder')}</p>
    </main>
  );
}
