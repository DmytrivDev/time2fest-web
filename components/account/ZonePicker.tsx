'use client';

/** Вибір країни й поясу «Мій пояс» у налаштуваннях кабінету: пошук країни, радіо поясів, «Готово», «Визначати автоматично». */

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { profileActions } from '@/lib/api/hooks/auth';
import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { useAccountStore } from '@/stores/account';
import { useGuestStore } from '@/stores/guest';
import { countryZones } from './countryZones';
import s from './account.module.css';

export function ZonePicker({ onDone }: { onDone(): void }) {
  const t = useTranslations('account.settings');
  const acc = useAccountStore();
  const autoIso = useMemo(() => (useGuestStore.getState().detectedFlag ?? detectFlag() ?? 'UA').toUpperCase(), []);
  const [iso, setIso] = useState(acc.homeCountry ?? autoIso);
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const data = getData();
  const country = data.countriesByIso.get(iso);
  const zones = countryZones(iso);
  // Порожній пошук — увесь список (поточна країна першою), а не порожнє поле без підказок (перевірка дошок 2026-11-14).
  const all = useMemo(() => [...data.countries].sort((a, b) => a.name.uk.localeCompare(b.name.uk, 'uk')), [data]);
  const found = query.trim()
    ? data.countries.filter((x) => x.name.uk.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 8)
    : [...all.filter((x) => x.iso === iso), ...all.filter((x) => x.iso !== iso)];
  const zoneId = acc.homeCountry === iso && acc.homeZoneId ? acc.homeZoneId : zones[0]?.id;

  return (
    <div className={s.picker} data-block="zone-picker">
      <div className={s.label}>{t('country')}</div>
      {picking ? (
        <div className={s.search}>
          <input
            ref={(el) => el?.focus()}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setPicking(false);
                setQuery('');
              }
            }}
            placeholder={t('countrySearch')}
            aria-label={t('countrySearch')}
            className="t2f-nk-input"
          />
          {found.length ? (
            <ul className={cn(s.options, !query.trim() && s.optionsAll)} data-list={query.trim() ? 'found' : 'all'}>
              {found.map((x) => (
                <li key={x.iso}>
                  <button
                    type="button"
                    onClick={() => {
                      setIso(x.iso);
                      setPicking(false);
                      setQuery('');
                      const z = countryZones(x.iso);
                      void profileActions.update({ settings: { homeCountry: x.iso } });
                      void profileActions.update({ settings: { homeZoneId: z[0]?.id ?? null } });
                    }}
                    className={cn('t2f-focus t2f-transition', s.option)}
                  >
                    <Flag code={x.flagCode} size="sm" decorative />
                    {x.name.uk}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} className={cn('t2f-focus t2f-transition', s.countryBtn)}>
          {country ? <Flag code={country.flagCode} size="sm" decorative /> : null}
          <span className={s.countryName}>{country?.name.uk ?? iso}</span>
          <Icon name="chevron-down" size={16} className={s.chev} />
        </button>
      )}
      {zones.length > 1 ? (
        <>
          <div className={s.label} style={{ marginTop: '0.875rem' }}>
            {t('zonePick', { count: zones.length })}
          </div>
          <div role="radiogroup" aria-label={t('zone')} className={s.zones}>
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                role="radio"
                aria-checked={z.id === zoneId}
                onClick={() => {
                  void profileActions.update({ settings: { homeCountry: iso } });
                  void profileActions.update({ settings: { homeZoneId: z.id } });
                }}
                className={cn('t2f-focus t2f-transition', s.zone)}
              >
                <span className={s.zoneUtc}>{z.label}</span>
                <span className={s.zoneCity}>{z.city}</span>
                {z.id === zoneId ? <Icon name="check" size={16} className={s.zoneCheck} /> : null}
              </button>
            ))}
          </div>
        </>
      ) : zones[0] ? (
        <p className={s.hint}>{t.rich('zoneOne', { zone: `${zones[0].label} · ${zones[0].city}`, b: (x) => <b>{x}</b> })}</p>
      ) : null}
      <div className={s.inlineActs}>
        <button type="button" onClick={onDone} className={cn('t2f-focus t2f-transition', s.btn, s.line)}>
          {t('done')}
        </button>
        <button
          type="button"
          onClick={() => {
            void profileActions.update({ settings: { homeCountry: null } });
            void profileActions.update({ settings: { homeZoneId: null } });
            setIso(autoIso);
          }}
          className={cn('t2f-focus', s.link)}
        >
          <Icon name="map" size={16} />
          {t('auto')}
        </button>
      </div>
    </div>
  );
}
