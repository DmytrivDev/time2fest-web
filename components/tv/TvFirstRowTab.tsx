'use client';

/**
 * TvFirstRowTab (C22): вкладка «Перший ряд» бічної колонки ТВ і стіна під штампом опівночі.
 * Таблетки учасників (`FirstRowWall`, сітка 2 колонки — той самий компонент і ті самі фази загоряння, що на головній),
 * головне — QR «Скануй телефоном, щоб зайняти місце» з видимою адресою. Кнопки «Зайняти місце» на ТВ немає:
 * форма й оплата відкриваються лише на телефоні (QR).
 * Порожній стан — «усі місця вільні»; продаж закрито чи рядів більше немає — коротке пояснення.
 * Ряд — поточного поясу (той самий, що на головній і сторінках країн; ряд один на пояс, рішення 2026-11-05).
 */
import { useTranslations } from 'next-intl';
import { useChatLookup } from '@/components/chat/useChatLookup';
import { FirstRowWall, seedToSeats } from '@/components/live/FirstRowWall';
import { QRCode } from '@/components/primitives/QRCode';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import { CHAT_SCRIPT } from '@/lib/chat-sim/useChatSimulator';
import { firstRowShortUrl, firstRowUrl } from '@/lib/config/site';
import type { FirstRowSeat, Ms } from '@/lib/data/types';
import { SEATS } from '@/lib/engine/config';
import { firstRowView, type FirstRowView } from '@/lib/engine/firstRowView';
import { getData } from '@/lib/data/load';
import { firstRowEventFor } from '@/lib/firstrow/pick';
import { zoneRowLabel } from '@/lib/firstrow/zone';
import { useGuestStore } from '@/stores/guest';
import styles from './tv.module.css';

export interface TvFirstRowData {
  /** Подія-носій ряду поясу (адреса форми для QR). */
  eventId: string;
  /** Назва ряду: «UTC+0 · Лондон, Лісабон». */
  city: string;
  seats: FirstRowSeat[];
  view: FirstRowView;
}

/** Місця ряду з сиду (стабільний масив на ряд — стіна не перемальовується щосекунди). */
const seatsCache = new Map<string, FirstRowSeat[]>();
function seatsOf(rowId: string, midnightMs: Ms): FirstRowSeat[] {
  const key = `${rowId}:${midnightMs}`;
  let seats = seatsCache.get(key);
  if (!seats) {
    const seed = CHAT_SCRIPT.firstRowSeed.find((s) => s.eventId === rowId);
    seats = seed ? seedToSeats(seed, midnightMs) : [];
    seatsCache.set(key, seats);
  }
  return seats;
}

/** Місця й стан «Першого ряду» поточного поясу; `null` — рядів цієї ночі більше немає. Без сиду — усі місця вільні. */
export function useTvFirstRow(now: Ms): TvFirstRowData | null {
  const reduced = useReducedMotion();
  const guestId = useGuestStore((s) => s.id);
  const hasPass = useGuestStore((s) => s.hasPass);
  const row = firstRowEventFor(getData(), now);
  const entry = useGuestStore((s) => (row ? s.firstRow[row.id] : undefined));
  if (!row) return null;
  const seats = seatsOf(row.id, row.midnightMs);
  const view = firstRowView(now, row, seats, { ...(entry ?? {}), id: guestId, hasPass }, { reducedMotion: reduced });
  return { eventId: row.id, city: zoneRowLabel(getData(), row), seats, view };
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
}

export function TvFirstRowTab({ data }: TvFirstRowTabProps) {
  const t = useTranslations('tv');
  if (!data) {
    return (
      <p data-tv-first-row="none" className="text-tv-text text-text-secondary">
        {t('firstRowNone')}
      </p>
    );
  }
  const { view, city, eventId } = data;
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
