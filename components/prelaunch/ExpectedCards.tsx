'use client';

/**
 * «Трансляції · Франція» передстартового сайту (рішення власника 2026-11-19): ті самі картки, що на сторінці країни
 * сайту свята (`components/live/StreamCards`, стилі `streamCards.module.css`), — зображення згори, мітка «Очікується»
 * в куті, назва, «Головне святкування · 01:00». Замість мініатюри відео — фото місця чи країни з відкритою ліцензією
 * (`data/prelaunch/media.json`: `city:<id>`, потім `country:<ISO>`); поки фото немає — наявна листівка країни. Країни, де
 * трансляцій не показуємо (Росія, Білорусь), — наявна картка «Лише відлік». Без кнопок і посилань: до запуску дивитися ще
 * нічого; мовника як плеєр не обіцяємо.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { mediaAlt, usePrefest, type MediaItem } from '@/components/prefest/PrefestContext';
import type { ExpectedKind } from '@/components/map/mapPrefest';
import { PostcardArt } from '@/components/stamp/StampArt';
import { formatClock } from '@/lib/i18n/time';
import { usePhone } from '@/lib/hooks/useMedia';
import s from '@/components/live/streamCards.module.css';

export function ExpectedCards({
  country,
  kinds,
  city,
  mediaSlot,
  photo: photoProp,
  illustrationId,
  midnightMs,
  className,
}: {
  country: string;
  kinds: readonly ExpectedKind[];
  city: string;
  /** Місце для фото міста з розкладу головної (`city:<id>`), якщо це його пояс. */
  mediaSlot?: string | undefined;
  /** Фото одиниці (поясу чи країни), яке вибрала сторінка; без нього — фото міста з розкладу. */
  photo?: MediaItem | undefined;
  illustrationId: string;
  midnightMs: number;
  className?: string;
}) {
  const t = useTranslations('country.streams');
  const te = useTranslations('prefest.map.expected');
  const { site } = usePrefest();
  const phone = usePhone();
  const photo = photoProp ?? (mediaSlot ? site?.media[mediaSlot] : undefined);
  const countdown = kinds.includes('countdown');
  // Немає підтвердженого джерела — одна картка з нейтральним «Трансляція» (рішення 2026-11-18).
  const cards: readonly (ExpectedKind | null)[] = countdown ? ['countdown'] : kinds.length ? kinds : [null];
  const time = formatClock(midnightMs);

  const thumb = (kind: ExpectedKind | null) => (
    <span className={s.thumb} aria-hidden={photo && kind !== 'countdown' ? undefined : true}>
      {photo && kind !== 'countdown' ? (
        // eslint-disable-next-line @next/next/no-img-element -- статичний експорт
        <img
          src={photo.src}
          alt={mediaAlt(photo, site?.locale, city)}
          loading="lazy"
          decoding="async"
          style={photo.position ? { objectPosition: `${photo.position.x}% ${photo.position.y}%` } : undefined}
        />
      ) : (
        <PostcardArt illustrationId={illustrationId} fill className={s.coverArt} />
      )}
      {kind === 'countdown' ? (
        <span className={s.coverTag}>
          <Icon name="clock" size={14} />
          {te('countdownTag')}
        </span>
      ) : null}
    </span>
  );
  const status = (kind: ExpectedKind | null) =>
    kind === 'countdown' ? null : (
      <span className={s.chip}>
        <Icon name="broadcast" size={14} />
        {t('status.expected')}
      </span>
    );
  const label = (kind: ExpectedKind | null) => (kind ? te(`kind.${kind}`) : te('neutralType'));

  return (
    <section className={cn(s.section, className)} data-expected-cards="" aria-labelledby="expected-h">
      <div className={s.head}>
        <div className={s.titleBlock}>
          <h2 id="expected-h" className={s.h2}>
            {t('cardsHeading', { country })}
          </h2>
        </div>
      </div>
      {phone ? (
        <ul className={s.list}>
          {cards.map((kind) => (
            <li key={kind ?? 'neutral'} className={s.row} data-expected-card={kind ?? 'neutral'}>
              <div className={s.rowMain}>
                <span className={s.rowThumb}>{thumb(kind)}</span>
                <span className={s.rowText}>
                  <span className={s.title}>{city}</span>
                  {status(kind) ? <span className={s.statusLine}>{status(kind)}</span> : null}
                  <span className={s.meta}>
                    {label(kind)} · {time}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className={s.track}>
          {cards.map((kind) => (
            <li key={kind ?? 'neutral'} className={s.card} data-expected-card={kind ?? 'neutral'}>
              <div className={s.cardBtn} style={{ cursor: 'default' }}>
                <span className={s.thumbWrap}>
                  {thumb(kind)}
                  {status(kind) ? <span className={s.status}>{status(kind)}</span> : null}
                </span>
                <span className={s.text}>
                  <span className={s.title}>{city}</span>
                  <span className={s.meta}>
                    {label(kind)} · {time}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
