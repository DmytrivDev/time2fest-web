'use client';

/**
 * Штамп на ТВ (C22, дошка `TV-Party-New` «6 · Північ», рішення 2026-11-06): з’являється в правій колонці сам, без жодної дії.
 * Той самий блок, що на сайті: смужка кольорів прапора з сяйвом, «Новий штамп у паспорті», листівка зі штемпелем
 * (`StampArt`) і поруч — прапор, місто (до 2 рядків; довга назва — меншим шрифтом), «Країна · Новий рік 2027» і QR
 * «Скануй, щоб поділитися» з видимою короткою адресою. Низ QR — на рівні низу листівки. Кнопок немає: поділитися — з телефона.
 */
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { QRCode } from '@/components/primitives/QRCode';
import { StampArt } from '@/components/windows/StampArt';
import st from '@/components/windows/stamp.module.css';
import { shareShortUrl, shareUrl } from '@/lib/config/site';
import { flagGradient } from '@/lib/flags/colors';
import styles from './tv.module.css';

/** Назва довша — меншим шрифтом (кадр «6б»). */
const LONG_CITY = 14;

export interface TvStampCardProps {
  eventId: string;
  /** Місто й країна в називному відмінку. */
  city: string;
  countryName: string;
  flagCode: string;
  illustrationId: string;
  className?: string;
}

export function TvStampCard({ eventId, city, countryName, flagCode, illustrationId, className }: TvStampCardProps) {
  const t = useTranslations('windows.achievement');
  const tTv = useTranslations('tv');
  const stampText = t('stamped', { city: city.toLocaleUpperCase('uk') });
  const strip = flagGradient(flagCode);

  return (
    <section
      aria-label={tTv('stampTitle')}
      data-stamp="tv"
      className={cn(styles.stamp, className)}
    >
      {strip ? (
        <>
          <span aria-hidden="true" className={st.glow} style={{ '--flag': strip } as CSSProperties} />
          <span aria-hidden="true" className={st.strip} style={{ '--flag': strip } as CSSProperties} />
        </>
      ) : null}
      <p className={styles.stampHead}>{t('heading')}</p>
      <div className={styles.stampRow}>
        <div className={styles.stampArt}>
          <StampArt illustrationId={illustrationId} stampText={stampText} />
        </div>
        <div className={styles.stampBody}>
          <div className="flex items-start gap-2.5">
            <Flag code={flagCode} size="md" round decorative className="mt-1 shrink-0" />
            <h2 className={cn(styles.stampCity, city.length > LONG_CITY && styles.stampCityLong)}>{city}</h2>
          </div>
          <p className={styles.stampSub}>{t('subline', { country: countryName })}</p>
          <div className={styles.stampShare}>
            <QRCode value={shareUrl(eventId)} shortUrl={shareShortUrl(eventId)} alt={tTv('qrAltShare')} size={64} urlBeside />
            <p className={styles.stampShareText}>
              {tTv('scanToShare')}
              <span className={styles.stampShareUrl}>{shareShortUrl(eventId)}</span>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
