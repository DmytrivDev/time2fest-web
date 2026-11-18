'use client';

/**
 * «Машина часу» для тих, хто тестує демо (рішення власника 2026-11-11, уточнення того ж дня): годинник у шапці праворуч.
 * Відкривається на місці чату (десктоп) або шторкою (телефон). Показує віртуальний час і дві півночі:
 * поточну — за 10 хв · 5 хв · 30 с, наступну за нею — за 15 хв · 5 хв · 1 хв. Поточна лишається поточною ще 5 хв після
 * півночі, щоб її можна було відмотати назад; потім поточною стає наступна. «На старт» — за 20 хв до півночі
 * Парижа (лише час); «Почати спочатку» — ще й новий гість.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { getData } from '@/lib/data/load';
import { DEMO_SEED_KEY } from '@/lib/demo/seed';
import { formatTimeForViewer, utcLabel } from '@/lib/i18n/time';
import { machineKit } from '@/lib/time/machineLoader';
import { useNow, useTimeMachine } from '@/lib/time/TimeProvider';
import { resetDeviceState } from '@/stores/resetDevice';
import ms from '@/components/shell/menu.module.css';
import s from './time-machine.module.css';

/** До найближчої півночі, с (від далекого до близького). */
export const DEMO_JUMPS_NEAR = [10 * 60, 5 * 60, 30] as const;
/** До наступної за нею півночі, с. */
export const DEMO_JUMPS_AFTER = [15 * 60, 5 * 60, 60] as const;

export interface DemoMidnight {
  midnightMs: number;
  zoneLabel: string;
  city?: string;
  country?: string;
}

/** Скільки після півночі вона ще «поточна» в машині часу (власник 2026-11-11). */
export const DEMO_CURRENT_HOLD_MS = 5 * 60_000;

/** `count` північ, починаючи з поточної (ще не настала або минуло < 5 хв), — місто представника поясу. */
export function upcomingMidnights(now: number, count = 2): DemoMidnight[] {
  const data = getData();
  return data.eventsBySlot
    .filter((g) => g.midnightMs > now - DEMO_CURRENT_HOLD_MS)
    .slice(0, count)
    .map((slot) => {
      const zone = data.zonesById.get(slot.zoneId);
      const main = slot.events.find((e) => e.cityId === zone?.representativeCityId) ?? slot.events[0];
      return {
        midnightMs: slot.midnightMs,
        zoneLabel: utcLabel(zone?.offsetMinutes ?? 0),
        city: main ? data.citiesById.get(main.cityId)?.name.uk : undefined,
        country: main ? data.countriesByIso.get(main.countryIso)?.name.uk : undefined,
      };
    });
}

/** «7:42» / «1:07:42» — скільки лишилось до півночі. */
function left(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1_000));
  const h = Math.floor(total / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function TimeMachineBody() {
  const t = useTranslations('demoTime');
  const machine = useTimeMachine();
  const now = useNow({ granularity: 'second' });
  // Без машини (робоча збірка — `machineKit` там немає, AC-58) вікна немає.
  if (!machine || !machineKit) return null;
  const { DEMO_START_MS } = machineKit;
  const [near, after] = upcomingMidnights(now, 2);

  const go = (at: number) => machine.set({ at });
  const restart = () => {
    // Годинник — на старт демо: при переході сторінка зберігає поточний віртуальний час (`pagehide`).
    machine.set({ at: DEMO_START_MS, speed: 1 });
    resetDeviceState();
    try {
      localStorage.removeItem(DEMO_SEED_KEY);
    } catch {
      /* сховище недоступне */
    }
    window.location.assign('/');
  };

  const card = (m: DemoMidnight, label: string, jumps: readonly number[], key: string) => (
    <section className={cn(s.card, key === 'near' && s.cardNear)} data-demo-midnight={key}>
      <span className={s.label}>{label}</span>
      <span className={s.place}>
        {m.city}
        {m.country && m.country !== m.city ? `, ${m.country}` : ''}
        <span className={s.zone}> · {m.zoneLabel}</span>
      </span>
      <span className={s.when}>
        {formatTimeForViewer(m.midnightMs, { now }).text} ·{' '}
        {m.midnightMs > now ? t('left', { time: left(m.midnightMs - now) }) : t('ago', { time: left(now - m.midnightMs) })}
      </span>
      <ul className={s.jumps} aria-label={t('jumpsLabel', { place: m.city ?? m.zoneLabel })}>
        {jumps.map((sec) => {
          const at = m.midnightMs - sec * 1_000;
          return (
            <li key={sec}>
              <button
                type="button"
                onClick={() => go(at)}
                className={cn('t2f-focus t2f-transition', s.jump)}
                data-demo-jump={`${key}:${sec}`}
              >
                {sec >= 60 ? t('beforeMin', { count: sec / 60 }) : t('beforeSec', { count: sec })}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <div className={cn(ms.content, s.root)} data-demo-time="">
      <div className={s.clock}>
        <span className={s.label}>{t('now')}</span>
        <span className={s.time} data-demo-now="">
          {new Date(now).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
      {near ? card(near, t('near'), DEMO_JUMPS_NEAR, 'near') : <p className={s.note}>{t('over')}</p>}
      {after ? card(after, t('after'), DEMO_JUMPS_AFTER, 'after') : null}
      <div className={s.actions}>
        <button type="button" onClick={() => go(DEMO_START_MS)} className={cn('t2f-focus t2f-transition', s.action)} data-demo-start="">
          <Icon name="clock" size={16} />
          <span className={s.actionText}>
            <span className={s.actionTitle}>{t('start')}</span>
            <span className={s.actionHint}>{t('startHint')}</span>
          </span>
        </button>
        <button type="button" onClick={restart} className={cn('t2f-focus t2f-transition', s.action)} data-demo-restart="">
          <Icon name="undo" size={16} />
          <span className={s.actionText}>
            <span className={s.actionTitle}>{t('restart')}</span>
            <span className={s.actionHint}>{t('restartHint')}</span>
          </span>
        </button>
      </div>
      <p className={s.note}>{t('note')}</p>
    </div>
  );
}
