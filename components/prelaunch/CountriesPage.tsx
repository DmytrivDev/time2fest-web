'use client';

/**
 * «Країни» мовного дерева: простий перелік усіх 246 країн і територій (без шапки ефіру, мапи, плеєра й чату).
 * Угорі — країни з розповіддю, далі всі за абеткою з часом півночі головного міста за часом відвідувача.
 * Перелік повністю в розмітці (посилання для пошуковиків); пошук лише ховає рядки.
 */
import { useMemo, useState } from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { usePrefest, useClientReady } from '@/components/prefest/PrefestContext';
import { MediaSlot } from '@/components/prefest/SceneCanvas';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import cards from '@/components/prefest/CountryCards.module.css';
import p from '@/components/prefest/prefest.module.css';
import { clock, dayMonth } from '@/lib/prefest/format';
import { searchCountries } from '@/lib/prefest/mine';
import type { PrefestCountry } from '@/lib/prefest/model';
import type { SiteData } from '@/lib/prelaunch/site';
import { SiteShell } from './SiteShell';
import s from './site.module.css';

function Body() {
  const t = useTranslations('prelaunch.countries');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () =>
      new Set(searchCountries(model.countries, query, model.countries.length).map((c) => c.iso)),
    [model, query],
  );

  const midnight = (c: PrefestCountry) =>
    model.zonesById.get((c.main ?? c.zones[0])?.zoneId ?? '')?.midnightMs;
  // До гідратації час відвідувача невідомий — показуємо UTC (той самий рядок бачить і пошуковик).
  const when = (c: PrefestCountry) => {
    const ms = midnight(c);
    if (ms === undefined) return '';
    const tz = ready ? undefined : 'UTC';
    return t('midnightDate', { date: dayMonth(ms, tz), time: clock(ms, tz) });
  };

  return (
    <>
      <div className={cn(p.wrap, s.head)}>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.lead}>{t('lead')}</p>
      </div>

      {model.described.length ? (
        <section className={cn(p.wrap, s.sec)} aria-labelledby="stories-h">
          <h2 className={p.h2} id="stories-h">
            {t('storiesTitle')}
          </h2>
          <p className={s.note}>{t('storiesNote', { count: model.described.length })}</p>
          <div className={cards.grid}>
            {model.described.map((c, i) => (
              <NextLink key={c.iso} href={c.href} className={cards.card}>
                <div className={cards.ph}>
                  <MediaSlot
                    slot={`country:${c.iso}`}
                    item={site?.media[`country:${c.iso}`]}
                    mark
                    seed={20 + i}
                    bursts={3}
                  />
                </div>
                <div className={cards.body}>
                  <span className={cards.who}>
                    <Flag code={c.flagCode} diameter={24} decorative />
                    {c.name}
                  </span>
                  <span className={cards.when}>
                    {c.main?.city ? `${c.main.city} · ${when(c)}` : when(c)}
                  </span>
                  {c.traditions[0] ? (
                    <span
                      className={cards.trad}
                    >{`${c.traditions[0].title} — ${c.traditions[0].text}`}</span>
                  ) : null}
                </div>
              </NextLink>
            ))}
          </div>
        </section>
      ) : null}

      <section className={cn(p.wrap, s.sec)} aria-labelledby="all-h">
        <h2 className={p.h2} id="all-h">
          {t('allTitle')}
        </h2>
        <p className={s.note}>{ready ? t('allNote') : t('allNoteUtc')}</p>
        <label className={s.search}>
          <Icon name="search" size={18} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchLabel')}
            autoComplete="off"
          />
        </label>
        <ul className={s.list}>
          {model.countries.map((c) => (
            <li key={c.iso} hidden={!shown.has(c.iso)}>
              <NextLink href={c.href} className={s.row}>
                <Flag code={c.flagCode} diameter={32} decorative />
                <span className={s.rowText}>
                  <span className={s.rowName}>{c.name}</span>
                  <span className={s.rowWhen}>{when(c)}</span>
                </span>
                {c.described ? (
                  <span className={s.rowStory} title={t('story')}>
                    <Icon name="sparkles" size={16} aria-label={t('story')} />
                  </span>
                ) : null}
              </NextLink>
            </li>
          ))}
        </ul>
        {shown.size === 0 ? (
          <p className={s.empty} role="status">
            {t('empty')}
          </p>
        ) : null}
      </section>
    </>
  );
}

export function CountriesPage({ site }: { site: SiteData }) {
  return (
    <SiteShell site={site} current="countries" page="S-PL-COUNTRIES">
      <Body />
    </SiteShell>
  );
}
