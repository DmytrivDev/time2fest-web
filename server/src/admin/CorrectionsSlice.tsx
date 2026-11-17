'use client';
/**
 * Corrections slice of the first screen (AC-53, AC-58): pick an event, edit moment / main / restrained
 * / hidden, see "було → стане" in a confirm dialog, save only after "Підтвердити". The rules live on the
 * server (`/preview`, `/save` of `event-patches`); this only shows the answers. Notes render as text.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { callApi } from './api';
import { buildChange, msToUtcInput, utcInputToMs, type EffectiveForm } from './corrections';
import { reasonOf, reasonText } from './messages';

interface EventDoc {
  eventId: string;
  countryIso: string;
  zoneId: string;
  slot: string;
  midnightUtc: string;
  startsAt?: string | null;
  isMainCelebration?: boolean;
}

interface PatchDoc {
  eventId: string;
  moment?: number | null;
  isMainCelebration?: boolean | null;
  restrained?: boolean;
  restrainedNote?: string | null;
  hidden?: boolean;
  version: number;
}

interface Effective {
  moment: number;
  isMainCelebration: boolean;
  restrained: { note: string } | null;
  hidden: boolean;
}

interface PreviewItem {
  eventId: string;
  requested: boolean;
  version: number;
  before: Effective;
  after: Effective;
  localTime: { before: string | null; after: string | null };
  changed: boolean;
}

interface Preview {
  items: PreviewItem[];
  warnings: string[];
}

const utcText = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const yesNo = (v: boolean) => (v ? 'так' : 'ні');

function baseMoment(e: EventDoc): number {
  return Date.parse(e.slot !== 'midnight' && e.startsAt ? e.startsAt : e.midnightUtc);
}

function currentOf(e: EventDoc, p: PatchDoc | undefined): EffectiveForm {
  return {
    moment: p?.moment ?? baseMoment(e),
    isMainCelebration: p?.isMainCelebration ?? e.isMainCelebration === true,
    restrained: p?.restrained === true,
    note: p?.restrainedNote ?? '',
    hidden: p?.hidden === true,
  };
}

export function CorrectionsSlice() {
  const [events, setEvents] = useState<EventDoc[]>([]);
  const [patches, setPatches] = useState<Record<string, PatchDoc>>({});
  const [filter, setFilter] = useState('');
  const [eventId, setEventId] = useState('');
  const [form, setForm] = useState<EffectiveForm | null>(null);
  const [momentText, setMomentText] = useState('');
  const [nextForm, setNextForm] = useState<EffectiveForm | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ev, pa] = await Promise.all([
      callApi('GET', '/events?limit=2000&depth=0&sort=eventId'),
      callApi('GET', '/event-patches?limit=2000&depth=0'),
    ]);
    setEvents(((ev.body as { docs?: EventDoc[] } | null)?.docs ?? []) as EventDoc[]);
    const docs = ((pa.body as { docs?: PatchDoc[] } | null)?.docs ?? []) as PatchDoc[];
    setPatches(Object.fromEntries(docs.map((d) => [d.eventId, d])));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const event = events.find((e) => e.eventId === eventId);
  const current = useMemo(() => (event ? currentOf(event, patches[event.eventId]) : null), [event, patches]);
  const shown = events.filter((e) => e.eventId.includes(filter.trim())).slice(0, 200);

  function pick(id: string) {
    setEventId(id);
    setPreview(null);
    setMessage('');
    const e = events.find((x) => x.eventId === id);
    if (!e) {
      setForm(null);
      return;
    }
    const cur = currentOf(e, patches[id]);
    setForm(cur);
    setMomentText(msToUtcInput(cur.moment));
  }

  function body(next: EffectiveForm, confirm: boolean) {
    const change = buildChange(current as EffectiveForm, next);
    return {
      changes: { [eventId]: change },
      expectedVersions: { [eventId]: patches[eventId]?.version ?? 0 },
      ...(confirm ? { confirmWarnings: true } : {}),
    };
  }

  async function save() {
    if (!event || !form || !current) return;
    const ms = utcInputToMs(momentText);
    if (ms === null) {
      setMessage('Момент має бути у форматі РРРР-ММ-ДДTГГ:ХХ (UTC).');
      return;
    }
    const next = { ...form, moment: ms };
    if (Object.keys(buildChange(current, next)).length === 0) {
      setMessage('Змін немає.');
      return;
    }
    setBusy(true);
    setMessage('');
    setNextForm(next);
    const res = await callApi('POST', '/event-patches/preview', body(next, false));
    setBusy(false);
    const answer = res.body as { ok?: boolean; value?: Preview } | null;
    if (answer?.ok === true && answer.value) setPreview(answer.value);
    else setMessage(reasonText(reasonOf(res.body)));
  }

  async function confirm() {
    if (!preview || !nextForm) return;
    setBusy(true);
    const res = await callApi('POST', '/event-patches/save', body(nextForm as EffectiveForm, preview.warnings.length > 0));
    setBusy(false);
    setPreview(null);
    if ((res.body as { ok?: unknown } | null)?.ok === true) {
      setMessage('Збережено.');
      await load();
    } else {
      setMessage(reasonText(reasonOf(res.body)));
    }
  }

  function cancel() {
    setPreview(null);
    setMessage('');
  }

  return (
    <div data-testid="corrections-slice">
      <label>
        Пошук події{' '}
        <input value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="corr-filter" />
      </label>{' '}
      <label>
        Подія{' '}
        <select value={eventId} onChange={(e) => pick(e.target.value)} data-testid="corr-event">
          <option value="">— оберіть —</option>
          {shown.map((e) => (
            <option key={e.eventId} value={e.eventId}>
              {`${e.eventId} (${e.countryIso}, ${e.zoneId}, ${e.slot})`}
            </option>
          ))}
        </select>
      </label>
      {form ? (
        <div>
          <p>
            <label>
              Момент (UTC){' '}
              <input type="datetime-local" value={momentText} onChange={(e) => setMomentText(e.target.value)} data-testid="corr-moment" />
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                checked={form.isMainCelebration}
                onChange={(e) => setForm({ ...form, isMainCelebration: e.target.checked })}
                data-testid="corr-main"
              />{' '}
              Головне святкування
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                checked={form.restrained}
                onChange={(e) => setForm({ ...form, restrained: e.target.checked })}
                data-testid="corr-restrained"
              />{' '}
              Стриманий режим
            </label>{' '}
            <label>
              Примітка{' '}
              <input
                value={form.note}
                maxLength={200}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                data-testid="corr-note"
              />
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                checked={form.hidden}
                onChange={(e) => setForm({ ...form, hidden: e.target.checked })}
                data-testid="corr-hidden"
              />{' '}
              Сховано
            </label>
          </p>
          <button type="button" onClick={save} disabled={busy} data-testid="corr-save">
            Зберегти
          </button>
        </div>
      ) : null}
      {message ? (
        <p role="status" data-testid="corr-message">
          {message}
        </p>
      ) : null}
      {preview ? (
        <div role="dialog" aria-modal="true" aria-label="Підтвердження поправки" data-testid="corr-dialog">
          <h3>Підтвердіть зміни</h3>
          {preview.items
            .filter((i) => i.changed)
            .map((i) => (
              <div key={i.eventId} data-testid="corr-item">
                <strong>{i.eventId}</strong>
                {i.before.moment !== i.after.moment ? (
                  <p data-testid="corr-diff-moment">
                    {`Момент: було ${utcText(i.before.moment)} → стане ${utcText(i.after.moment)}`}
                    {` (місцевий час: було ${i.localTime.before ?? '—'} → стане ${i.localTime.after ?? '—'})`}
                  </p>
                ) : null}
                {i.before.isMainCelebration !== i.after.isMainCelebration ? (
                  <p data-testid="corr-diff-main">{`Головне святкування: було ${yesNo(i.before.isMainCelebration)} → стане ${yesNo(i.after.isMainCelebration)}`}</p>
                ) : null}
                {i.before.restrained?.note !== i.after.restrained?.note || Boolean(i.before.restrained) !== Boolean(i.after.restrained) ? (
                  <p data-testid="corr-diff-restrained">
                    {`Стриманий режим: було ${i.before.restrained ? `так, «${i.before.restrained.note}»` : 'ні'} → стане ${i.after.restrained ? `так, «${i.after.restrained.note}»` : 'ні'}`}
                  </p>
                ) : null}
                {i.before.hidden !== i.after.hidden ? (
                  <p data-testid="corr-diff-hidden">{`Сховано: було ${yesNo(i.before.hidden)} → стане ${yesNo(i.after.hidden)}`}</p>
                ) : null}
                {!i.requested ? <p>Змінюється як наслідок (пара без головного святкування).</p> : null}
              </div>
            ))}
          {preview.warnings.map((w) => (
            <p key={w} role="alert" data-testid="corr-warning">
              {reasonText(w)}
            </p>
          ))}
          <button type="button" onClick={confirm} disabled={busy} data-testid="corr-confirm">
            Підтвердити
          </button>{' '}
          <button type="button" onClick={cancel} disabled={busy} data-testid="corr-cancel">
            Скасувати
          </button>
        </div>
      ) : null}
    </div>
  );
}
