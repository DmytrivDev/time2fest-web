'use client';

/**
 * Частини правої колонки режиму вечірки (дошка `TV-Party-New`, рішення 2026-11-06):
 * - `TvNow` — «Зараз: Лондон · Вебкамера» + «● Наживо» / «Лише відлік» і кнопка «Змінити трансляцію»;
 * - `TvStreamsNow` — «Змінити трансляцію»: трансляції поточного поясу наживо (мініатюри; OK — дивитися, «Назад» — закрити);
 * - `TvNearest` — сцена відліку: одна підказка — найближча трансляція наживо з «Перемкнути»;
 * - `TvShowSwitch` — «Що показувати»: «Усе свято» (автопілот) · «Мій графік»;
 * - `TvNoPass` — «Мій графік» без пасу чи з порожнім графіком: картка з QR на сторінку пасу;
 * - `TvWelcome` — перший захід: що таке режим вечірки, «Зрозуміло · OK» (показуємо один раз).
 */
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, type Ref } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { QRCode } from '@/components/primitives/QRCode';
import { getStreamChains } from '@/lib/api/hooks/live';
import { PASS_SHORT_URL, PASS_URL } from '@/lib/config/site';
import { getData } from '@/lib/data/load';
import { formatClock } from '@/lib/i18n/time';
import type { StreamRowData } from '@/lib/live/countryData';
import type { AirPlace } from '@/lib/player/BroadcastController';
import type { TvShow } from '@/stores/tv';
import styles from './tv.module.css';

const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;

function thumbOf(row: StreamRowData): string | undefined {
  const src = getStreamChains().get(row.eventId)?.sources.find((s) => s.id === row.id);
  return src?.platform === 'youtube' && src.videoId ? `https://i.ytimg.com/vi/${src.videoId}/mqdefault.jpg` : undefined;
}

export interface TvNowProps {
  place: AirPlace;
  /** Йде відео (інакше — «Лише відлік»). */
  stream: boolean;
  /** Назва трансляції, що грає («Лондон · Еббі-Роуд»), якщо гість обрав іншу. */
  title?: string;
  /** Є інші трансляції поясу наживо — показати «Змінити трансляцію». */
  canChange: boolean;
  onChange?: () => void;
  changeRef?: Ref<HTMLButtonElement>;
}

export function TvNow({ place, stream, title, canChange, onChange, changeRef }: TvNowProps) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const city = place.city?.name.uk ?? place.country?.name.uk ?? '';
  const where = title ?? (stream ? `${city} · ${tType(TYPE_KEY[place.event.type])}` : place.country?.name.uk ?? city);
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex w-full items-center gap-2.5">
        <p className={styles.nowLine} data-tv-now="">
          {t.rich('nowOnAir', { place: where, b: (c) => <b>{c}</b> })}
        </p>
        {stream ? (
          <span className={styles.liveChip} data-tv-status="live">
            <span aria-hidden="true">●</span> {tBadge('live')}
          </span>
        ) : (
          <span className={styles.statusChip} data-tv-status="countdown-only">
            <Icon name="clock" size={16} />
            {tBadge('status.countdownOnly')}
          </span>
        )}
      </div>
      {stream && canChange ? (
        <button ref={changeRef} type="button" onClick={onChange} data-action="change-stream" className={cn('t2f-focus t2f-transition', styles.chip)}>
          <Icon name="swap" size={18} />
          {t('changeStream')}
        </button>
      ) : null}
    </div>
  );
}

export interface TvStreamsNowProps {
  rows: readonly StreamRowData[];
  /** Джерело, що грає зараз. */
  playingId: string | null;
  onWatch: (row: StreamRowData) => void;
  onClose: () => void;
}

export function TvStreamsNow({ rows, playingId, onWatch, onClose }: TvStreamsNowProps) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const listRef = useRef<HTMLUListElement>(null);
  // Відкрили — фокус на трансляції, що грає (або першій): далі пульт ↓ веде по списку, список їде за фокусом.
  useEffect(() => {
    const el = listRef.current;
    (el?.querySelector<HTMLElement>('[aria-current="true"]') ?? el?.querySelector<HTMLElement>('button'))?.focus();
  }, []);
  return (
    <section aria-labelledby="tv-streams-title" data-tv-panel="streams" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3">
        <h2 id="tv-streams-title" className={styles.panelTitle}>
          {t('streamsNowTitle')}
        </h2>
        <span className="flex-1" />
        <button type="button" onClick={onClose} data-action="close-streams" className={cn('t2f-focus t2f-transition', styles.linkBtn)}>
          {t('streamsNowClose')}
        </button>
      </div>
      <ul ref={listRef} className={styles.streamList}>
        {rows.map((row) => {
          const thumb = thumbOf(row);
          const on = row.id === playingId;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onWatch(row)}
                data-tv-stream={row.id}
                className={cn('t2f-focus t2f-transition', styles.streamRow)}
              >
                <span className={styles.streamThumb}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {thumb ? <img src={thumb} alt="" loading="lazy" decoding="async" /> : null}
                  {on ? <span className={styles.streamPlaying}>{t('nowPlaying')}</span> : null}
                </span>
                <span className="min-w-0">
                  <b className={styles.streamTitle}>{row.title}</b>
                  <span className={styles.streamMeta}>
                    <Flag code={row.flagCode} size="sm" decorative />
                    <Icon name="broadcast" size={16} className="text-primary" />
                    {tBadge('live')} · {tType(TYPE_KEY[row.kind])}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>{t('streamsNowHint')}</p>
    </section>
  );
}

export function TvNearest({ row, onWatch }: { row: StreamRowData; onWatch: (row: StreamRowData) => void }) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const locale = useLocale();
  const city = getData().citiesById.get(getData().eventsById.get(row.eventId)?.cityId ?? '')?.name.uk ?? row.countryName;
  return (
    <div className={styles.nearest} data-tv-nearest="">
      <Flag code={row.flagCode} size="md" decorative />
      <div className="min-w-0 flex-1">
        <b className={styles.streamTitle}>
          {city} · {formatClock(row.midnightMs, { locale })}
        </b>
        <span className={styles.streamMeta}>
          <Icon name="broadcast" size={16} className="text-primary" />
          {tBadge('live')} · {tType(TYPE_KEY[row.kind])}
        </span>
      </div>
      <button type="button" onClick={() => onWatch(row)} data-action="switch" data-tv-initial="" className={cn('t2f-focus t2f-transition', styles.yellowBtn)}>
        <Icon name="swap" size={18} />
        {t('switchTo')}
      </button>
    </div>
  );
}

export function TvShowSwitch({ show, onChange }: { show: TvShow; onChange: (s: TvShow) => void }) {
  const t = useTranslations('tv');
  const opts: readonly { key: TvShow; label: string; icon: IconName }[] = [
    { key: 'all', label: t('showAll'), icon: 'globe' },
    { key: 'mine', label: t('showMine'), icon: 'calendar-check' },
  ];
  return (
    <div className="flex flex-col gap-2">
      <p id="tv-show-label" className={styles.kicker}>
        {t('showLabel')}
      </p>
      <div role="group" aria-labelledby="tv-show-label" className={cn(styles.segment, styles.segmentFull)} data-tv-show="">
        {opts.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={show === o.key}
            data-show={o.key}
            onClick={() => onChange(o.key)}
            className={cn('t2f-focus t2f-transition', styles.segmentItem)}
          >
            <Icon name={o.icon} size={18} />
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** «Мій графік» без пасу (чи з порожнім графіком): QR на сторінку пасу; екран далі показує «Усе свято». */
export function TvNoPass({ hasPass }: { hasPass: boolean }) {
  const t = useTranslations('tv');
  return (
    <div className={styles.promoCard} data-tv-nopass="">
      <p className={styles.promoKicker}>{t('mineKicker')}</p>
      <p className={styles.promoTitle}>{t('mineTitle')}</p>
      <p className={styles.promoText}>{hasPass ? t('mineEmptyText') : t('mineNoPassText')}</p>
      <div className={styles.promoRow}>
        <QRCode value={PASS_URL} shortUrl={PASS_SHORT_URL} alt={t('qrAltPass')} size={120} urlBeside />
        <div className="min-w-0">
          <p className={styles.promoLead}>{t('scanPhone')}</p>
          <p className={styles.promoText}>{hasPass ? t('mineEmptyLead') : t('mineNoPassLead')}</p>
          <p className={styles.promoUrl}>{PASS_SHORT_URL}</p>
        </div>
      </div>
    </div>
  );
}

export function TvWelcome({ onDone }: { onDone: () => void }) {
  const t = useTranslations('tv');
  const steps = [
    { title: t('welcomeAutoTitle'), text: t('welcomeAutoText') },
    { title: t('welcomeRemoteTitle'), text: t('welcomeRemoteText') },
    { title: t('welcomeMineTitle'), text: t('welcomeMineText') },
  ];
  return (
    <section aria-labelledby="tv-welcome-title" className={styles.promoCard} data-tv-welcome="">
      <p className={styles.promoKicker}>{t('welcomeKicker')}</p>
      <h2 id="tv-welcome-title" className={styles.promoTitle}>
        {t('welcomeTitle')}
      </h2>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.title}>
            <span aria-hidden="true" className={styles.stepNum}>
              {i + 1}
            </span>
            <span className="min-w-0">
              <b className={styles.stepTitle}>{s.title}</b>
              <span className={styles.stepText}>{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className={styles.promoRow}>
        <QRCode value={PASS_URL} shortUrl={PASS_SHORT_URL} alt={t('qrAltPass')} size={104} urlBeside />
        <div className="min-w-0">
          <p className={styles.promoLead}>{t('welcomeQr')}</p>
          <p className={styles.promoUrl}>{PASS_SHORT_URL}</p>
          <button type="button" onClick={onDone} data-action="welcome-ok" data-tv-initial="" className={cn('t2f-focus t2f-transition mt-2.5', styles.whiteBtn)}>
            {t('welcomeOk')}
          </button>
        </div>
      </div>
    </section>
  );
}
