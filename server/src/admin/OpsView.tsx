/** «Моніторинг» view (SPEC-13b AC-37): pure props → markup, `data-testid` on every block and every alarm row. All texts are in `messages.ts`. */
import type { Overview } from '../ops/overviewSchema';
import { OPS_TEXT as T } from './messages';

export interface OpsViewProps {
  overview: Overview;
  message?: string;
  onAcknowledge?: (id: string) => void;
}

const num = (n: number | null | undefined): string => (n === null || n === undefined ? T.noData : String(n));
const seconds = (n: number | null): string => (n === null ? T.noData : `${Math.round(n / 1000)} ${T.seconds}`);
const minutes = (n: number | null): string => (n === null ? T.noData : `${Math.round(n / 60_000)} ${T.minutes}`);
const bytes = (n: number | null): string => (n === null ? T.noData : `${(n / 1_048_576).toFixed(1)} MB`);
const yn = (v: boolean | null): string => (v === null ? T.noData : v ? T.yes : T.no);

function Block({ id, title, unavailable, red, children }: { id: string; title: string; unavailable: boolean; red?: boolean; children?: React.ReactNode }) {
  return (
    <section data-testid={`ops-${id}`} className={red ? 'ops-red' : undefined}>
      <h3>{title}</h3>
      {unavailable ? <p data-testid={`ops-${id}-error`}>{T.blockUnavailable}</p> : children}
    </section>
  );
}

export function OpsView({ overview, message, onAcknowledge }: OpsViewProps) {
  const b = overview.blocks;
  const spendLabel = (row: { key: string; state: string; note?: string }): string => {
    if (row.state === 'no-provider') return T.noProvider;
    if (row.state === 'unknown') return T.unknown;
    return row.key === 'cloudflare' ? T.cloudflareFloor : (row.note ?? '');
  };
  return (
    <div data-testid="ops-slice">
      <Block id="alarms" title={T.blocks.alarms} unavailable={b.alarms === null}>
        {b.alarms && (
          <>
            <p>{`${T.alarmsTotal}: ${b.alarms.total}`}</p>
            {b.alarms.items.length === 0 ? <p>{T.alarmsEmpty}</p> : null}
            <ul>
              {b.alarms.items.map((a) => (
                <li key={a.id} data-testid={`ops-alarm-${a.id}`}>
                  {`${a.domainTitle ?? T.unknownDomain} · ${a.kind} · ${a.raisedAt}`}
                  {a.meaning ? ` — ${a.meaning}` : ''}
                  {a.action ? ` (${T.action}: ${a.action})` : ''}{' '}
                  <button type="button" data-testid={`ops-ack-${a.id}`} onClick={() => onAcknowledge?.(a.id)}>
                    {T.acknowledge}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="log-alarms" title={T.blocks.logAlarms} unavailable={b.logAlarms === null}>
        {b.logAlarms && (
          <>
            {b.logAlarms.groups.length === 0 ? <p>{T.logEmpty}</p> : null}
            <ul>
              {b.logAlarms.groups.map((g) => (
                <li key={g.kind} data-testid={`ops-log-group-${g.kind}`}>
                  {`${g.domainTitle ?? T.unknownDomain} · ${g.kind} · ${g.count} ${T.count} · ${T.last}: ${g.lastAt}`}
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="time" title={T.blocks.time} unavailable={b.time === null} red={b.time?.over === true}>
        {b.time && (
          <p>
            {`${T.skew}: ${b.time.edgeSkewMs === null ? T.noData : `${b.time.edgeSkewMs} ${T.ms}`} (${T.threshold} ${b.time.thresholdMs} ${T.ms}; ${T.over}: ${yn(b.time.over)})`}
            {b.time.virtual ? ` · ${T.clockVirtual} ×${b.time.speed}` : ''}
          </p>
        )}
      </Block>
      <Block id="scheduler" title={T.blocks.scheduler} unavailable={b.scheduler === null} red={b.scheduler?.over === true}>
        {b.scheduler && (
          <ul>
            <li>{`${T.holder}: ${b.scheduler.holder ?? T.noData} · ${T.epoch} ${b.scheduler.epoch}`}</li>
            <li>{`${T.lag}: ${b.scheduler.lagMs === null ? T.lagUnknown : seconds(b.scheduler.lagMs)} (${T.threshold} ${seconds(b.scheduler.lagThresholdMs)}; ${T.over}: ${yn(b.scheduler.over)})`}</li>
            <li>{`${T.renewedAge}: ${seconds(b.scheduler.renewedAgeMs)}`}</li>
            <li>{`${T.missed}: ${b.scheduler.missed24h}`}</li>
          </ul>
        )}
      </Block>
      <Block id="catalog" title={T.blocks.catalog} unavailable={b.catalog === null}>
        {b.catalog && (
          <ul>
            <li>{`${T.season}: ${b.catalog.seasonKey ?? T.noData} · ${T.generatedAt}: ${b.catalog.generatedAt ?? T.noData}`}</li>
            <li>{`${T.r2Ok}: ${b.catalog.r2LastOkAt ?? T.never}`}</li>
            <li>{`${T.r2Failed}: ${b.catalog.r2LastFailedAt ?? T.never}`}</li>
          </ul>
        )}
      </Block>
      <Block id="site" title={T.blocks.site} unavailable={b.site === null} red={b.site?.outage === true}>
        {b.site && (
          <>
            <p>{`${T.version}: ${b.site.version} · ${T.outage}: ${yn(b.site.outage)} · ${T.paymentsPause}: ${b.site.paymentsPause ?? T.no}`}</p>
            <ul>
              {Object.entries(b.site.switches).map(([k, v]) => (
                <li key={k}>{`${k}: ${v ? T.on : T.off}`}</li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="live" title={T.blocks.live} unavailable={b.live === null}>
        {b.live && (
          <>
            <p>{`${T.version}: ${b.live.version} · ${T.sources}: ${b.live.sources.total} (${T.sourcesDead}: ${b.live.sources.dead}, ${T.sourcesHidden}: ${b.live.sources.hidden})`}</p>
            <ul>
              {b.live.quota.map((q) => (
                <li key={q.bucket} data-testid={`ops-quota-${q.bucket}`}>{`${T.quota} ${q.bucket}: ${q.used} / ${q.perDay} (${q.percent}%)`}</li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="moderation" title={T.blocks.moderation} unavailable={b.moderation === null}>
        {b.moderation && (
          <>
            <p>
              {`${T.nightSpend}: ${b.moderation.night ? `${b.moderation.night.usd} ${T.spendOf} ${b.moderation.night.ceilingUsd} (${b.moderation.night.percent}%)` : T.noData}`}
              {` · ${T.monthSpend}: ${b.moderation.month ? `${b.moderation.month.usd} ${T.spendOf} ${b.moderation.month.ceilingUsd} (${b.moderation.month.percent}%)` : T.noData}`}
            </p>
            <ul>
              {b.moderation.tasks.map((t) => (
                <li key={t.task}>{`${T.tasks} ${t.task}: ${t.state}${t.reason ? ` (${t.reason})` : ''}`}</li>
              ))}
              {b.moderation.providers.map((p) => (
                <li key={`${p.provider}-${p.task}`}>{`${T.providers} ${p.provider}/${p.task}: ${p.status}`}</li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block id="backups" title={T.blocks.backups} unavailable={b.backups === null}>
        {b.backups && (
          <ul>
            <li data-testid="ops-backup-last">
              {b.backups.last
                ? `${T.lastBackup}: ${b.backups.last.at} · ${b.backups.last.kind} · ${b.backups.last.result === 'ok' ? T.ok : `${T.failed}${b.backups.last.stage ? ` (${T.stage} ${b.backups.last.stage})` : ''}`}`
                : `${T.lastBackup}: ${T.never}`}
            </li>
            <li data-testid="ops-backup-last-ok">
              {b.backups.lastOk
                ? `${T.lastOkBackup}: ${b.backups.lastOk.at} · ${bytes(b.backups.lastOk.size)} · ${T.age} ${minutes(b.backups.lastOk.ageMs)}`
                : `${T.lastOkBackup}: ${T.never}`}
            </li>
            <li data-testid="ops-backup-restore">
              {b.backups.lastRestore
                ? `${T.lastRestore}: ${b.backups.lastRestore.at} · ${b.backups.lastRestore.result === 'ok' ? T.ok : T.failed} · ${T.duration} ${seconds(b.backups.lastRestore.durationMs)} · ${T.loss} ${minutes(b.backups.lastRestore.lossWindowMs)}`
                : `${T.lastRestore}: ${T.notMeasured}`}
            </li>
          </ul>
        )}
      </Block>
      <Block id="telegram" title={T.blocks.telegram} unavailable={b.telegram === null} red={b.telegram?.red === true}>
        {b.telegram && (
          <p>
            {`${b.telegram.status === 'configured' ? T.configured : T.notConfigured} · ${T.lastHeartbeat}: ${b.telegram.lastDeliveredAt ?? T.never} · ${b.telegram.inWindow ? T.inWindow : T.outOfWindow}`}
            {b.telegram.silentForMs !== null ? ` · ${T.silentFor}: ${minutes(b.telegram.silentForMs)}` : ''}
          </p>
        )}
      </Block>
      <Block id="spend" title={T.blocks.spend} unavailable={b.spend === null}>
        {b.spend && (
          <ul>
            {b.spend.rows.map((r) => (
              <li key={r.key} data-testid={`ops-spend-${r.key}`}>
                {`${r.title}: ${r.percent === null ? T.noData : `${num(r.amount)} ${T.spendOf} ${num(r.ceiling)} (${r.percent}%)`}`}
                {spendLabel(r) ? ` · ${spendLabel(r)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block id="pending" title={T.blocks.pending} unavailable={b.pending === null}>
        {b.pending && (
          <ul>
            {b.pending.rows.map((r) => (
              <li key={r.metricKey} data-testid={`ops-pending-${r.metricKey}`}>{`${r.domainTitle} · ${r.title}: ${T.noData} (${T.pendingWave} ${r.ownerWave})`}</li>
            ))}
          </ul>
        )}
      </Block>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
