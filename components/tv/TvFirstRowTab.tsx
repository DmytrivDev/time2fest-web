'use client';

/**
 * TvFirstRowTab (C22): вкладка «Перший ряд» бічної колонки ТВ і стіна під штампом опівночі.
 * Таблетки учасників (`FirstRowWall`, сітка 2 колонки — той самий компонент і ті самі фази загоряння, що на головній),
 * головне — QR «Скануй телефоном, щоб зайняти місце» з видимою адресою. Кнопки «Зайняти місце» на ТВ немає:
 * форма й оплата відкриваються лише на телефоні (QR).
 * Порожній стан — «усі місця вільні»; продаж закрито чи події без «Першого ряду» — коротке пояснення.
 */
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { FirstRowWall, seedToSeats } from '@/components/live/FirstRowWall';
import { QRCode } from '@/components/primitives/QRCode';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { firstRowShortUrl, firstRowUrl } from '@/lib/config/site';
import type { FirstRowSeat, Ms } from '@/lib/data/types';
import { SEATS } from '@/lib/engine/config';
import { firstRowView, type FirstRowView } from '@/lib/engine/firstRowView';
import type { AirPlace } from '@/lib/player/BroadcastController';
import { useGuestStore } from '@/stores/guest';
import styles from './tv.module.css';

export interface TvFirstRowData {
  city: string;
  seats: FirstRowSeat[];
  view: FirstRowView;
}

/** Місця й стан «Першого ряду» поточної події; `null` — для події «Першого ряду» немає. */
export function useTvFirstRow(place: AirPlace | null, now: Ms): TvFirstRowData | null {
  const reduced = useReducedMotion();
  const guestId = useGuestStore((s) => s.id);
  const hasPass = useGuestStore((s) => s.hasPass);
  const entry = useGuestStore((s) => (place ? s.firstRow[place.event.id] : undefined));
  const seed = place ? CHAT_SCRIPT.firstRowSeed.find((s) => s.eventId === place.event.id) : undefined;
  const midnightMs = place?.event.midnightMs;
  const seats = useMemo(() => (seed && midnightMs !== undefined ? seedToSeats(seed, midnightMs) : []), [seed, midnightMs]);
  if (!place || !seed || !place.event.firstRow?.saleEnabled) return null;
  const view = firstRowView(now, place.event, seats, { ...(entry ?? {}), id: guestId, hasPass }, { reducedMotion: reduced });
  return { city: place.city?.name.uk ?? '', seats, view };
}

const usd = (n: number) => `$${n.toFixed(2).replace('.', ',')}`;

/** Стіна місць: фаза загоряння — з `firstRowView().wall`. */
export function TvFirstRowWall({ data }: { data: TvFirstRowData }) {
  const lookup = useChatLookup();
  const { view, seats, city } = data;
  return (
    <div className={styles.wall} data-tv-wall="">
      <FirstRowWall
        city={city}
        seats={seats}
        freeCount={view.freeCount}
        phase={view.wall.phase}
        lightingFrom={view.wall.lightingFrom}
        restrained={view.state === 'restrained'}
        layout="grid"
        countryName={lookup.countryName}
      />
    </div>
  );
}

export interface TvFirstRowTabProps {
  data: TvFirstRowData | null;
  eventId: string | null;
}

export function TvFirstRowTab({ data, eventId }: TvFirstRowTabProps) {
  const t = useTranslations('tv');
  if (!data || !eventId) {
    return (
      <p data-tv-first-row="none" className="text-tv-text text-text-secondary">
        {t('firstRowNone')}
      </p>
    );
  }
  const { view, city } = data;
  const sellable = view.price.current !== null;
  return (
    <div data-tv-first-row="" className="flex flex-col gap-4">
      <div className="flex flex-col">
        <h3 className="text-tv-title text-highlight">{t('firstRowHeading', { city })}</h3>
        <span className="text-tv-text text-text-secondary">{t('firstRowLeft', { free: view.freeCount, total: SEATS })}</span>
      </div>
      <TvFirstRowWall data={data} />
      {sellable ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface p-4" data-tv-buy="">
          <p className="text-center text-tv-text text-text">{t('scanToBuy')}</p>
          <QRCode value={firstRowUrl(eventId)} shortUrl={firstRowShortUrl(eventId)} alt={t('qrAltBuy')} size={160} tv />
          <p className="text-tv-text text-text-secondary">{t('firstRowPrice', { price: usd(view.price.current!) })}</p>
        </div>
      ) : null}
    </div>
  );
}
