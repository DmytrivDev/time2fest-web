'use client';

/**
 * Сторінка країни мовного дерева — наявна сторінка країни (`components/country`, дошки `Desk-Country-Full`,
 * `Phone-Country-Full`) без трансляції й чату, у наявних блоках і на тій самій сітці колонки (`live-shell`):
 *   крихти (лише поки немає трансляції — `CountryCrumbs`) · рядок країни `CountryHeader` (кілька поясів — його наявні
 *   чипи / кнопка поясу; один пояс — без них) · на місці відео — сцена відліку `CountdownScene` (як на сайті до
 *   півночі; понад добу — з днями) · «Як святкувати» й «Як <країна> зустрічає Новий рік» (`HowToCard`, одне фото з
 *   автором і ліцензією) — лише для описаних країн · «Питання й відповіді» сторінки країни (без питань про трансляції й
 *   кімнату) · «Того ж часу Новий рік зустрічають» (схвалено власником 2026-11-18).
 * Два стани (`data-state`): «описано» (є розповідь мовою сторінки) і «лише факти» (без розповіді й вигаданих традицій).
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { CountryCrumbs, showCountryCrumbs } from '@/components/country/CountryCrumbs';
import { CountryHeader, type CountryZoneOption } from '@/components/country/CountryHeader';
import { PrefestFaqList } from '@/components/prefest/PrefestFaq';
import { HowToCard } from '@/components/live/HowToCard';
import { ExpectedCards } from './ExpectedCards';
import { CountdownScene } from '@/components/player/CountdownScene';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { mediaAlt, usePrefest } from '@/components/prefest/PrefestContext';
import { Flag } from '@/components/primitives/Flag';
import { hasPostcardScene } from '@/components/stamp/StampArt';
import { cn } from '@/components/primitives/cn';
import shell from '@/app/(live)/live-shell.module.css';
import live from '@/components/live/live.module.css';
import { formatClock } from '@/lib/i18n/time';
import { utcLabel } from '@/lib/map/model';
import { byPreference } from '@/lib/prefest/model';
import { PAGES } from '@/lib/prelaunch/href';
import { SEASON_VALUES } from '@/lib/prelaunch/season';
import type { SiteData } from '@/lib/prelaunch/site';
import { useNow } from '@/lib/time/TimeProvider';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

/** Скільки країн того ж поясу показати посиланнями. */
const NEIGHBORS = 12;

function Body({ iso }: { iso: string }) {
  const t = useTranslations('prelaunch.country');
  const tc = useTranslations('country');
  const tNav = useTranslations('nav');
  const { model, data, site } = usePrefest();
  const now = useNow({ granularity: 'minute' });
  const country = data.countriesByIso.get(iso);
  const pc = model.countriesByIso.get(iso);
  const main = pc?.main ?? pc?.zones[0];
  const [zoneId, setZoneId] = useState<string | undefined>(main?.zoneId);
  const zone = data.zonesById.get(zoneId ?? '');
  const zoneOptions = useMemo<CountryZoneOption[] | undefined>(() => {
    if (!pc || pc.zones.length < 2) return undefined;
    return pc.zones.flatMap((z) => {
      const zz = data.zonesById.get(z.zoneId);
      return zz
        ? [
            {
              id: z.zoneId,
              utc: utcLabel(zz.offsetMinutes),
              city: z.city ?? utcLabel(zz.offsetMinutes),
              midnightMs: zz.midnightMs,
            },
          ]
        : [];
    });
  }, [pc, data]);
  if (!country || !pc || !zone || !site) return null;

  const city = pc.zones.find((z) => z.zoneId === zone.id)?.city ?? country.name.uk;
  // Своя сцена (листівка) є не в усіх країн; без неї — відлік на тлі, без шаблонної листівки.
  const scene = hasPostcardScene(country.illustrationId);
  const heading = t('title', { ...SEASON_VALUES, country: country.name.uk });
  const after = now > 0 && now >= zone.midnightMs;
  const photo = site.media[`country:${iso}`];
  const gallery = photo
    ? [
        {
          src: photo.src,
          alt: mediaAlt(photo, site.locale, t('photoAlt', { country: country.name.uk })),
          author: photo.author ?? '',
          license: photo.license ?? '',
        },
      ]
    : [];
  const faq = (['when', 'stamp'] as const).map((id) => ({
    id,
    question: tc(`faq.items.${id}.q`),
    answer: tc(`faq.items.${id}.a`, { time: formatClock(zone.midnightMs) }),
  }));
  const neighbors = model.zonesById
    .get(zone.id)
    ?.countries.filter((x) => x !== iso)
    .map((x) => model.countriesByIso.get(x))
    .filter((x) => x !== undefined)
    .sort(byPreference)
    .slice(0, NEIGHBORS);

  return (
    <div className={cn(shell.shell, s.solo)}>
      <div className={shell.top}>
        <article className={shell.main} data-state={pc.described ? 'story' : 'facts'}>
          {/* Трансляції на передстартовому сайті немає ніколи — на місці відео сцена відліку, крихти є. */}
          {showCountryCrumbs('countdown-scene') ? (
            <CountryCrumbs
              className={cn(live.pad, 'pb-3')}
              label={t('breadcrumbLabel')}
              links={[
                { label: t('breadcrumbHome'), href: site.href(PAGES.home) },
                { label: t('breadcrumbCountries'), href: site.href(PAGES.countries) },
              ]}
              current={country.name.uk}
            />
          ) : null}
          {/* Як на наявній сторінці країни: H1 для читачів екрана й пошуку, видимий заголовок — рядок країни. */}
          {/* Рядок країни показує той самий заголовок з роком (рішення власника 2026-11-19); крихти й списки — коротко. */}
          <h1 className="sr-only">{heading}</h1>
          <CountryHeader
            country={country}
            midnightMs={zone.midnightMs}
            after={after}
            zones={zoneOptions}
            selectedZoneId={zone.id}
            onZoneChange={setZoneId}
            displayName={heading}
          />
          <PlayerSlot
            id="main"
            className={scene ? s.sceneFit : s.sceneBare}
            fallback={
              <CountdownScene
                country={country}
                cityName={city}
                midnightMs={zone.midnightMs}
                offsetMinutes={zone.offsetMinutes}
                variant="no-stream"
                longCountdown
                art={scene}
                traditions={false}
                note={t('streamSoon')}
              />
            }
          />
          <div className="flex flex-col gap-8 pb-8 pt-8">
            {/* Що саме тут очікується (рішення власника 2026-11-18): тип події й головне місто, без посилань. */}
            {!after ? (
              <ExpectedCards
                country={country.name.uk}
                kinds={site.expectedKinds?.(iso, zone.id) ?? []}
                city={city}
                mediaSlot={model.celebrations.find((c) => c.iso === iso && c.zoneId === zone.id)?.mediaSlot}
                iso={iso}
                illustrationId={country.illustrationId}
                midnightMs={zone.midnightMs}
                className={live.pad}
              />
            ) : null}
            {pc.described ? (
              <HowToCard
                country={country.name.uk}
                traditions={country.howTo.traditions}
                gallery={gallery}
                text={country.howTo.text}
                variant="full"
                className={live.pad}
              />
            ) : null}
            {neighbors?.length ? (
              <section className={live.pad} aria-labelledby="near-h">
                <h2 id="near-h" className="text-headline-sm text-text">
                  {t('neighborsTitle')}
                </h2>
                <ul className={s.chips}>
                  {neighbors.map((c) => (
                    <li key={c.iso}>
                      <NextLink className={s.chipLink} href={c.href}>
                        <Flag code={c.flagCode} diameter={24} decorative />
                        {c.name}
                      </NextLink>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {/* Питання — у самому низу (рішення власника 2026-11-19). */}
            <PrefestFaqList stacks title={tNav('faq')} items={faq} className={live.pad} />
          </div>
        </article>
      </div>
    </div>
  );
}

export function CountryPage({ site, iso }: { site: SiteData; iso: string }) {
  return (
    <SiteShell site={site} current="countries" page="S-PL-COUNTRY">
      <Body iso={iso} />
    </SiteShell>
  );
}
