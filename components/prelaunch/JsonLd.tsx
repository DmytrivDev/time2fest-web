import type { Locale } from '@/i18n/locales';
import { jsonLdFor, type MetaPage } from '@/lib/prelaunch/seo';

/** Структуровані дані сторінки (`jsonLdFor`): головна англійською — сайт і організація, решта — хлібні крихти. */
export async function JsonLd({
  locale,
  page,
  crumb,
}: {
  locale: Locale;
  page: MetaPage;
  /** Остання ланка крихт (назва й шлях без мови) — сторінка країни й документи. */
  crumb?: { name: string; path: string };
}) {
  const data = await jsonLdFor(locale, page, crumb);
  if (!data) return null;
  return (
    <>
      {data.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, '\u003c') }}
        />
      ))}
    </>
  );
}
