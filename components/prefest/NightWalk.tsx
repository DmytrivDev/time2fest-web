'use client';

/** «Свято в русі»: годинник півночі обраного поясу в часі відвідувача, прапори країн, повзунок на 38 поясів і «Програти свято». */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Bar } from '@/components/skeleton/parts';
import { Icon } from '@/components/primitives/Icon';
import { Flag } from '@/components/primitives/Flag';
import { cn } from '@/components/primitives/cn';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { clock, dayMonth, utcLabel } from '@/lib/prefest/format';
import { byPreference, countriesMetBefore, type PrefestCountry } from '@/lib/prefest/model';
import { useClientReady, usePrefest } from './PrefestContext';
import n from './NightWalk.module.css';
import s from './prefest.module.css';

const LAST = 37;
const SHOWN = 7;
const bold = { b: (c: ReactNode) => <b>{c}</b> };

export function NightWalk() {
  const t = useTranslations('prefest.night');
  const { model, site } = usePrefest();
  const ready = useClientReady();
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const indexRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const go = (i: number) => {
    indexRef.current = i;
    setIndex(i);
  };
  const togglePlay = () => {
    if (playing) {
      stop();
      return;
    }
    setPlaying(true);
    go(indexRef.current >= LAST ? 0 : indexRef.current);
    timer.current = setInterval(
      () => {
        const next = indexRef.current + 1;
        if (next > LAST) {
          stop();
          return;
        }
        go(next);
      },
      // Передстартовий сайт — трохи швидше (рішення власника 2026-11-19): 38 поясів за ≈ 50 с замість ≈ 72.
      site ? (reduced ? 2000 : 1300) : reduced ? 2600 : 1900,
    );
  };

  const zone = model.zones[index]!;
  const list = useMemo(
    () =>
      zone.countries
        .map((iso) => model.countriesByIso.get(iso))
        .filter((c): c is PrefestCountry => Boolean(c))
        .sort(byPreference),
    [model, zone],
  );
  const met = countriesMetBefore(model, index);
  const utc = utcLabel(zone.offsetMinutes);
  const time = ready ? clock(zone.midnightMs) : '--:--';

  return (
    <section className={cn(s.sec, s.wrap)} id="night" aria-labelledby="night-h">
      <h2 className={s.h2} id="night-h">
        {t('title')}
      </h2>
      <p className={s.intro}>{t('intro')}</p>
      <div className={n.night}>
        <div className={n.stats}>
          <span>{t.rich('statZones', bold)}</span>
          <span>{t.rich('statHours', bold)}</span>
          <span>{t.rich('statCountries', { ...bold, count: model.countries.length })}</span>
        </div>
        <div className={n.grid}>
          <div>
            <span className={n.k}>{t('clockKicker')}</span>
            <div className={n.time}>
              {ready ? time : <Bar className={n.skel} h={[72, 80, 112]} w={[210, 240, 320]} />}
            </div>
            <p className={n.date}>
              {ready ? dayMonth(zone.midnightMs) : <Bar className={n.skel} h={27} w={120} />}
            </p>
            <p className={n.zone}>{t('zoneLine', { utc, n: index + 1 })}</p>
          </div>
          <div>
            <span className={n.k}>{t('nowKicker')}</span>
            <div className={cn(n.flags, reduced && n.still)} key={index}>
              {list.slice(0, SHOWN).map((c) => (
                <span key={c.iso} className={n.pill}>
                  <Flag code={c.flagCode} diameter={24} decorative />
                  {c.name}
                </span>
              ))}
              {list.length > SHOWN ? <span className={cn(n.pill, n.more)}>{t('more', { count: list.length - SHOWN })}</span> : null}
            </div>
            <p className={n.met} aria-live="polite">
              {index === 0 ? t('first') : t.rich('met', { ...bold, zones: index, countries: met })}
            </p>
          </div>
        </div>
        <div className={n.scrub}>
          <div className={n.ticks} aria-hidden="true">
            {model.zones.map((z, k) => (
              <i key={z.id} className={k < index ? n.done : k === index ? n.now : undefined} />
            ))}
          </div>
          <input
            type="range"
            className={n.range}
            min={0}
            max={LAST}
            step={1}
            value={index}
            aria-label={t('rangeAria')}
            aria-valuetext={t('rangeValue', { n: index + 1, utc, time })}
            onChange={(e) => {
              stop();
              go(Number(e.target.value));
            }}
          />
        </div>
        <p className={n.cap}>
          <span>{t('capFirst')}</span>
          <span>{t('capLast')}</span>
        </p>
        <div className={n.controls}>
          <button type="button" className={cn(s.btn, s.btnGhost, s.btnSm)} onClick={togglePlay}>
            <Icon name={playing ? 'pause' : 'play'} size={16} />
            <span>{playing ? t('pause') : t('play')}</span>
          </button>
          <span className={n.hint}>{t('hint')}</span>
        </div>
      </div>
    </section>
  );
}
