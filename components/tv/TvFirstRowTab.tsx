'use client';

/**
 * TvFirstRowTab (C22, дошка `TV-Party-New`, рішення 2026-11-06): вкладка «Перший ряд» правої колонки ТВ.
 * Заголовок ряду поясу й «лишилось N з 10 · опівночі імена загоряться»; імена — один рядок, що пливе сам
 * (`FirstRowWall` у розкладці `row`, той самий, що на головній; «зменшити рух» — стоїть). Під ним — картка
 * «Зайняти місце»: заголовок згори, QR і текст з адресою в рядку. Кнопки на ТВ немає: форма й оплата — на телефоні.
 * Ряд заповнений чи продаж закрито — QR немає, натомість наступний ряд.
 * Ряд — поточного поясу (той самий, що на головній і сторінках країн; ряд один на пояс, рішення 2026-11-05).
 */
import { useLocale, useTranslations } from 'next-intl';
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
import { firstRowEventFor, nextOpenSale } from '@/lib/firstrow/pick';
import { zoneRowLabel } from '@/lib/firstrow/zone';
import { formatClock } from '@/lib/i18n/time';
import { useGuestStore } from '@/stores/guest';
import styles from './tv.module.css';

export interface TvFirstRowData {
  /** Подія-носій ряду поясу (адреса форми для QR). */
  eventId: string;
  /** Назва ряду: «UTC+0 · Лондон, Лісабон». */
  city: string;
  seats: FirstRowSeat[];
  view: FirstRowView;
  /** Наступний ряд з відкритим продажем (коли цей заповнений чи закритий). */
  next: { label: string; midnightMs: Ms } | null;
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
  const data = getData();
  const row = firstRowEventFor(data, now);
  const entry = useGuestStore((s) => (row ? s.firstRow[row.id] : undefined));
  if (!row) return null;
  const seats = seatsOf(row.id, row.midnightMs);
  const view = firstRowView(now, row, seats, { ...(entry ?? {}), id: guestId, hasPass }, { reducedMotion: reduced });
  const nextRow = nextOpenSale(data, now, row.id);
  return {
    eventId: row.id,
    city: zoneRowLabel(data, row),
    seats,
    view,
    next: nextRow ? { label: zoneRowLabel(data, nextRow), midnightMs: nextRow.midnightMs } : null,
  };
}

const usd = (n: number) => `$${n.toFixed(2).replace('.', ',')}`;

/** Імена ряду одним рядком, що пливе (фаза загоряння — з `firstRowView().wall`). */
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
        layout="row"
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
  const locale = useLocale();
  if (!data) {
    return (
      <p data-tv-first-row="none" className="text-text-secondary">
        {t('firstRowNone')}
      </p>
    );
  }
  const { view, city, eventId, next } = data;
  const sellable = view.price.current !== null;
  const taken = data.seats.filter((s) => s.state === 'taken').length;
  return (
    <div data-tv-first-row="" className="flex flex-col">
      <h3 className={styles.frTitle}>{t('firstRowHeading', { city })}</h3>
      <p className={styles.frSub}>
        {view.freeCount === 0 ? t('firstRowFull', { total: SEATS }) : t('firstRowLeft', { free: view.freeCount, total: SEATS })}
      </p>
      {taken > 0 ? <TvFirstRowWall data={data} /> : null}
      {sellable ? (
        <div className={styles.promoCard} data-tv-buy="">
          <p className={styles.promoKicker}>{t('takeSeatKicker')}</p>
          <p className={styles.promoTitle}>{t('takeSeatTitle')}</p>
          <div className={styles.promoRow}>
            <QRCode value={firstRowUrl(eventId)} shortUrl={firstRowShortUrl(eventId)} alt={t('qrAltBuy')} size={120} urlBeside />
            <div className="min-w-0">
              <p className={styles.promoLead}>{t('scanPhone')}</p>
              <p className={styles.promoText}>{t('firstRowPrice', { price: usd(view.price.current!) })}</p>
              <p className={styles.promoUrl}>{firstRowShortUrl(eventId)}</p>
            </div>
          </div>
        </div>
      ) : next ? (
        <p className={styles.frNext} data-tv-next-row="">
          {t.rich('firstRowNext', { reason: view.freeCount === 0 ? 'full' : 'closed', row: next.label, time: formatClock(next.midnightMs, { locale }), b: (c) => <b className="text-text">{c}</b> })}
        </p>
      ) : null}
    </div>
  );
}
