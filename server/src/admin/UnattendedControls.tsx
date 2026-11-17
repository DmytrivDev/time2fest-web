'use client';
/** Interactive part of the unattended slice (AC-38): manual switch, window form, alarm acknowledge. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi, type ApiAnswer } from './api';
import { reasonOf, reasonText } from './messages';

export interface WindowView {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface AlarmView {
  id: string;
  source: string;
  code: string;
  raisedAt: string;
}

export interface UnattendedControlsProps {
  on: boolean;
  causeText: string;
  manualUntil: string | null;
  windows: WindowView[];
  alarms: AlarmView[];
}

export function UnattendedControls({ on, causeText, manualUntil, windows, alarms }: UnattendedControlsProps) {
  const router = useRouter();
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [acked, setAcked] = useState<string[]>([]);

  const done = (res: ApiAnswer) => {
    const ok = res.status >= 200 && res.status < 300 && (res.body as { ok?: unknown } | null)?.ok !== false;
    setMessage(ok ? '' : reasonText(reasonOf(res.body)));
    return ok;
  };

  async function manual(next: boolean) {
    if (done(await callApi('POST', '/globals/unattended-state/manual', { on: next }))) router.refresh();
  }

  async function addWindow() {
    const res = await callApi('POST', '/unattended-windows', { startsAtKyiv: start, endsAtKyiv: end, ...(label ? { label } : {}) });
    if (done(res)) {
      setStart('');
      setEnd('');
      setLabel('');
      router.refresh();
    }
  }

  async function acknowledge(id: string) {
    if (done(await callApi('POST', `/alarms/${id}/acknowledge`))) {
      setAcked((a) => [...a, id]);
      router.refresh();
    }
  }

  return (
    <div data-testid="unattended-slice">
      <p data-testid="unattended-state">{`Стан: ${on ? 'увімкнено' : 'вимкнено'} (${causeText})`}</p>
      {manualUntil ? <p>{`Ручне перемикання діє до ${manualUntil}`}</p> : null}
      <button type="button" onClick={() => manual(!on)} data-testid="unattended-toggle">
        {on ? 'Вимкнути режим без нагляду' : 'Увімкнути режим без нагляду'}
      </button>

      <h3>Вікна сну (час Київ)</h3>
      {windows.length === 0 ? (
        <p>Вікон немає.</p>
      ) : (
        <ul data-testid="unattended-windows">
          {windows.map((w) => (
            <li key={w.id}>{`${w.startsAt} — ${w.endsAt}`}</li>
          ))}
        </ul>
      )}
      <p>
        <label>
          Початок{' '}
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} data-testid="window-start" />
        </label>{' '}
        <label>
          Кінець{' '}
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="window-end" />
        </label>{' '}
        <label>
          Підпис{' '}
          <input value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} data-testid="window-label" />
        </label>{' '}
        <button type="button" onClick={addWindow} data-testid="window-add">
          Додати вікно
        </button>
      </p>

      <h3>Відкриті тривоги</h3>
      {alarms.length === 0 ? (
        <p>Відкритих тривог немає.</p>
      ) : (
        <ul data-testid="alarms-open">
          {alarms.map((a) => (
            <li key={a.id} data-testid="alarm-row">
              {`${a.source}: ${a.code} (${a.raisedAt}) `}
              <button type="button" onClick={() => acknowledge(a.id)} data-testid="alarm-ack">
                Підтвердити
              </button>
            </li>
          ))}
        </ul>
      )}
      {acked.length > 0 ? <p data-testid="alarm-acked">{`Підтверджено: ${acked.join(', ')}`}</p> : null}
      {message ? (
        <p role="alert" data-testid="unattended-error">
          {message}
        </p>
      ) : null}
    </div>
  );
}
