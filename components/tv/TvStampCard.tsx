'use client';

/**
 * Штамп на ТВ (C22, уточнення 2026-10-23): з’являється в бічній колонці сам, без жодної дії.
 * Листівка зі штемпелем (`StampArt`; alt = текст штемпеля) + QR «Скануй, щоб поділитися» з видимою
 * короткою адресою під кодом. Кнопок немає: поділитися можна лише з телефона через QR.
 * «Перший ряд»: подвійна жовта рамка, як у `Stamp`.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { QRCode } from '@/components/primitives/QRCode';
import { StampArt } from '@/components/windows/StampArt';
import { shareShortUrl, shareUrl } from '@/lib/config/site';
import styles from './tv.module.css';

export interface TvStampCardProps {
  eventId: string;
  /** Місто й країна в називному відмінку. */
  city: string;
  countryName: string;
  illustrationId: string;
  /** Місце в «Першому ряді», якщо гість там сидів. */
  firstRowSeat?: number;
  className?: string;
}

export function TvStampCard({ eventId, city, countryName, illustrationId, firstRowSeat, className }: TvStampCardProps) {
  const t = useTranslations('windows.achievement');
  const tTv = useTranslations('tv');
  const place = `${city}, ${countryName}`;
  const stampText = t('stamped', { city: city.toLocaleUpperCase('uk') });

  const body = (
    <>
      <h2 className="text-tv-title text-text">{t('title', { place })}</h2>
      <div className={styles.stampRow}>
        <div className={styles.stampArt}>
          <StampArt illustrationId={illustrationId} stampText={stampText} />
          <p className="mt-2 text-tv-text text-text">{tTv('scanToShare')}</p>
        </div>
        <QRCode value={shareUrl(eventId)} shortUrl={shareShortUrl(eventId)} alt={tTv('qrAltShare')} size={128} tv />
      </div>
      {firstRowSeat !== undefined ? (
        <p className="flex items-center gap-2 text-tv-text text-highlight" data-row="first-row">
          <Icon name="ticket" size={22} />
          {t('firstRow', { city })}
        </p>
      ) : null}
    </>
  );

  return (
    <section
      aria-label={tTv('stampTitle')}
      data-stamp="tv"
      data-first-row={firstRowSeat !== undefined ? 'true' : undefined}
      className={cn('flex flex-col gap-3 rounded-lg border border-highlight bg-surface-raised', firstRowSeat !== undefined ? 'p-1' : 'p-4', className)}
    >
      {firstRowSeat !== undefined ? (
        <div className="flex flex-col gap-3 rounded-md border border-highlight p-3" data-frame="inner">
          {body}
        </div>
      ) : (
        body
      )}
    </section>
  );
}
