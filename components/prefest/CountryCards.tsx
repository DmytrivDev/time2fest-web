'use client';

/** «Як зустрічають Новий рік у світі»: картки лише описаних країн (правило розкладки — `lib/prefest/countryCards`). */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Bar } from '@/components/skeleton/parts';
import { Flag } from '@/components/primitives/Flag';
import { cn } from '@/components/primitives/cn';
import { cardLayout, showDescribedCount, soonFlagIsos } from '@/lib/prefest/countryCards';
import { clock } from '@/lib/prefest/format';
import { useClientReady, usePrefest } from './PrefestContext';
import { MediaSlot } from './SceneCanvas';
import c from './CountryCards.module.css';
import s from './prefest.module.css';


export function CountryCards() {
  const t = useTranslations('prefest.countries');
  const tSite = useTranslations('prelaunch.home');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const layout = cardLayout(model.described.length);
  if (!layout.visible) return null;

  const cards = model.described.slice(0, layout.cards);
  const soonIsos = soonFlagIsos(model.described.map((x) => x.iso));
  const soonFlags = soonIsos.map((iso) => model.countriesByIso.get(iso)).filter((x) => x !== undefined);

  return (
    <section className={cn(s.sec, s.wrap)} id="countries" aria-labelledby="cc-h">
      <div className={s.secHead}>
        <div>
          <h2 className={s.h2} id="cc-h">
            {t('title')}
          </h2>
          {/* Мовне дерево: поруч із «246 країн і територій» пояснюємо, чому карток лише сім (план, розділ 9, п. 9). */}
          {site ? <p className={s.intro}>{tSite('cardsNote', { count: model.described.length })}</p> : null}
        </div>
        <NextLink className={s.link} href={site ? site.href('/countries/') : '/countries/'}>
          {site
            ? tSite('allCountries')
            : showDescribedCount(model.described.length)
              ? t('allCount', { count: model.described.length })
              : t('all')}
          <span aria-hidden="true">›</span>
        </NextLink>
      </div>
      <div className={cn(c.grid, layout.columns === 2 && c.two)}>
        {cards.map((country, i) => {
          // Мовне дерево: місто, час і текст — про одне місце (головне місто країни), а не про перший пояс країни.
          const first = country.main ?? country.zones[0];
          const zone = first ? model.zonesById.get(first.zoneId) : undefined;
          const time = ready && zone ? clock(zone.midnightMs) : '--:--';
          const bold = {
            b: (x: React.ReactNode) => (ready && zone ? <b>{x}</b> : <Bar className={c.skel} h={14} w={40} />),
          };
          const trad = country.traditions[0];
          return (
            <NextLink key={country.iso} href={country.href} className={c.card}>
              <div className={c.ph}>
                <MediaSlot slot={`country:${country.iso}`} item={site?.media[`country:${country.iso}`]} mark={Boolean(site)} seed={20 + i} bursts={3} />
                {site ? null : <span className={cn(s.chip, c.chipPos)}>{t('stockChip')}</span>}
              </div>
              <div className={c.body}>
                <span className={c.who}>
                  <Flag code={country.flagCode} diameter={24} decorative />
                  {country.name}
                </span>
                <span className={c.when}>
                  {first?.city ? t.rich('when', { ...bold, city: first.city, time }) : t.rich('whenNoCity', { ...bold, time })}
                </span>
                {trad ? <span className={c.trad}>{`${trad.title} — ${trad.text}`}</span> : null}
              </div>
            </NextLink>
          );
        })}
        {layout.soon ? (
          <div className={cn(c.card, c.soon)}>
            <span className={c.stack} aria-hidden="true">
              {soonFlags.map((f) => (
                <span key={f.iso}>
                  <Flag code={f.flagCode} diameter={30} decorative />
                </span>
              ))}
            </span>
            <b>{t('soonTitle')}</b>
            <span>{t('soonText')}</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
