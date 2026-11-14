'use client';

/** Розділ «Налаштування» кабінету: формат часу, «Мій пояс», мова, перемикачі паспорта, підказок, тиші, руху. */

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { MENU_LANGUAGES } from '@/components/shell/Menu';
import { profileActions } from '@/lib/api/hooks/auth';
import { getData } from '@/lib/data/load';
import { useAccountStore } from '@/stores/account';
import { useGuestStore } from '@/stores/guest';
import { Row, SaveLine, Seg, Toggle } from './AccountParts';
import { autoHomeIso, countryZones } from './countryZones';
import { useSave } from './useSave';
import { ZonePicker } from './ZonePicker';
import s from './account.module.css';

export function AccountSettings({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('account.settings');
  const sv = useTranslations('account.save');
  const acc = useAccountStore();
  const save = useSave();
  const setting = (patch: Parameters<typeof profileActions.update>[0]['settings']) => void save.run(profileActions.update({ settings: patch }));
  const locale = useGuestStore((g) => g.locale);
  const motion = useGuestStore((g) => g.reducedMotion);
  const setMotion = useGuestStore((g) => g.setReducedMotion);
  const [zoneOpen, setZoneOpen] = useState(false);
  const autoIso = useMemo(() => autoHomeIso(), []);
  const iso = acc.homeCountry ?? autoIso;
  const zones = countryZones(iso);
  const zone = zones.find((z) => z.id === acc.homeZoneId) ?? zones[0];
  const place = `${getData().countriesByIso.get(iso)?.name.uk ?? iso}${zone ? ` · ${zone.label} · ${zone.city}` : ''}`;

  return (
    <section id="settings" aria-labelledby="settings-h" className={s.card}>
      <h2 id="settings-h" className={s.h2}>
        {t('title')}
      </h2>
      <p className={s.lead}>{t('lead')}</p>
      <div className={s.rows}>
        <Row title={t('timeFormat')} hint={t('timeFormatHint')}>
          <Seg
            label={t('timeFormat')}
            value={acc.hour12 ? 'h12' : 'h24'}
            options={[
              { value: 'h24', label: t('h24') },
              { value: 'h12', label: t('h12') },
            ]}
            onChange={(v) => setting({ hour12: v === 'h12' })}
          />
        </Row>
        <Row title={t('zone')} hint={acc.homeCountry ? t('zoneChosen', { place }) : t('zoneAuto', { place })}>
          {zoneOpen ? null : (
            <button type="button" onClick={() => setZoneOpen(true)} className={cn('t2f-focus', s.link)}>
              {t('change')}
            </button>
          )}
        </Row>
        <div className="t2f-reveal" data-open={zoneOpen}>
          <div className="t2f-reveal-inner">{zoneOpen ? <ZonePicker onDone={() => setZoneOpen(false)} /> : null}</div>
        </div>
        <Row title={t('language')} hint={t('languageHint')}>
          <Seg
            label={t('language')}
            value={locale}
            options={MENU_LANGUAGES.map((l) => ({ value: l.code as typeof locale, label: l.name, lang: l.code }))}
            onChange={(v) => useGuestStore.setState({ locale: v })}
          />
        </Row>
        <Toggle label={t('showPassport')} hint={t('showPassportHint')} checked={acc.showPassport} onChange={(v) => setting({ showPassport: v })} />
        <Toggle label={t('showPath')} hint={t('showPathHint')} checked={hasPass && acc.showPath} disabled={!hasPass} onChange={(v) => setting({ showPath: v })} />
        <Toggle label={t('hints')} hint={t('hintsHint')} checked={acc.passportHints} onChange={(v) => setting({ passportHints: v })} />
        <Toggle label={t('quiet')} hint={t('quietHint')} checked={hasPass && acc.quietDefault} disabled={!hasPass} onChange={(v) => setting({ quietDefault: v })} />
        <Toggle label={t('motion')} hint={t('motionHint')} checked={motion} onChange={setMotion} />
      </div>
      <SaveLine state={save.state} failed={sv('settingFailed')} />
    </section>
  );
}
