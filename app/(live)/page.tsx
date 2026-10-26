import { useTranslations } from 'next-intl';

export default function LivePage() {
  const t = useTranslations('stub');
  return (
    <main>
      <h1 className="text-headline-lg">{t('title')}</h1>
      <p className="text-body">{t('welcome', { gender: 'f', name: 'Японія' })}</p>
    </main>
  );
}
