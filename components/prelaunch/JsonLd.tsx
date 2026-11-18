import type { Locale } from '@/i18n/locales';
import { jsonLdFor, type MetaPage } from '@/lib/prelaunch/seo';

/** Місце для структурованих даних сторінки: нічого не малює, доки `jsonLdFor` порожній (заповнює задача B). */
export function JsonLd({
  locale,
  page,
  values,
}: {
  locale: Locale;
  page: MetaPage;
  values?: Record<string, string>;
}) {
  const data = jsonLdFor(locale, page, values);
  if (!data) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
