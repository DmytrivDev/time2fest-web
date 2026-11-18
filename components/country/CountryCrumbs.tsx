/**
 * Хлібні крихти сторінки країни: «Головна › Країни › Японія».
 *
 * Правило власника (2026-11-18): крихти є, поки на сторінці немає трансляції — коли видно сцену відліку або лише
 * відлік; коли йде трансляція — їх немає (над відео важливий кожен піксель). Передстартовий сайт трансляцій не має, тож
 * там крихти є завжди. Повний сайт (`CountryLive`) може поставити цей самий компонент над сценою й показувати його за
 * `showCountryCrumbs()` — сам повний сайт поки не змінено.
 */
import NextLink from 'next/link';

export interface CrumbLink {
  label: string;
  href: string;
}

/** Показувати крихти: на місці відео — сцена відліку чи лише відлік, а не трансляція. */
export function showCountryCrumbs(
  videoArea:
    'video' | 'countdown-scene' | 'expected-scene' | 'loading' | 'facebook-consent' | 'waiting',
): boolean {
  return videoArea !== 'video';
}

export function CountryCrumbs({
  label,
  links,
  current,
  className,
}: {
  label: string;
  links: CrumbLink[];
  current: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={className}>
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 text-label-sm text-text-secondary">
        {links.map((l) => (
          <li key={l.href} className="flex items-center gap-2">
            <NextLink href={l.href} className="t2f-focus rounded-sm hover:text-text">
              {l.label}
            </NextLink>
            <span aria-hidden="true">›</span>
          </li>
        ))}
        <li aria-current="page" className="text-text">
          {current}
        </li>
      </ol>
    </nav>
  );
}
