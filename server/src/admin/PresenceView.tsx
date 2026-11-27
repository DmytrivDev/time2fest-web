/** «Присутність» view (SPEC-14 W38, AC-19): the season's health records, downtime records and a «Додати простій» form. Records are never edited or removed. */
import { useState } from 'react';

export interface PresenceRecordRow {
  eventId: string;
  moment: string | null;
  state: string;
  signs: string[];
  recordedBy: string;
  alarmed: boolean;
}
export interface PresenceDowntimeRow {
  id: string;
  kind: string;
  eventId: string | null;
  from: string | null;
  to: string | null;
  region: string | null;
  reason: string | null;
  recordedBy: string;
}
export interface PresenceSampleRow {
  node: string;
  samples: number;
  lastAt: string | null;
  accepted: number;
  failed: number;
}
export interface PresenceData {
  season: string | null;
  records: PresenceRecordRow[];
  downtimes: PresenceDowntimeRow[];
  samples: PresenceSampleRow[];
}

export const PRESENCE_TEXT = {
  loading: 'Завантаження присутності…',
  unavailable: 'Присутність недоступна.',
  noSeason: 'Сезону ще немає.',
  records: 'Вікна подій',
  downtimes: 'Записи простою',
  samples: 'Вузли за добу',
  empty: 'Записів немає.',
  add: 'Додати простій',
  eventId: 'Подія (необов’язково, якщо є проміжок)',
  from: 'Від (UTC, РРРР-ММ-ДДTГГ:ХХ)',
  to: 'До (UTC, РРРР-ММ-ДДTГГ:ХХ)',
  reason: 'Причина (до 200 символів)',
  saved: 'Збережено.',
  failed: 'Не вдалося виконати дію.',
  invalid: 'Вкажіть подію або проміжок часу й причину.',
  notFound: 'Такої події немає в каталозі.',
  appendOnly: 'Записи лише додаються: прибрати чи змінити їх не можна.',
} as const;

export function PresenceView(props: {
  data: PresenceData;
  message: string;
  onAdd(body: { eventId?: string; from?: number; to?: number; reason: string }): void;
}) {
  const [eventId, setEventId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [local, setLocal] = useState('');

  function submit() {
    const f = from.trim() === '' ? undefined : Date.parse(`${from.trim()}:00Z`);
    const t = to.trim() === '' ? undefined : Date.parse(`${to.trim()}:00Z`);
    const id = eventId.trim();
    const bad = (f !== undefined && !Number.isFinite(f)) || (t !== undefined && !Number.isFinite(t)) || (f === undefined) !== (t === undefined);
    if (bad || (id === '' && f === undefined) || reason.trim() === '') return setLocal(PRESENCE_TEXT.invalid);
    setLocal('');
    props.onAdd({ ...(id !== '' ? { eventId: id } : {}), ...(f !== undefined && t !== undefined ? { from: f, to: t } : {}), reason: reason.trim() });
    setReason('');
  }

  const { data } = props;
  const message = local || props.message;
  return (
    <div data-testid="presence-slice">
      {message ? <p role="status">{message}</p> : null}
      {data.season === null ? <p>{PRESENCE_TEXT.noSeason}</p> : <p>{data.season}</p>}
      <h3>{PRESENCE_TEXT.records}</h3>
      {data.records.length === 0 ? (
        <p>{PRESENCE_TEXT.empty}</p>
      ) : (
        <table>
          <tbody>
            {data.records.map((r) => (
              <tr key={`${r.eventId}-${r.moment}`}>
                <td>{r.eventId}</td>
                <td>{r.moment}</td>
                <td>{r.state}</td>
                <td>{r.signs.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{PRESENCE_TEXT.downtimes}</h3>
      {data.downtimes.length === 0 ? (
        <p>{PRESENCE_TEXT.empty}</p>
      ) : (
        <table>
          <tbody>
            {data.downtimes.map((d) => (
              <tr key={d.id}>
                <td>{d.kind}</td>
                <td>{d.eventId ?? d.region ?? ''}</td>
                <td>{d.from}</td>
                <td>{d.to}</td>
                <td>{d.reason ?? ''}</td>
                <td>{d.recordedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>{PRESENCE_TEXT.samples}</h3>
      <table>
        <tbody>
          {data.samples.map((s) => (
            <tr key={s.node}>
              <td>{s.node}</td>
              <td>{s.samples}</td>
              <td>{s.lastAt}</td>
              <td>{s.accepted}</td>
              <td>{s.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>{PRESENCE_TEXT.appendOnly}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input value={eventId} onChange={(e) => setEventId(e.target.value)} maxLength={128} aria-label={PRESENCE_TEXT.eventId} placeholder={PRESENCE_TEXT.eventId} />
        <input value={from} onChange={(e) => setFrom(e.target.value)} aria-label={PRESENCE_TEXT.from} placeholder={PRESENCE_TEXT.from} />
        <input value={to} onChange={(e) => setTo(e.target.value)} aria-label={PRESENCE_TEXT.to} placeholder={PRESENCE_TEXT.to} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} aria-label={PRESENCE_TEXT.reason} placeholder={PRESENCE_TEXT.reason} />
        <button type="submit">{PRESENCE_TEXT.add}</button>
      </form>
    </div>
  );
}
