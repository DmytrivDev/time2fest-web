'use client';

/**
 * «Машина часу» для тих, хто тестує демо (рішення власника 2026-11-11): тимчасовий пункт меню. Показує віртуальний час і
 * наступну північ; кнопки переносять за 15 хв · 5 хв · 1 хв · 30 с до неї. «Почати спочатку» — новий гість і старт ночі.
 * Відкривається на місці меню (десктоп — колонка чату, телефон — шторка), «‹ Назад» — до меню.
 */
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { getData } from '@/lib/data/load';
import { DEMO_SEED_KEY } from '@/lib/demo/seed';
import { formatTimeForViewer, utcLabel } from '@/lib/i18n/time';
import { useNow, useTimeMachine } from '@/lib/time/TimeProvider';
import { DEMO_START_MS } from '@/lib/time/timeMachine';
import { resetDeviceState } from '@/stores/resetDevice';
import ms from '@/components/shell/menu.module.css';
import s from './time-machine.module.css';

/** До наступної півночі, с (порядок — як у меню: від далекого до близького). */
export const DEMO_JUMPS = [15 * 60, 5 * 60, 60, 30] as const;

/** Перша північ після `now` (слот поясу) — місто представника поясу й інші міста слота. */
export function nextMidnight(now: number) {
  const data = getData();
  const slot = data.eventsBySlot.find((g) => g.midnightMs > now);
  if (!slot) return null;
  const zone = data.zonesById.get(slot.zoneId);
  const main = slot.events.find((e) => e.cityId === zone?.representativeCityId) ?? slot.events[0];
  const city = main ? data.citiesById.get(main.cityId)?.name.uk : undefined;
  const country = main ? data.countriesByIso.get(main.countryIso)?.name.uk : undefined;
  return { midnightMs: slot.midnightMs, zoneLabel: utcLabel(zone?.offsetMinutes ?? 0), city, country };
}

export function TimeMachineBody({ onJump }: { onJump?: () => void }) {
  const t = useTranslations('demoTime');
  const machine = useTimeMachine();
  const now = useNow({ granularity: 'second' });
  const next = nextMidnight(now);
  if (!machine) return null;

  const jump = (sec: number) => {
    if (!next) return;
    machine.set({ at: next.midnightMs - sec * 1_000 });
    onJump?.();
  };
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
  const leftMin = next ? Math.max(0, Math.ceil((next.midnightMs - now) / 60_000)) : 0;

  return (
    <div className={cn(ms.content, s.root)} data-demo-time="">
      <p className={s.note}>{t('note')}</p>
      <div className={s.clock}>
        <span className={s.label}>{t('now')}</span>
        <span className={s.time} data-demo-now="">
          {new Date(now).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
      {next ? (
        <div className={s.next}>
          <span className={s.label}>{t('next')}</span>
          <span className={s.place}>
            {next.city}
            {next.country && next.country !== next.city ? `, ${next.country}` : ''} · {next.zoneLabel}
          </span>
          <span className={s.when}>
            {formatTimeForViewer(next.midnightMs, { now }).text} · {t('inMinutes', { count: leftMin })}
          </span>
        </div>
      ) : (
        <p className={s.note}>{t('over')}</p>
      )}
      <ul className={s.jumps} aria-label={t('jumpsLabel')}>
        {DEMO_JUMPS.map((sec) => (
          <li key={sec}>
            <button type="button" disabled={!next} onClick={() => jump(sec)} className={cn('t2f-focus t2f-transition', s.jump)} data-demo-jump={sec}>
              <Icon name="clock" size={16} />
              {sec >= 60 ? t('beforeMin', { count: sec / 60 }) : t('beforeSec', { count: sec })}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={restart} className={cn('t2f-focus t2f-transition', s.restart)} data-demo-restart="">
        <Icon name="undo" size={16} />
        {t('restart')}
      </button>
      <p className={s.hint}>{t('restartHint')}</p>
    </div>
  );
}
