'use client';
/**
 * Festival-state view (AC-75, AC-76, AC-78): polls the owner read path every 3 s (stops while the tab is hidden),
 * a block named in `errors` shows "недоступно" instead of data; clock controls only when `controls` is set.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { FestivalStateBlock, FestivalStateView as View } from '@time2fest/contracts';
import { callApi } from './api';
import { reasonOf, reasonText } from './messages';

const POLL_MS = 3000;
const kyiv = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', dateStyle: 'short', timeStyle: 'medium' });
const at = (ms: number) => kyiv.format(new Date(ms));
const sec = (ms: number | null) => (ms === null ? '—' : `${Math.round(ms / 1000)} с`);

type Confirm = { label: string; body: Record<string, unknown> } | null;

function Block({ id, bad, title, children }: { id: FestivalStateBlock; bad: boolean; title: string; children: ReactNode }) {
  return (
    <section data-testid={`festival-${id}`}>
      <h3>{title}</h3>
      {bad ? <p data-testid={`festival-${id}-error`}>недоступно</p> : children}
    </section>
  );
}

export function FestivalStateView({ controls }: { controls: boolean }) {
  const [view, setView] = useState<View | null>(null);
  const [updatedAt, setUpdatedAt] = useState('');
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [momentText, setMomentText] = useState('');
  const [confirm, setConfirm] = useState<Confirm>(null);

  const load = useCallback(async () => {
    const res = await callApi('GET', '/festival-state');
    if (res.status === 200 && res.body) {
      setView(res.body as View);
      setUpdatedAt(String(Date.now()));
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer !== undefined) return;
      void load();
      timer = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  async function run() {
    if (!confirm) return;
    const res = await callApi('POST', '/clock', confirm.body);
    const ok = res.status >= 200 && res.status < 300 && (res.body as { ok?: unknown } | null)?.ok !== false;
    setMessage(ok ? '' : reasonText(reasonOf(res.body)));
    setConfirm(null);
    if (ok) await load();
  }

  function askSet() {
    const ms = Date.parse(momentText);
    if (Number.isNaN(ms)) {
      setMessage('Вкажіть момент у форматі дати й часу (ISO).');
      return;
    }
    setMessage('');
    setConfirm({ label: `Виставити момент ${momentText} (швидкість 1)?`, body: { action: 'set', at: ms } });
  }

  if (!view) {
    return <div data-testid="festival-slice">{failed ? 'Стан свята недоступний.' : 'Завантаження…'}</div>;
  }

  const bad = (b: FestivalStateBlock) => view.errors?.includes(b) === true;
  const nextMoment = view.moments[0];

  return (
    <div data-testid="festival-slice" data-updated-at={updatedAt}>
      {failed ? <p role="alert">Оновлення не вдалося, показано попередній стан.</p> : null}
      <Block id="phase" bad={bad('phase')} title="Фаза">
        <p>{view.phase}</p>
      </Block>
      <Block id="slot" bad={bad('slot')} title="Слоти">
        <p>{`Поточний: ${view.slot.current ?? '—'}; наступний: ${view.slot.next ?? '—'}`}</p>
      </Block>
      <Block id="moments" bad={bad('moments')} title="Найближчі моменти">
        {view.moments.length === 0 ? (
          <p>Моментів немає.</p>
        ) : (
          <>
            <p data-testid="festival-next-moment" data-at={nextMoment?.at}>{`Наступний: ${nextMoment ? at(nextMoment.at) : '—'}`}</p>
            <ul>
              {view.moments.slice(0, 10).map((m) => (
                <li key={`${m.at}-${m.kind}-${m.subject ?? ''}`}>{`${at(m.at)} — ${m.kind}${m.subject ? ` (${m.subject})` : ''}`}</li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="scheduler" bad={bad('scheduler')} title="Планувальник">
        <p>{`Власник оренди: ${view.scheduler.holder ?? '—'}; епоха ${view.scheduler.epoch}; оренду оновлено ${sec(view.scheduler.renewedAgeMs)} тому; запізнення ${sec(view.scheduler.delayMs)}; пропущено за 24 год: ${view.scheduler.missed24h}`}</p>
      </Block>
      <Block id="edge" bad={bad('edge')} title="Розбіжність із краєм">
        <p>{view.edgeSkewMs === null ? '—' : `${view.edgeSkewMs} мс`}</p>
      </Block>
      <Block id="clock" bad={bad('clock')} title="Годинник">
        <p data-testid="festival-clock-text">
          {`${view.clock.virtual ? `віртуальний, швидкість ${view.clock.speed}` : 'справжній'}; епоха ${view.clock.epoch}${view.clock.now !== undefined ? `; зараз ${at(view.clock.now)}` : ''}`}
        </p>
      </Block>

      {controls ? (
        <div data-testid="festival-controls">
          <p>
            <label>
              Момент{' '}
              <input value={momentText} placeholder="2027-01-01T00:00:00Z" onChange={(e) => setMomentText(e.target.value)} data-testid="clock-moment" />
            </label>{' '}
            <button type="button" onClick={askSet} data-testid="clock-set">
              Виставити момент
            </button>{' '}
            <button type="button" onClick={() => setConfirm({ label: 'Повернути справжній час?', body: { action: 'real' } })} data-testid="clock-real">
              Повернути справжній час
            </button>{' '}
            <button type="button" onClick={() => setConfirm({ label: 'Почати ніч знову?', body: { action: 'restart-night' } })} data-testid="clock-restart">
              Почати ніч знову
            </button>
          </p>
          {confirm ? (
            <p data-testid="clock-confirm">
              {`${confirm.label} `}
              <button type="button" onClick={run} data-testid="clock-confirm-yes">
                Так
              </button>{' '}
              <button type="button" onClick={() => setConfirm(null)} data-testid="clock-confirm-no">
                Скасувати
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p role="alert" data-testid="festival-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
