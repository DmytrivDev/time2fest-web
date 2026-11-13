'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useContext, useEffect, useRef, type Ref } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useStamps } from '@/lib/api/hooks/passport';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock, formatCountdown, formatDurationShort } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { StateSwatch } from './MapSide';
import { utcLabel, type MapCountry, type MapCountryStream, type MapZone } from './MapModel';
import { MapScheduleContext, PlayMark, ScheduleButton, Slider, StateBadge } from './ZonePanel';
import zp from './zonePanel.module.css';
import m from './countryPanel.module.css';

const TYPE_KEY = {
  main: 'main',
  webcam: 'webcam',
  tv: 'tv',
  'countdown-only': 'countdownOnly',
} as const;
/** Іконки традицій (`howTo.traditions[].iconId`) — з набору сайту; невідома — зірка. */
const TRADITION_ICON: Record<string, IconName> = {
  countdown: 'clock',
  feast: 'glass',
  food: 'glass',
  noodles: 'glass',
  fireworks: 'sparkles',
  kiss: 'heart',
  bell: 'bell',
};
/** «Наступна північ»: до двох назв країн, далі «та ще N». */
const NEXT_NAMES = 2;
/** Як у вікні поясу: Росія й Білорусь — не серед перших назв (рішення власника 2026-11-03). */
const NOT_FIRST = new Set(['RU', 'BY']);

export interface CountryZoneChip {
  id: string;
  offsetMinutes: number;
  state: ZoneState;
}

export interface CountryPanelProps {
  zone: MapZone;
  country: MapCountry;
  state: ZoneState;
  /** Пояси країни (схід → захід); більше одного — рядок кнопок під шапкою. */
  zones: readonly CountryZoneChip[];
  /** Наступна північ після цієї (для «вже зустріли»). */
  nextZone?: MapZone;
  phone: boolean;
  /** «‹ До поясу», «Наступна північ» — вікно поясу на тому ж місці. */
  onSelectZone: (id: string) => void;
  /** Кнопка іншого поясу країни. */
  onSelectCountryZone: (zoneId: string) => void;
  onClose: () => void;
  /** Усередині рядка вкладки «Список»: без своєї рамки й «×» — назад до поясу веде кнопка «‹ До поясу». */
  embedded?: boolean;
  /** Чи можна перейти до іншого поясу країни (у «Списку» — лише до поясів, що є рядками). */
  canSelectZone?: (zoneId: string) => boolean;
  /** Вікно відкрили з вікна поясу (клік по країні): фокус — на «‹ До поясу», верх вікна — у полі зору. */
  takeFocus?: boolean;
  ref?: Ref<HTMLElement>;
}

/** Утримати верх вікна в полі зору й поставити фокус на кнопку (вікно змінилось на місці — фокус не губиться). */
export function useTakeFocus(active: boolean, key: string) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) return;
    const el = btn.current;
    if (!el) return;
    const box = el.closest('section');
    const top = box?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 16 });
    el.focus({ preventScroll: true });
  }, [active, key]);
  return btn;
}

/**
 * Вікно країни під мапою (рішення власника 2026-11-03, дошка `Desk-Map-CountryVariants`): десктоп — варіант A (дві
 * колонки: ліворуч хто, коли й кімната країни, праворуч трансляції й традиції), телефон — варіант B (відлік і пояс
 * плиткою, кімната однією карткою) з традиціями списком без описів. Клік по суші країни — це вікно; по океану чи в
 * черзі — вікно поясу; обидва стоять на одному місці під мапою.
 */
export function CountryPanel({
  zone,
  country,
  state,
  zones,
  nextZone,
  phone,
  onSelectZone,
  onSelectCountryZone,
  onClose,
  embedded = false,
  canSelectZone,
  takeFocus = false,
  ref,
}: CountryPanelProps) {
  const zoneBtnRef = useTakeFocus(takeFocus, `${zone.id}:${country.iso}`);
  const t = useTranslations('liveMap.country');
  const viewerIso = useGuestStore((g) => g.flagCode);
  const now = useNow();
  const streams = country.streams ?? [];
  const after = state === 'past' || now >= zone.midnightMs + HANDOVER_AFTER;
  const before = !after && now < zone.midnightMs;
  const offset = utcLabel(zone.offsetMinutes);
  const title = (
    <span className={m.title}>
      {/* Прапор і назва — посилання на сторінку країни (правка власника 2026-11-04). */}
      <NextLink href={country.href} className={cn('t2f-focus', m.nameLink)} data-country-page-link="">
        <Flag code={country.flagCode} diameter={phone ? 32 : 40} decorative />
        <h3 className={zp.name}>{country.name}</h3>
      </NextLink>
      {state === 'live' && streams.length === 0 ? (
        <span className={cn(zp.badge, m.badgeNow)} data-badge="now">
          {t('nowBadge')}
        </span>
      ) : (
        <StateBadge state={state} />
      )}
      {viewerIso === country.iso ? <span className={zp.own}>{t('yourCountry')}</span> : null}
      {country.quiet ? (
        <span className={m.quiet} data-quiet="">
          <Icon name="sparkles" size={12} />
          <span aria-hidden="true">{country.quiet}</span>
          <span className="sr-only">{t('quiet', { note: country.quiet })}</span>
        </span>
      ) : null}
    </span>
  );
  // «‹ До поясу UTC+1» — назад до вікна поясу на тому самому місці (правка власника 2026-11-04).
  const zoneBtn = (
    <button
      ref={zoneBtnRef}
      type="button"
      className={cn('t2f-focus', zp.navBtn, m.zoneBtn)}
      aria-label={t('toZoneAria', { offset })}
      onClick={() => onSelectZone(zone.id)}
      data-to-zone={zone.id}
    >
      <Icon name="chevron-left" size={16} />
      <span className={zp.navWord}>{t('toZone')}</span>
      <StateSwatch state={state} className={m.zoneSw} />
      <b>{offset}</b>
    </button>
  );
  const chips =
    zones.length > 1 ? (
      <ZoneChips
        zones={zones}
        current={zone.id}
        phone={phone}
        onSelect={onSelectCountryZone}
        canSelect={canSelectZone}
      />
    ) : null;
  const time = <CountryTime zone={zone} state={state} phone={phone} />;
  const watch = (
    <div className={m.watch}>
      {streams.length === 0 ? (
        <>
          <h4 className={zp.h4}>{after ? t('replayTitle') : t('watchTitle')}</h4>
          {after ? (
            <p className={zp.empty}>{t('noReplay')}</p>
          ) : (
            // Та сама ширина, що в картки трансляції: контейнер стрічки (`cqw`) і та сама стрічка.
            <div className={zp.slider}>
              <ul className={cn(zp.track, m.track, phone && zp.trackPhone)}>
                <CountdownCard
                  city={country.city ?? country.name}
                  eventId={before ? country.eventIds?.[0] : undefined}
                />
              </ul>
            </div>
          )}
        </>
      ) : (
        <Slider
          key={`${zone.id}:${country.iso}`}
          phone={phone}
          label={after ? t('replayTitle') : t('watchTitle')}
          title={after ? t('replayTitle') : t('watchTitle')}
        >
          {streams.map((s) => (
            <StreamCard
              key={s.cityId}
              stream={s}
              href={country.href}
              mode={after ? 'replay' : state === 'live' ? 'live' : 'upcoming'}
              midnightMs={zone.midnightMs}
            />
          ))}
        </Slider>
      )}
    </div>
  );
  const room = <Room country={country} after={after} before={before} phone={phone} />;
  // «Наступна північ» — під трансляціями, над кімнатою країни (правка власника 2026-11-03).
  const next =
    after && nextZone ? <NextMidnight zone={nextZone} onSelectZone={onSelectZone} /> : null;
  const how = country.traditions?.length ? (
    <div className={m.how}>
      <h4 className={zp.h4}>{t('howTitle')}</h4>
      <ul className={m.howList}>
        {country.traditions.map((x) => (
          <li key={x.id} className={m.howItem}>
            <span aria-hidden="true" className={m.howIcon}>
              <Icon name={TRADITION_ICON[x.iconId ?? ''] ?? 'star'} size={phone ? 16 : 18} />
            </span>
            <span className={m.howText}>
              <span className={m.howTitle}>{x.title}</span>
              {/* Телефон: лише назви (рішення власника 2026-11-03) — описи на сторінці країни. */}
              {phone ? null : <span className={m.howDesc}>{x.text}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
  const close = (
    <IconButton
      icon="close"
      aria-label={t('close')}
      onClick={onClose}
      className={cn(zp.close, m.close)}
    />
  );
  return (
    <section
      ref={ref}
      className={cn(
        zp.panel,
        m.panel,
        phone && zp.phone,
        phone && m.phone,
        embedded && zp.embedded,
        embedded && m.embedded,
      )}
      data-country-panel={country.iso}
      data-zone-id={zone.id}
      data-state={state}
      aria-label={t('aria', { country: country.name })}
    >
      {embedded ? null : close}
      {phone ? (
        <>
          {/* «‹ До поясу» — угорі, як «назад» (правка власника 2026-11-04); «×» — у тому самому рядку праворуч. */}
          <div className={m.backRow}>{zoneBtn}</div>
          <div className={m.headPhone}>{title}</div>
          {chips}
          <div className={m.timeTile}>{time}</div>
          {watch}
          {next}
          {room}
          {how}
        </>
      ) : (
        <div className={m.cols}>
          <div className={m.left}>
            <div>
              {title}
              <div className={m.zoneRow}>{zoneBtn}</div>
              {chips}
            </div>
            {time}
            {room}
          </div>
          <div className={m.right}>
            {watch}
            {next}
            {how}
          </div>
        </div>
      )}
    </section>
  );
}

function ZoneChips({
  zones,
  current,
  phone,
  onSelect,
  canSelect,
}: {
  zones: readonly CountryZoneChip[];
  current: string;
  phone: boolean;
  onSelect: (id: string) => void;
  canSelect?: (id: string) => boolean;
}) {
  const t = useTranslations('liveMap.country');
  const tState = useTranslations('liveMap.panel.state');
  return (
    <div className={cn(m.chips, phone && m.chipsPhone)} data-country-zones="">
      <span className={m.chipsLabel}>{t('zonesLabel', { count: zones.length })}</span>
      <ul className={m.chipList}>
        {zones.map((z) => (
          <li key={z.id}>
            <button
              type="button"
              className={cn('t2f-focus', m.chip)}
              aria-pressed={z.id === current}
              aria-label={t('zoneChip', {
                offset: utcLabel(z.offsetMinutes),
                state: tState(z.state),
              })}
              data-country-zone={z.id}
              disabled={z.id !== current && canSelect ? !canSelect(z.id) : undefined}
              onClick={() => onSelect(z.id)}
            >
              <StateSwatch state={z.state} className={m.chipSw} />
              {utcLabel(z.offsetMinutes)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Відлік до півночі в країні (з секундами); щойно після півночі — «Північ щойно настала»; далі — скільки тому. */
function CountryTime({ zone, state, phone }: { zone: MapZone; state: ZoneState; phone: boolean }) {
  const t = useTranslations('liveMap.country');
  const tz = useTranslations('liveMap.panel');
  const locale = useLocale();
  const now = useNow();
  const left = zone.midnightMs - now;
  if (state === 'past' || now >= zone.midnightMs + HANDOVER_AFTER) {
    return (
      <div data-country-time="past">
        <div className={zp.smallCap}>{tz('pastLabel')}</div>
        <div className={cn(zp.ago, m.ago)}>
          {tz('pastAgo', { dur: formatDurationShort(now - zone.midnightMs, locale) })}
        </div>
        <div className={m.when}>
          {tz('pastAt', { time: formatClock(zone.midnightMs, { locale }) })}
        </div>
      </div>
    );
  }
  if (left <= 0) {
    return (
      <div data-country-time="now">
        <div className={zp.smallCap}>{t('nowLabel')}</div>
        <div className={cn(zp.ago, m.ago)}>{tz('nowText')}</div>
      </div>
    );
  }
  return (
    <div data-country-time="until">
      <div className={zp.smallCap}>{t('untilLabel')}</div>
      <div className={cn(zp.timer, phone && m.timerPhone)} role="timer" aria-live="off">
        {formatCountdown(left)}
      </div>
    </div>
  );
}

function StreamCard({
  stream,
  href,
  mode,
  midnightMs,
}: {
  stream: MapCountryStream;
  href: string;
  mode: 'live' | 'upcoming' | 'replay';
  midnightMs: number;
}) {
  const t = useTranslations('liveMap.panel');
  const tc = useTranslations('liveMap.country');
  const tType = useTranslations('liveCards.eventCard.type');
  const locale = useLocale();
  const live = mode === 'live';
  return (
    <li className={zp.card} data-stream-card={stream.cityId}>
      <div className={zp.cardTop}>
        <span className={zp.cardType}>{tType(TYPE_KEY[stream.type])}</span>
        {live ? (
          <span className={zp.cardLive}>
            <span aria-hidden="true" className={zp.dotLive} />
            {t('live')}
          </span>
        ) : mode === 'replay' ? (
          <span className={zp.cardReplay}>
            <PlayMark tone="replay" size={12} />
            {t('replay')}
          </span>
        ) : (
          <span className={cn(zp.cardReplay, m.cardWhen)}>
            <Icon name="clock" size={12} />
            {t('startsAt', { time: formatClock(midnightMs, { locale }) })}
          </span>
        )}
      </div>
      <div className={cn(zp.cardCity, m.cardPlace)}>{stream.place}</div>
      <div className={m.cardSub}>{stream.city}</div>
      <div className={zp.cardActions}>
        <NextLink href={href} className={cn('t2f-focus', zp.cardBtn, live && zp.cardBtnLive)}>
          <PlayMark tone={mode} />
          {live ? t('watch') : mode === 'replay' ? t('watchReplay') : tc('openStream')}
        </NextLink>
        {mode === 'upcoming' ? (
          <ScheduleButton eventId={stream.eventId} city={stream.city} />
        ) : null}
      </div>
    </li>
  );
}

/** «Лише відлік» — картка того ж розміру, що й трансляція, щоб ряд не пустів. */
function CountdownCard({ city, eventId }: { city: string; eventId?: string | undefined }) {
  const t = useTranslations('liveMap.country');
  return (
    <li className={cn(zp.card, m.countdownCard)} data-countdown-card="">
      <div className={zp.cardTop}>
        <span className={zp.cardType}>{t('countdownOnly')}</span>
        <Icon name="clock" size={12} className={m.muted} />
      </div>
      <div className={cn(zp.cardCity, m.cardPlace)}>{city}</div>
      {/* Календарик і тут (графік — це країни, рішення 2026-11-04): той самий запис, що кнопка в кімнаті країни. */}
      <div className={m.countdownFoot}>
        <p className={m.countdownText}>{t('countdownText')}</p>
        <ScheduleButton eventId={eventId} city={city} />
      </div>
    </li>
  );
}

/** «Додати в графік» під кнопкою кімнати (рішення 2026-11-04): додали — «У графіку · нагадаємо за 10 хв». */
function ScheduleWide({ eventId, city }: { eventId?: string | undefined; city: string }) {
  const onToggle = useContext(MapScheduleContext);
  const inSchedule = useGuestStore((g) => (eventId ? g.schedule.includes(eventId) : false));
  const t = useTranslations('liveMap.country');
  if (!eventId || !onToggle) return null;
  return (
    <button
      type="button"
      aria-pressed={inSchedule}
      data-schedule-toggle={eventId}
      data-schedule-wide=""
      aria-label={inSchedule ? t('scheduleOnAria', { city }) : t('scheduleAddAria', { city })}
      className={cn('t2f-focus', m.sched)}
      onClick={() => onToggle(eventId, !inSchedule)}
    >
      <Icon name={inSchedule ? 'calendar-check' : 'calendar-add'} size={18} strokeWidth={inSchedule ? 2.2 : 2} />
      {inSchedule ? t('scheduleOn') : t('scheduleAdd')}
    </button>
  );
}

function Room({
  country,
  after,
  before,
  phone,
}: {
  country: MapCountry;
  after: boolean;
  /** До півночі — можна додати в графік. */
  before: boolean;
  phone: boolean;
}) {
  const t = useTranslations('liveMap.country');
  const stamps = useStamps();
  const got = stamps.some((s) => country.eventIds?.includes(s.eventId));
  const stamp = got ? (
    <div className={m.roomLine} data-room-stamp="got">
      <Icon name="stamp" size={22} className={m.yellow} />
      <span className={m.roomStrong}>{t('stampGot', { country: country.name })}</span>
    </div>
  ) : after ? (
    <div className={m.roomLine} data-room-stamp="missed">
      <Icon name="stamp" size={22} className={m.muted} />
      <span>
        <span className={m.roomStrong}>{t('stampMissed', { country: country.name })}</span>
        <span className={m.roomSub}>{t('stampMissedText')}</span>
      </span>
    </div>
  ) : (
    <div className={m.roomLine} data-room-stamp="ahead">
      <Icon name="stamp" size={22} className={m.yellow} />
      <span>
        <span className={m.roomStrong}>{t('stampTitle', { country: country.name })}</span>
        {phone ? null : <span className={m.roomSub}>{t('stampText')}</span>}
      </span>
    </div>
  );
  return (
    <div className={cn(m.room, phone && m.roomPhone)} data-country-room="">
      {phone ? <div className={zp.smallCap}>{t('roomTitle')}</div> : null}
      {stamp}
      <NextLink href={country.href} className={cn('t2f-focus', m.cta)} data-country-room-link="">
        {t('room')}
        <Icon name="arrow-right" size={18} />
      </NextLink>
      {before ? (
        <ScheduleWide
          eventId={country.streams?.[0]?.eventId ?? country.eventIds?.[0]}
          city={country.city ?? country.name}
        />
      ) : null}
    </div>
  );
}

/** Після півночі: наступна північ — відкриває той пояс у тому самому вікні. */
function NextMidnight({
  zone,
  onSelectZone,
}: {
  zone: MapZone;
  onSelectZone: (id: string) => void;
}) {
  const t = useTranslations('liveMap.country');
  const locale = useLocale();
  const now = useNow();
  return (
    <button
      type="button"
      className={cn('t2f-focus', m.next)}
      data-next-zone={zone.id}
      onClick={() => onSelectZone(zone.id)}
    >
      <StateSwatch state="live" className={m.zoneSw} />
      <span className={m.nextBody}>
        <span className={m.roomStrong}>
          {t('nextTitle', { offset: utcLabel(zone.offsetMinutes) })}
        </span>
        <span className={m.roomSub}>
          {t('nextIn', { dur: formatDurationShort(Math.max(0, zone.midnightMs - now), locale) })} ·{' '}
          {zone.countries.length > NEXT_NAMES
            ? t('nextMore', {
                names: zone.countries
                  .filter((c) => !NOT_FIRST.has(c.iso))
                  .slice(0, NEXT_NAMES)
                  .map((c) => c.name)
                  .join(', '),
                count: zone.countries.length - NEXT_NAMES,
              })
            : zone.countries.map((c) => c.name).join(', ')}
        </span>
      </span>
      <Icon name="chevron-right" size={16} />
    </button>
  );
}
