'use client';
/** Interactive part of the moderation slice (AC-41, AC-43): the thresholds and ceilings form. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api';

export interface SpendView {
  usd: number;
  ceilingUsd: number;
  percent: number;
}

export interface TaskView {
  task: string;
  state: string;
  reason: string | null;
}

/** One provider for one task over the current 60 s window (each task has its own health window). */
export interface ProviderView {
  provider: string;
  task: string;
  status: string;
  reason: string | null;
  calls: number;
  p95Ms: number;
  errorPercent: number;
}

export interface ModerationFormValues {
  review: number;
  block: number;
  nightCeilingUsd: number;
  monthCeilingUsd: number;
}

export interface ModerationViewProps {
  night: SpendView | null;
  month: SpendView;
  tasks: TaskView[];
  providers: ProviderView[];
  settings: ModerationFormValues;
}

const TASKS: Record<string, string> = { moderation: 'Модерація', translation: 'Переклад' };
const STATES: Record<string, string> = { ai: 'AI працює', fallback: 'запасний фільтр' };
const REASONS: Record<string, string> = { unavailable: 'недоступний', slow: 'повільний', ceiling: 'стеля витрат', 'not-configured': 'без ключа' };
const PROVIDERS: Record<string, string> = { anthropic: 'Anthropic', deepseek: 'DeepSeek' };
const PROVIDER_STATUS: Record<string, string> = { available: 'доступний', unavailable: 'недоступний' };
const FIELDS: Record<string, string> = {
  review: 'поріг перевірки',
  block: 'поріг блокування',
  nightCeilingUsd: 'стеля за ніч',
  monthCeilingUsd: 'стеля за місяць',
};

const money = (n: number) => `$${n.toFixed(2)}`;

export function ModerationView({ night, month, tasks, providers, settings }: ModerationViewProps) {
  const router = useRouter();
  const [form, setForm] = useState<Record<keyof ModerationFormValues, string>>({
    review: String(settings.review),
    block: String(settings.block),
    nightCeilingUsd: String(settings.nightCeilingUsd),
    monthCeilingUsd: String(settings.monthCeilingUsd),
  });
  const [message, setMessage] = useState('');

  async function save() {
    const body = {
      review: Number(form.review),
      block: Number(form.block),
      nightCeilingUsd: Number(form.nightCeilingUsd),
      monthCeilingUsd: Number(form.monthCeilingUsd),
    };
    const res = await callApi('POST', '/globals/moderation-settings/save', body);
    const answer = res.body as { ok?: boolean; error?: { code?: string; fields?: string[] } } | null;
    if (res.status >= 200 && res.status < 300 && answer?.ok !== false) {
      setMessage('');
      router.refresh();
      return;
    }
    const fields = answer?.error?.fields?.map((f) => FIELDS[f] ?? f).join(', ');
    setMessage(answer?.error?.code === 'validation' ? `Дані не прийнято${fields ? `: ${fields}` : ''}.` : 'Не вдалося зберегти.');
  }

  const set = (k: keyof ModerationFormValues) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="moderation-slice">
      <ul>
        <li data-testid="spend-night">{night ? `Ніч: ${money(night.usd)} із ${money(night.ceilingUsd)} (${night.percent}%)` : 'Ніч: поза святковою ніччю'}</li>
        <li data-testid="spend-month">{`Місяць: ${money(month.usd)} із ${money(month.ceilingUsd)} (${month.percent}%)`}</li>
        {tasks.map((t) => (
          <li key={t.task} data-testid={`task-${t.task}`}>
            {`${TASKS[t.task] ?? t.task}: ${STATES[t.state] ?? t.state}${t.reason ? ` (${REASONS[t.reason] ?? t.reason})` : ''}`}
          </li>
        ))}
        {providers.map((p) => (
          <li key={`${p.provider}-${p.task}`} data-testid={`provider-${p.provider}-${p.task}`}>
            {`${PROVIDERS[p.provider] ?? p.provider}, ${TASKS[p.task] ?? p.task}: ${PROVIDER_STATUS[p.status] ?? p.status}${p.reason ? ` (${REASONS[p.reason] ?? p.reason})` : ''}` +
              ` · за 60 с: ${p.calls} викл., p95 ${p.p95Ms} мс, помилок ${p.errorPercent}%`}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {(Object.keys(FIELDS) as (keyof ModerationFormValues)[]).map((k) => (
          <label key={k} style={{ display: 'block' }}>
            {FIELDS[k]}
            <input name={k} type="number" step="any" value={form[k]} onChange={set(k)} />
          </label>
        ))}
        <button type="submit">Зберегти</button>
      </form>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
