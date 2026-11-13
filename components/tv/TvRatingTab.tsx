'use client';

/**
 * Вкладка «Рейтинг» режиму вечірки (дошка `Desk-Rating-New` v2, рішення власника 2026-11-07): топ-5 «Рейтингу святкувань»
 * (медаль, прапор, місто, смужка, оцінка) і QR «Оціни з телефона». Оцінювати на ТВ не можна — лише з телефона.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { Flag } from '@/components/primitives/Flag';
import { QRCode } from '@/components/primitives/QRCode';
import { RATING_SHORT_URL, RATING_URL } from '@/lib/config/site';
import { getData } from '@/lib/data/load';
import type { Ms } from '@/lib/data/types';
import { formatDurationShort } from '@/lib/i18n/time';
import { ratingState } from '@/lib/rating/rating';
import { useGuestStore } from '@/stores/guest';
import styles from './tv.module.css';

const TOP = 5;
const dec = (n: number) => n.toFixed(1).replace('.', ',');

export function TvRatingTab({ now }: { now: Ms }) {
  const t = useTranslations('tv');
  const rate = useGuestStore((g) => g.rate);
  const minute = Math.floor(now / 60_000) * 60_000;
  const state = useMemo(() => ratingState(getData(), minute, rate), [minute, rate]);
  const top = state.rows.slice(0, TOP);
  return (
    <div data-tv-rating="" className="flex flex-col">
      <h3 className={styles.frTitle}>
        {t('ratingHeading')}
        <span className={styles.rtClose}>{state.closed ? t('ratingClosed') : t('ratingCloses', { time: formatDurationShort(state.closeAt - now) })}</span>
      </h3>
      {top.length ? (
        <ol className={styles.rtList}>
          {top.map((r) => (
            <li key={r.eventId} className={styles.rtRow} data-place={r.place <= 3 ? r.place : undefined}>
              <span className={styles.rtMedal}>{r.place}</span>
              <Flag code={r.flagCode} diameter={28} decorative />
              <span className={styles.rtCity}>
                <span className={styles.rtName}>{r.city}</span>
                <span aria-hidden="true" className={styles.rtBar}>
                  <span style={{ width: `${Math.round((r.score / 5) * 100)}%` }} />
                </span>
              </span>
              <span className={styles.rtScore}>{dec(r.score)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.frSub}>{t('ratingEmpty')}</p>
      )}
      {state.closed ? null : (
        <div className={styles.rtQr} data-tv-rate-qr="">
          <QRCode value={RATING_URL} shortUrl={RATING_SHORT_URL} alt={t('qrAltRate')} size={104} urlBeside />
          <div className="min-w-0">
            <p className={styles.promoLead}>{t('rateFromPhone')}</p>
            <p className={styles.promoUrl}>{RATING_SHORT_URL}</p>
          </div>
        </div>
      )}
    </div>
  );
}
