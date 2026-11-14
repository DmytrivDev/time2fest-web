'use client';

/**
 * «Рейтинг святкувань» (`/rating/`) за дошками `Desk-Rating-New` / `Phone-Rating-New` v2 (рішення власника 2026-11-07,
 * концепція `rating-concept-2026-11-07.md`). Один рейтинг — за зірками («Найкраще шоу року» скасовано). Сторінка з чатом:
 * - відлік до закриття (12 год після останнього Нового року);
 * - «Оціни, де ти був» — листівки святкувань зі штампом без оцінки (рядами по три, на телефоні — одна під одною);
 *   підтвердження оцінки, після — «Твоя оцінка · Дякуємо!» (без «Рейтинг ›» — ми вже тут); висота картки стала;
 * - «Усі святкування» за зваженою оцінкою: медалі золото / срібло / бронза, смужка, середня й кількість, колонка «Твоя
 *   оцінка» за рискою (не оцінив — «Оцінити» відкриває оцінку на місці чату); фільтр «Усі · Де я був»;
 * - «Ще попереду» — святкування, північ яких ще не настала;
 * - «Рейтинг у чотирьох числах» — 00:00, 1 оцінка, N святкувань, 12 год (варіант D, власник 2026-11-07).
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { useOverlay } from '@/components/shell/OverlayManager';
import { RATE_PANEL_ID, RatePanel } from './RatePanel';
import { FlagStrip } from '@/components/passport/FlagStrip';
import { cn } from '@/components/primitives/cn';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { StampArt } from '@/components/windows/StampArt';
import { StampRate } from '@/components/windows/StampRate';
import { useStamps } from '@/lib/api/hooks/passport';
import { getData } from '@/lib/data/load';
import { formatClock, formatCountdown, viewerTimeZone } from '@/lib/i18n/time';
import { ratingActions, useMyVotes, useRatingBoard } from '@/lib/api/hooks/rating';
import { RATING_OPEN_AFTER } from '@/lib/rating/rating';
import { isRateable } from '@/lib/passport/passport';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import s from './rating.module.css';

const dec = (n: number) => n.toFixed(1).replace('.', ',');

export function RatingPage() {
  const t = useTranslations('ratingPage');
  const tStamp = useTranslations('windows.achievement');
  const locale = useLocale();
  const ready = useTimeReady();
  const now = useNow();
  // Щосекунди, а не щохвилини: святкування з’являється в рейтингу й «Оціни, де ти був» разом зі штампом, без запізнення
  // (власник 2026-11-07). Розрахунок легкий — кілька десятків святкувань.
  const minute = Math.floor(now / 1000) * 1000;
  const stamps = useStamps();
  const overlay = useOverlay();
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const myVotes = useMyVotes();
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- позначка «клієнт змонтовано» (дані гостя з localStorage)
  useEffect(() => setMounted(true), []);
  // Картки, оцінені в цьому відвідуванні, лишаються з «Дякуємо!» — сторінка не перестрибує.
  const [ratedHere, setRatedHere] = useState<readonly string[]>([]);
  /** Оцінка, яку сервер не прийняв (стан для `http`; у `sim` — `?simFail=rating.vote:network`). */
  const [voteFailed, setVoteFailed] = useState<string | null>(null);

  const data = getData();
  const { status, state } = useRatingBoard(minute);
  const stampedIds = useMemo(() => new Set(mounted ? stamps.map((st) => st.eventId) : []), [stamps, mounted]);
  // Оцінки людини приходять із сервісу: поки дошка не завантажена, «Оціни, де ти був» не показуємо (щоб не блимали вже оцінені).
  const toRate = mounted && status === 'ready'
    ? stamps
        .map((st) => st.eventId)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .filter((id) => {
          const e = data.eventsById.get(id);
          return !!e && isRateable(data, id) && minute >= e.midnightMs + RATING_OPEN_AFTER && (myVotes[id] === undefined || ratedHere.includes(id));
        })
    : [];
  const waiting = toRate.filter((id) => myVotes[id] === undefined).length;
  const rows = filter === 'mine' ? state.rows.filter((r) => stampedIds.has(r.eventId)) : state.rows;
  const tz = viewerTimeZone();
  const closeDate = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: tz }).format(state.closeAt);
  const closeTime = formatClock(state.closeAt, { locale });
  // Скільки святкувань з трансляцією за свято (смужки — ті, що вже в рейтингу) і скільки часу оцінювання минуло (кільце).
  const total = state.rows.length + state.ahead.length;
  const firstMidnight = Math.min(...data.zones.map((z) => z.midnightMs));
  const closeProgress = Math.min(1, Math.max(0, (minute - firstMidnight) / (state.closeAt - firstMidnight)));

  // «Оцінити» в колонці «Твоя оцінка» — оцінка на місці чату (на телефоні — шторкою), власник 2026-11-07.
  const openRate = (eventId: string, city: string) =>
    overlay.open({
      id: RATE_PANEL_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('rateTitle'),
      description: city,
      content: <RatePanel eventId={eventId} />,
    });

  return (
    <div id="content" tabIndex={-1} className={cn(s.page, 'focus:outline-none')} data-page="S-RATING">
      <header className={s.head}>
        <h1 className={s.h1}>{t('title')}</h1>
        <p className={s.sub}>{t('subtitle')}</p>
      </header>

      <section className={s.countdown} aria-label={t('toClose')} data-rating-countdown={state.closed ? 'closed' : 'open'}>
        <span aria-hidden="true" className={s.cdIcon}>
          <Icon name="clock" size={22} />
        </span>
        <div className={s.cdText}>
          <p className={s.cdTitle}>{state.closed ? t('closed', { date: closeDate, time: closeTime }) : t('open', { date: closeDate, time: closeTime })}</p>
          <p className={s.cdMeta}>{t('meta', { votes: state.totalVotes, count: state.rows.length })}</p>
        </div>
        {!state.closed && ready ? (
          <div className={s.cdTimer}>
            <span className={s.cdLabel}>{t('toClose')}</span>
            <span className={s.cdValue} role="timer">
              {formatCountdown(state.closeAt - now)}
            </span>
          </div>
        ) : null}
      </section>

      {toRate.length && !state.closed ? (
        <section aria-labelledby="rating-rate" className={s.section}>
          <div className={s.sectionHead}>
            <h2 id="rating-rate" className={s.h2}>
              {t('rateTitle')}
            </h2>
            <span className={s.sectionSub}>{waiting ? t('rateSub', { count: waiting }) : t('rateDone')}</span>
          </div>
          <ul className={s.cards}>
            {toRate.map((id) => {
              const e = data.eventsById.get(id)!;
              const country = data.countriesByIso.get(e.countryIso);
              const city = data.citiesById.get(e.cityId)?.name.uk ?? '';
              const stars = myVotes[id];
              return (
                <li key={id} className={s.card} data-rate-card={id}>
                  <FlagStrip code={country?.flagCode ?? e.countryIso} />
                  <StampArt illustrationId={country?.illustrationId ?? 'generic'} stampText={tStamp('stamped', { city: city.toLocaleUpperCase('uk') })} />
                  <div className={s.cardBody}>
                    <p className={s.cardCity}>
                      <Flag code={country?.flagCode ?? e.countryIso} diameter={20} decorative />
                      {city}
                    </p>
                    <p className={s.cardMeta}>{t('mainCelebration', { country: country?.name.uk ?? '' })}</p>
                    <StampRate
                      layout="compact"
                      ratingLink={false}
                      rows={[{ eventId: id, city }]}
                      values={stars !== undefined ? { [id]: stars } : {}}
                      onRate={(eventId, v) => {
                        setRatedHere((cur) => (cur.includes(eventId) ? cur : [...cur, eventId]));
                        setVoteFailed(null);
                        void ratingActions.vote(eventId, v).then((ok) => {
                          if (!ok) setVoteFailed(eventId);
                        });
                      }}
                      className={s.cardRate}
                    />
                    {voteFailed === id ? (
                      <p role="alert" className={s.loadError} data-rating-error="vote">
                        <Icon name="alert" size={16} />
                        {t('voteFailed')}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="rating-all" className={s.section}>
        <div className={s.sectionHead}>
          <h2 id="rating-all" className={s.h2}>
            {t('allTitle')}
          </h2>
          <span className={s.sectionSub}>{t('allSub', { count: rows.length })}</span>
          <span className={s.spacer} />
          <div role="group" aria-label={t('filterLabel')} className={s.seg}>
            <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')} className={cn('t2f-focus', s.segBtn)}>
              {t('filterAll')}
            </button>
            <button type="button" aria-pressed={filter === 'mine'} onClick={() => setFilter('mine')} className={cn('t2f-focus', s.segBtn)}>
              {t('filterMine')}
            </button>
          </div>
        </div>
        <p className={s.note}>{t('note')}</p>
        {rows.length ? (
          <>
            <div className={s.colHead} aria-hidden="true">
              <span className={s.colPlace}>{t('colPlace')}</span>
              <span className={s.colName}>{t('colName')}</span>
              <span className={s.colBar} />
              <span className={s.colScore}>{t('colScore')}</span>
              <span className={s.colDivider} />
              <span className={s.colMine}>{t('colMine')}</span>
            </div>
            <ol className={s.list}>
              {rows.map((r) => {
                const stamped = stampedIds.has(r.eventId);
                return (
                  <li key={r.eventId} className={s.row} data-place={r.place <= 3 ? r.place : undefined} data-rating-row={r.eventId}>
                    <span className={s.medal} data-place={r.place <= 3 ? r.place : undefined}>
                      {r.place}
                    </span>
                    <NextLink href={r.href} className={cn('t2f-focus', s.name)}>
                      <Flag code={r.flagCode} diameter={22} decorative />
                      <span className={s.nameText}>{r.city}</span>
                    </NextLink>
                    <span className={s.barCell}>
                      <span aria-hidden="true" className={s.bar}>
                        <span style={{ width: `${Math.round((r.score / 5) * 100)}%` }} />
                      </span>
                      <span className={s.rowSub}>{t('rowSub', { mean: dec(r.mean), votes: r.votes })}</span>
                    </span>
                    <span className={s.score}>{dec(r.score)}</span>
                    <span aria-hidden="true" className={s.divider} />
                    <span className={s.mine}>
                      {r.mine ? (
                        <span className={s.minePill} aria-label={t('mineAria', { n: r.mine })}>
                          <Icon name="star" size={12} />
                          {r.mine}
                        </span>
                      ) : stamped && !state.closed ? (
                        <button type="button" onClick={() => openRate(r.eventId, r.city)} data-action="rate-open" className={cn('t2f-focus t2f-press', s.rateBtn)}>
                          {t('rateBtn')}
                        </button>
                      ) : (
                        <span className={s.dash}>—</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          </>
        ) : status === 'ready' ? (
          <p className={s.empty}>{filter === 'mine' ? t('noneMine') : t('none')}</p>
        ) : status === 'error' ? (
          // Стан для `http` (сервер не відповів); у `sim` — `?simFail=rating.board:network`.
          <div role="alert" className={s.loadError} data-rating-error="load">
            <Icon name="alert" size={18} />
            <span>{t('loadFailed')}</span>
            <button type="button" onClick={() => void ratingActions.reload()} className={cn('t2f-focus t2f-press', s.rateBtn)}>
              {t('retry')}
            </button>
          </div>
        ) : mounted ? (
          // Поки дошка вантажиться (`http`; у `sim` — `?simDelay=rating:3000`): скелет рядів, а не порожнеча.
          <ol className={s.list} aria-busy="true" data-rating-loading="">
            <li className="sr-only">{t('loadingRows')}</li>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} aria-hidden="true" className={s.row}>
                <Skeleton variant="circle" className={s.skelMedal} />
                <Skeleton variant="line" className={s.skelName} />
                <Skeleton variant="line" className={s.skelBar} />
              </li>
            ))}
          </ol>
        ) : null}
      </section>

      {state.ahead.length && !state.closed ? (
        <section aria-labelledby="rating-ahead" className={s.section}>
          <div className={s.sectionHead}>
            <h2 id="rating-ahead" className={s.h3}>
              {t('aheadTitle')}
            </h2>
            <span className={s.sectionSub}>{t('aheadSub')}</span>
          </div>
          <ul className={s.ahead}>
            {state.ahead.map((a) => (
              <li key={a.eventId} className={s.aheadItem}>
                <Flag code={a.flagCode} diameter={18} decorative />
                <b>{a.city}</b>
                {t('aheadAt', { time: formatClock(a.midnightMs, { locale }) })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* «Рейтинг у чотирьох числах» — варіант D дошки `Desk-Rating-Info` з правками власника (2026-11-07). */}
      <section aria-labelledby="rating-info" className={s.info} data-rating-info="">
        <h2 id="rating-info" className={s.h3}>
          {t('infoTitle')}
        </h2>
        <ul className={s.infoGrid}>
          <li className={s.infoTile}>
            <b className={s.infoNum}>00:00</b>
            <span className={s.infoText}>{t('info.who')}</span>
          </li>
          <li className={s.infoTile}>
            <b className={s.infoNum}>1</b>
            <span className={s.infoText}>{t('info.one')}</span>
            <span aria-hidden="true" className={s.infoStars}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Icon key={i} name="star" size={14} className={i < 4 ? s.infoStarOn : undefined} />
              ))}
            </span>
          </li>
          <li className={s.infoTile}>
            <b className={s.infoNum}>{total}</b>
            <span className={s.infoText}>{t('info.count', { count: total })}</span>
            <span aria-hidden="true" className={s.infoBars}>
              {Array.from({ length: total }, (_, i) => (
                <span key={i} data-on={i < state.rows.length || undefined} style={{ height: `${(5 + ((i * 7) % 12)) / 16}rem` }} />
              ))}
            </span>
          </li>
          <li className={s.infoTile}>
            <b className={s.infoNum}>{t('info.hours')}</b>
            <span className={s.infoText}>{t('info.close', { date: closeDate, time: closeTime })}</span>
            <svg aria-hidden="true" width="2.125rem" height="2.125rem" viewBox="0 0 36 36" className={s.infoRing}>
              <circle cx="18" cy="18" r="15" />
              <circle cx="18" cy="18" r="15" strokeDasharray="94.25" strokeDashoffset={94.25 * (1 - closeProgress)} transform="rotate(-90 18 18)" />
            </svg>
          </li>
        </ul>
      </section>
      <PageChat />
    </div>
  );
}
