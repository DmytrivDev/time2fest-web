'use client';

/**
 * C16 `pass-offer` — «Твій шлях цієї ночі · Наступна північ» (дошка `Desk-PassOffer-Next`, рішення власника 2026-11-01).
 * Заголовок «2 Нових роки вже твої — далі буде ще краще», шлях прапорами (зустрінуті — золоте кільце й час, червона крапка
 * «зараз», попереду — пунктир і бліді прапори), плашка найближчої півночі «за 54 хв · З пасом — нагадаємо», коралова
 * «Оформити пас · $5» і «Детальніше». Десктоп — дві колонки (шлях ліворуч, наступна північ і кнопки праворуч);
 * телефон — стовпчик, у шляху по дві країни з кожного боку від «зараз».
 * Коли показувати — `offerEligibility`; дані шляху — `lib/offers/passPath`; тут лише вигляд.
 */
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import type { Ms } from '@/lib/data/types';
import { formatClock, formatDurationShort } from '@/lib/i18n/time';
import { formatUsd } from '@/lib/offers/format';
import { useSitePrices } from '@/lib/api/hooks/site';
import type { PathPoint } from '@/lib/offers/passPath';
import { useRegisterCoral } from '@/lib/overlay/coral';
import { OfferCard } from './OfferCard';
import s from './passOffer.module.css';

export interface PassOfferCountry {
  iso: string;
  /** Назва країни в називному відмінку. */
  name: string;
  flagCode: string;
}

export interface PassOfferProps {
  /** Скільки Нових років зустрінуто. */
  count: number;
  /** Зустрінуті півночі, від ранніх до пізніх (показуємо останні чотири; телефон — дві). */
  met: PathPoint[];
  /** Найближчі півночі після «зараз» (до трьох; телефон — дві). Перша — у плашці «Наступна північ». */
  next: PathPoint[];
  now: Ms;
  onClose?: () => void;
  onDetails?: () => void;
  onGetPass?: () => void;
  className?: string;
}

const MET_MAX = 4;
const MET_PHONE = 2;
const NEXT_PHONE = 2;

function Node({ point, met, label, wide }: { point: PathPoint; met: boolean; label: string; wide?: boolean }) {
  return (
    <li className={s.node} data-met={met || undefined} data-wide={wide || undefined}>
      <span className={s.ring} aria-hidden="true">
        <Flag code={point.flagCode} size="md" decorative />
      </span>
      <span className={s.time} aria-hidden="true">
        {formatClock(point.midnightMs)}
      </span>
      <span className="sr-only">{label}</span>
    </li>
  );
}

const Line = ({ past, wide }: { past?: boolean; wide?: boolean }) => (
  <li aria-hidden="true" className={cn(s.line, past && s.linePast)} data-wide={wide || undefined} />
);

export function PassOffer({ count, met, next, now, onClose, onDetails, onGetPass, className }: PassOfferProps) {
  const passPrice = useSitePrices().pass;
  const t = useTranslations('offers');
  useRegisterCoral();
  const shownMet = met.slice(-MET_MAX);
  const upcoming = next[0];
  const price = formatUsd(passPrice);

  return (
    <OfferCard variant="pass-offer" kicker={t('pathKicker')} title={t('pathTitle', { count })} closeLabel={t('dismiss')} onClose={onClose} className={cn(s.card, className)}>
      <ol className={s.path} aria-label={t('pathLabel')}>
        {shownMet.map((p, i) => {
          // Телефон: лише дві останні зустрінуті країни (ранніші — `data-wide`).
          const wide = i < shownMet.length - MET_PHONE;
          return (
            <Fragment key={p.eventId}>
              <Node point={p} met wide={wide} label={t('pathMet', { city: p.city, time: formatClock(p.midnightMs) })} />
              <Line past wide={wide} />
            </Fragment>
          );
        })}
        <li className={s.now}>
          <span className={s.dotBox} aria-hidden="true">
            <span className={s.dot} />
          </span>
          <span className={s.nowLabel}>{t('pathNow')}</span>
        </li>
        {next.map((p, i) => (
          <Fragment key={p.eventId}>
            <Line wide={i >= NEXT_PHONE} />
            <Node point={p} met={false} wide={i >= NEXT_PHONE} label={t('pathNext', { city: p.city, time: formatClock(p.midnightMs) })} />
          </Fragment>
        ))}
      </ol>
      <p className={s.lead}>{t('pathLead')}</p>
      <div className={s.aside}>
        {upcoming ? (
          <div className={s.next} data-row="next-midnight">
            <div className={s.nextHead}>
              <span className={s.nextFlag}>
                <Flag code={upcoming.flagCode} size="lg" decorative />
              </span>
              <div className={s.nextText}>
                <span className={s.nextWhen}>{t('nextIn', { time: formatDurationShort(upcoming.midnightMs - now) })}</span>
                <span className={s.nextCity}>
                  {upcoming.city} · {formatClock(upcoming.midnightMs)}
                </span>
              </div>
            </div>
            <span className={s.remind}>
              <Icon name="bell" size={16} />
              {t('remind')}
            </span>
          </div>
        ) : null}
        <div className={s.actions}>
          <Button variant="coral" size="lg" onClick={onGetPass} className={s.getPass}>
            {t('getPassPrice', { price })}
          </Button>
          <Button variant="secondary" size="lg" onClick={onDetails} className={s.detailsDesk}>
            {t('details')}
          </Button>
        </div>
        <div className={s.noteRow}>
          <span className={s.note}>{t('priceNote')}</span>
          <button type="button" onClick={onDetails} className={cn('t2f-focus', s.detailsPhone)}>
            {t('details')}
          </button>
        </div>
      </div>
    </OfferCard>
  );
}
