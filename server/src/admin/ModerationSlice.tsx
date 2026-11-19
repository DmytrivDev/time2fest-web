/** Moderation and AI slice of the first screen (AC-41, AC-43): spend, ceilings, thresholds, task states, per-provider p95 and error share; the form is a client part. */
import { processDeps } from '../adapters/processDeps';
import { moderationOf } from '../endpoints/deps';
import { ModerationView, type ModerationViewProps } from './ModerationView';

const pct = (usd: number, ceiling: number) => (ceiling > 0 ? Math.round((usd / ceiling) * 1000) / 10 : 0);

export async function ModerationSlice() {
  const m = moderationOf(await processDeps());
  const settings = await m.settings.read();
  const totals = m.spend.totals();
  const spend = (b: { usd: number; ceilingUsd: number } | null): ModerationViewProps['night'] =>
    b === null ? null : { usd: b.usd, ceilingUsd: b.ceilingUsd, percent: pct(b.usd, b.ceilingUsd) };
  return (
    <ModerationView
      night={spend(totals.night)}
      month={spend(totals.month) ?? { usd: 0, ceilingUsd: settings.monthCeilingUsd, percent: 0 }}
      tasks={(['moderation', 'translation'] as const).map((t) => {
        const s = m.layer.state(t);
        return { task: t, state: s.state, reason: s.reason ?? null };
      })}
      providers={m.layer.stats().map((p) => ({
        provider: p.provider,
        status: p.status,
        reason: p.reason ?? null,
        calls: p.calls,
        p95Ms: p.p95Ms,
        errorPercent: Math.round(p.errorShare * 1000) / 10,
      }))}
      settings={{
        review: settings.reviewThreshold,
        block: settings.blockThreshold,
        nightCeilingUsd: settings.nightCeilingUsd,
        monthCeilingUsd: settings.monthCeilingUsd,
      }}
    />
  );
}
