'use client';

/**
 * Передстартовий сайт: «Де дивитися» — та сама плашка, що «Лише відлік» у вікні країни на мапі, без кнопки графіка й
 * без посилань: тип очікуваної трансляції («Телетрансляція» · «Очікується») або нейтральне «Трансляція очікується», і
 * головне місто країни в цьому поясі. Кілька типів — кілька плашок у стрічці. Мовника як плеєр не обіцяємо — лише тип
 * події й місто (рішення власника 2026-11-18; дослідження `docs/reports/expected-streams.md`).
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import type { ExpectedKind } from './mapPrefest';
import m from './countryPanel.module.css';
import zp from './zonePanel.module.css';

export function ExpectedWatch({
  kinds,
  city,
  phone,
  className,
  titleAs: Title = 'h4',
}: {
  kinds: readonly ExpectedKind[];
  city: string;
  phone: boolean;
  className?: string;
  /** Рівень заголовка: у вікні мапи — `h4`, на сторінці країни — `h2`. */
  titleAs?: 'h2' | 'h4';
}) {
  const t = useTranslations('liveMap.country');
  const te = useTranslations('prefest.map.expected');
  const cards: readonly (ExpectedKind | null)[] = kinds.length ? kinds : [null];
  return (
    <div className={cn(m.watch, className)} data-expected-watch="">
      <Title className={zp.h4}>{t('watchTitle')}</Title>
      <div className={zp.slider}>
        <ul className={cn(zp.track, m.track, phone && zp.trackPhone)}>
          {cards.map((kind) => (
            <li key={kind ?? 'neutral'} className={cn(zp.card, m.countdownCard)} data-expected-card={kind ?? 'neutral'}>
              <div className={zp.cardTop}>
                <span className={zp.cardType}>{kind ? te(`kind.${kind}`) : te('neutralType')}</span>
                <Icon name="clock" size={12} className={m.muted} />
              </div>
              <div className={cn(zp.cardCity, m.cardPlace)}>{city}</div>
              <div className={m.countdownFoot}>
                <p className={m.countdownText}>{kind ? te('expected') : te('neutral')}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
