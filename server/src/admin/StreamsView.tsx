/**
 * «Джерела» view (SPEC-21a AC-20): pure props → markup. Channels with blacklist toggle, approve and edit; the candidate
 * queue with state / event filters and per-candidate approve (default event preselected, any season event selectable),
 * reject with a reason, requeue; the quota line; the forms "додати канал" and "додати за videoId чи channelId".
 * Forms are uncontrolled: a submit reads its fields and hands one `StreamsActionBody` to `onAction`. Agent `note` and
 * every name are rendered as text; the evidence link only when it is `https:`; YouTube links never pass a referrer.
 * Section «Ключ агента пошуку» (owner only, like the whole slice): per `stream-agent` record whether a key is active
 * and since when, «Видати новий ключ» and «Відкликати ключ» behind a confirm step; a freshly issued key is shown once
 * from the slice's memory (`issuedKey`), never from the view.
 */
import {
  CANDIDATE_STATES,
  CHANNEL_ID_PATTERN,
  CHANNEL_KINDS,
  CHANNEL_PRIORITIES,
  STREAMS_NAME_MAX,
  STREAMS_REASON_MAX,
  VIDEO_ID_PATTERN,
  type ChannelKind,
  type ChannelPriority,
  type StreamsActionBody,
  type StreamsAgentKey,
  type StreamsViewCandidate,
  type StreamsViewChannel,
  type StreamsViewValue,
} from '@time2fest/contracts';
import type { FormEvent } from 'react';
import { STREAMS_TEXT as T } from './messages';

export type { StreamsViewValue };

export interface StreamsFilter {
  state?: string;
  eventId?: string;
  cursor?: string;
}

/** The key section's steps: ask (opens the confirm step), confirm, cancel, hide the shown key. */
export type AgentKeyStep = { step: 'ask'; op: 'issue' | 'revoke'; adminId: string } | { step: 'confirm' } | { step: 'cancel' } | { step: 'hide' };

export interface AgentKeyUi {
  /** The pending confirm step, if any. */
  confirming?: { op: 'issue' | 'revoke'; adminId: string } | null;
  /** The key just issued (slice memory only), shown once. */
  issuedKey?: { adminId: string; key: string } | null;
  onKey?: (step: AgentKeyStep) => void;
}

/** Section «Ключ агента пошуку»: status per `stream-agent` record, issue / revoke with a confirm step. */
export function AgentKeySection({ agents, confirming = null, issuedKey = null, onKey }: AgentKeyUi & { agents: StreamsAgentKey[] }) {
  const K = T.agentKey;
  return (
    <section data-testid="streams-agent-key">
      <h3>{K.title}</h3>
      {agents.length === 0 ? <p data-testid="streams-agent-key-none">{K.none}</p> : null}
      {agents.map((a) => {
        const asking = confirming?.adminId === a.adminId ? confirming.op : null;
        return (
          <div key={a.adminId} data-testid={`streams-agent-key-${a.adminId}`}>
            <p>
              <strong>{a.email}</strong>
              {' · '}
              <span data-testid={`streams-agent-key-status-${a.adminId}`}>
                {a.active ? `${K.active}${a.issuedAt ? ` · ${K.issuedAt}: ${a.issuedAt}` : ''}` : K.inactive}
              </span>
            </p>
            {asking ? (
              <p role="alertdialog" data-testid={`streams-agent-key-confirm-${a.adminId}`}>
                {asking === 'revoke' ? K.confirmRevoke : a.active ? K.confirmReplace : K.confirmIssue}{' '}
                <button type="button" data-testid={`streams-agent-key-yes-${a.adminId}`} onClick={() => onKey?.({ step: 'confirm' })}>
                  {K.confirm}
                </button>{' '}
                <button type="button" onClick={() => onKey?.({ step: 'cancel' })}>
                  {K.cancel}
                </button>
              </p>
            ) : (
              <p>
                <button
                  type="button"
                  data-testid={`streams-agent-key-issue-${a.adminId}`}
                  onClick={() => onKey?.({ step: 'ask', op: 'issue', adminId: a.adminId })}
                >
                  {K.issue}
                </button>
                {a.active ? (
                  <>
                    {' '}
                    <button type="button" data-testid={`streams-agent-key-revoke-${a.adminId}`} onClick={() => onKey?.({ step: 'ask', op: 'revoke', adminId: a.adminId })}>
                      {K.revoke}
                    </button>
                  </>
                ) : null}
              </p>
            )}
            {issuedKey?.adminId === a.adminId ? (
              <div data-testid={`streams-agent-key-shown-${a.adminId}`}>
                <p>{K.shownOnce}</p>
                <input type="text" readOnly value={issuedKey.key} aria-label={K.title} autoComplete="off" spellCheck={false} onFocus={(e) => e.currentTarget.select()} />{' '}
                <button type="button" onClick={() => onKey?.({ step: 'hide' })}>
                  {K.hide}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

export interface StreamsViewProps extends AgentKeyUi {
  view: StreamsViewValue;
  filter?: StreamsFilter;
  message?: string;
  onFilter?: (filter: StreamsFilter) => void;
  onAction?: (body: StreamsActionBody) => void;
  /** A form the slice refuses before sending (e.g. a missing reason). */
  onRefuse?: (message: string) => void;
}

const REL = 'noopener noreferrer nofollow';
const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
const channelUrl = (id: string) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
const httpsOnly = (u: string | null): string | null => {
  if (!u) return null;
  try {
    return new URL(u).protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
};
const DECIDABLE = new Set(['new', 'proposed']);
const REQUEUEABLE = new Set(['rejected']);

/** The field `name` of a submitted form, trimmed. */
const field = (e: FormEvent<HTMLFormElement>, name: string): string => String(new FormData(e.currentTarget).get(name) ?? '').trim();
const zonesOf = (raw: string) =>
  raw
    .split(',')
    .map((z) => z.trim())
    .filter((z) => z.length > 0);

export function StreamsView({ view, filter = {}, message, onFilter, onAction, onRefuse, confirming, issuedKey, onKey }: StreamsViewProps) {
  const submit = (build: (e: FormEvent<HTMLFormElement>) => StreamsActionBody | string) => (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const body = build(e);
    if (typeof body === 'string') return onRefuse?.(body);
    onAction?.(body);
    e.currentTarget.reset();
  };
  const withReason = (e: FormEvent<HTMLFormElement>, make: (reason: string) => StreamsActionBody) => {
    const reason = field(e, 'reason');
    return reason === '' ? T.reasonRequired : make(reason);
  };

  const channelFields = (c?: StreamsViewChannel) => (
    <>
      <label>
        {T.col.name}
        <input name="name" type="text" required maxLength={STREAMS_NAME_MAX} defaultValue={c?.name ?? ''} />
      </label>
      <label>
        {T.col.kind}
        <select name="kind" defaultValue={c?.kind ?? 'tv'}>
          {CHANNEL_KINDS.map((k) => (
            <option key={k} value={k}>
              {T.kind[k] ?? k}
            </option>
          ))}
        </select>
      </label>
      <label>
        {T.zonesHint}
        <input name="zones" type="text" maxLength={STREAMS_REASON_MAX} defaultValue={c?.zones.join(', ') ?? ''} />
      </label>
      <label>
        {T.col.priority}
        <select name="priority" defaultValue={String(c?.priority ?? CHANNEL_PRIORITIES[1])}>
          {CHANNEL_PRIORITIES.map((p) => (
            <option key={p} value={String(p)}>
              {p}
            </option>
          ))}
        </select>
      </label>
    </>
  );
  const fieldsOf = (e: FormEvent<HTMLFormElement>) => ({
    name: field(e, 'name'),
    kind: field(e, 'kind') as ChannelKind,
    zones: zonesOf(field(e, 'zones')),
    priority: Number(field(e, 'priority')) as ChannelPriority,
  });

  const eventOptions = (selected: string | null, withEmpty: boolean) => (
    <>
      {withEmpty ? <option value="">{T.noEvent}</option> : null}
      {view.events.map((ev) => (
        <option key={ev.eventId} value={ev.eventId}>
          {`${ev.eventId} · ${ev.zoneId} · ${ev.moment}${ev.eventId === selected ? ` (${T.defaultEvent})` : ''}`}
        </option>
      ))}
    </>
  );

  const channelRow = (c: StreamsViewChannel) => (
    <tr key={c.channelId} data-testid={`streams-channel-${c.channelId}`}>
      <td>{c.name}</td>
      <td>
        <a href={channelUrl(c.channelId)} target="_blank" rel={REL}>
          {c.channelId}
        </a>
      </td>
      <td>{T.kind[c.kind] ?? c.kind}</td>
      <td>{c.zones.join(', ') || T.noValue}</td>
      <td>{c.priority}</td>
      <td>{T.state[c.state] ?? c.state}</td>
      <td>{c.blacklisted ? `${T.blacklisted}${c.blacklistReason ? `: ${c.blacklistReason}` : ''}` : T.noValue}</td>
      <td>
        <form
          data-testid={`streams-blacklist-${c.channelId}`}
          onSubmit={submit((e) => withReason(e, (reason) => ({ action: c.blacklisted ? 'unblacklist' : 'blacklist', channelId: c.channelId, reason })))}
        >
          <input name="reason" type="text" aria-label={T.reasonLabel} placeholder={T.reasonLabel} maxLength={STREAMS_REASON_MAX} />
          <button type="submit">{c.blacklisted ? T.unblacklistDo : T.blacklistDo}</button>
        </form>
        {c.state === 'proposed' ? (
          <button type="button" data-testid={`streams-channel-approve-${c.channelId}`} onClick={() => onAction?.({ action: 'channel-approve', channelId: c.channelId })}>
            {T.approveChannel}
          </button>
        ) : null}
        <details>
          <summary>{T.edit}</summary>
          <form
            data-testid={`streams-edit-${c.channelId}`}
            onSubmit={submit((e) => ({
              action: 'channel-edit',
              channelId: c.channelId,
              ...fieldsOf(e),
              ...(field(e, 'state') === 'watched' || field(e, 'state') === 'off' ? { state: field(e, 'state') as 'watched' | 'off' } : {}),
            }))}
          >
            {channelFields(c)}
            <label>
              {T.col.state}
              <select name="state" defaultValue={c.state === 'off' ? 'off' : c.state === 'watched' ? 'watched' : ''}>
                <option value="">{T.noValue}</option>
                <option value="watched">{T.state.watched}</option>
                <option value="off">{T.state.off}</option>
              </select>
            </label>
            <button type="submit">{T.save}</button>
          </form>
        </details>
      </td>
    </tr>
  );

  const candidateRow = (c: StreamsViewCandidate) => {
    const evidence = httpsOnly(c.evidenceUrl);
    return (
      <tr key={c.videoId} data-testid={`streams-candidate-${c.videoId}`}>
        <td>
          <a href={videoUrl(c.videoId)} target="_blank" rel={REL}>
            {c.videoId}
          </a>
        </td>
        <td>{c.channelName ?? c.channelId ?? T.noValue}</td>
        <td>{c.foundBy.map((f) => T.foundBy[f] ?? f).join(', ')}</td>
        <td>
          {T.state[c.state] ?? c.state}
          {c.fromBlacklisted ? <strong data-testid={`streams-from-blacklisted-${c.videoId}`}>{` · ${T.fromBlacklisted}`}</strong> : null}
        </td>
        <td>{c.reason ? (T.reason[c.reason] ?? c.reason) : T.noValue}</td>
        <td>{c.eventId ?? T.noValue}</td>
        <td>{c.scheduledStartTime ?? T.noValue}</td>
        <td>{c.checkedAt ?? T.noValue}</td>
        <td>
          {c.note ?? ''}
          {evidence ? (
            <>
              {' '}
              <a href={evidence} target="_blank" rel={REL} data-testid={`streams-evidence-${c.videoId}`}>
                {T.evidence}
              </a>
            </>
          ) : null}
        </td>
        <td>
          {DECIDABLE.has(c.state) ? (
            <>
              <form
                data-testid={`streams-approve-${c.videoId}`}
                onSubmit={submit((e) => {
                  const eventId = field(e, 'eventId');
                  if (eventId === '') return T.pickEvent;
                  const reason = field(e, 'reason');
                  return { action: 'approve', videoId: c.videoId, eventId, ...(reason ? { reason } : {}) };
                })}
              >
                <select name="eventId" aria-label={T.col.event} defaultValue={c.defaultEventId ?? c.eventId ?? ''}>
                  {eventOptions(c.defaultEventId, true)}
                </select>
                <input name="reason" type="text" aria-label={T.reasonOptional} placeholder={T.reasonOptional} maxLength={STREAMS_REASON_MAX} />
                <button type="submit">{T.approveFor}</button>
              </form>
              <form data-testid={`streams-reject-${c.videoId}`} onSubmit={submit((e) => withReason(e, (reason) => ({ action: 'reject', videoId: c.videoId, reason })))}>
                <input name="reason" type="text" aria-label={T.reasonLabel} placeholder={T.reasonLabel} maxLength={STREAMS_REASON_MAX} />
                <button type="submit">{T.reject}</button>
              </form>
            </>
          ) : null}
          {REQUEUEABLE.has(c.state) ? (
            <button type="button" data-testid={`streams-requeue-${c.videoId}`} onClick={() => onAction?.({ action: 'requeue', videoId: c.videoId })}>
              {T.requeue}
            </button>
          ) : null}
        </td>
      </tr>
    );
  };

  return (
    <div data-testid="streams-slice">
      <AgentKeySection agents={view.agentKeys ?? []} confirming={confirming ?? null} issuedKey={issuedKey ?? null} onKey={onKey} />
      <section data-testid="streams-quota">
        <h3>{T.quota}</h3>
        <ul>
          {view.quota.map((q) => (
            <li key={q.cls} data-testid={`streams-quota-${q.cls}`}>
              {`${T.cls[q.cls] ?? q.cls}: ${q.used} / ${q.limit} (${q.percent}%) · ${T.resetAt}: ${q.resetAt}`}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="streams-channels">
        <h3>{T.channels}</h3>
        <form
          data-testid="streams-channel-add"
          onSubmit={submit((e) => {
            const channelId = field(e, 'channelId');
            if (!CHANNEL_ID_PATTERN.test(channelId)) return T.idRequired;
            return { action: 'channel-add', channelId, ...fieldsOf(e) };
          })}
        >
          <strong>{T.addChannel}</strong>
          <label>
            {T.col.channelId}
            <input name="channelId" type="text" required maxLength={64} />
          </label>
          {channelFields()}
          <button type="submit">{T.add}</button>
        </form>
        {view.channels.length === 0 ? <p>{T.noChannels}</p> : null}
        <table>
          <thead>
            <tr>
              {[T.col.name, T.col.channelId, T.col.kind, T.col.zones, T.col.priority, T.col.state, T.col.blacklist, T.col.actions].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{view.channels.map(channelRow)}</tbody>
        </table>
      </section>

      <section data-testid="streams-candidates">
        <h3>{T.candidates}</h3>
        <form
          data-testid="streams-candidate-add"
          onSubmit={submit((e) => {
            const id = field(e, 'id');
            const eventId = field(e, 'eventId');
            const extra = eventId ? { eventId } : {};
            if (VIDEO_ID_PATTERN.test(id)) return { action: 'candidate-add', videoId: id, ...extra };
            if (CHANNEL_ID_PATTERN.test(id)) return { action: 'candidate-add', channelId: id, ...extra };
            return T.idRequired;
          })}
        >
          <strong>{T.addCandidate}</strong>
          <label>
            {T.idLabel}
            <input name="id" type="text" required maxLength={64} />
          </label>
          <label>
            {T.eventOptional}
            <select name="eventId" defaultValue="">
              {eventOptions(null, true)}
            </select>
          </label>
          <button type="submit">{T.add}</button>
        </form>
        <div data-testid="streams-filters">
          <label>
            {T.filterState}
            <select data-testid="streams-filter-state" value={filter.state ?? ''} onChange={(e) => onFilter?.({ ...filter, state: e.target.value || undefined, cursor: undefined })}>
              <option value="">{T.any}</option>
              {CANDIDATE_STATES.map((s) => (
                <option key={s} value={s}>
                  {T.state[s] ?? s}
                </option>
              ))}
            </select>
          </label>
          <label>
            {T.filterEvent}
            <select data-testid="streams-filter-event" value={filter.eventId ?? ''} onChange={(e) => onFilter?.({ ...filter, eventId: e.target.value || undefined, cursor: undefined })}>
              <option value="">{T.any}</option>
              {view.events.map((ev) => (
                <option key={ev.eventId} value={ev.eventId}>
                  {ev.eventId}
                </option>
              ))}
            </select>
          </label>
        </div>
        {view.candidates.length === 0 ? <p>{T.noCandidates}</p> : null}
        <table>
          <thead>
            <tr>
              {[T.col.video, T.col.channel, T.col.foundBy, T.col.state, T.col.reason, T.col.event, T.col.scheduled, T.col.checked, T.col.note, T.col.actions].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{view.candidates.map(candidateRow)}</tbody>
        </table>
        {filter.cursor ? (
          <button type="button" onClick={() => onFilter?.({ ...filter, cursor: undefined })}>
            {T.firstPage}
          </button>
        ) : null}
        {view.next ? (
          <button type="button" data-testid="streams-next" onClick={() => onFilter?.({ ...filter, cursor: view.next })}>
            {T.nextPage}
          </button>
        ) : null}
      </section>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
