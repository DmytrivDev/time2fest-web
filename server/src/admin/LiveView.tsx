/** «Ефір» view (SPEC-12 AC-50): pure props → markup. Sources of the current/next slot with the five actions, three quota buckets. */
import type { LiveView as LiveViewData, LiveViewQuota } from '../live/actions';
import { LIVE_TEXT } from './messages';

export type LiveQuotaRow = LiveViewQuota & { percent: number };
export type LiveViewValue = Omit<LiveViewData, 'quota'> & { quota: LiveQuotaRow[] };

/** An action the owner sends; the reason is added by the slice. */
export type LiveAction =
  | { action: 'hide' | 'unhide' | 'main' | 'override'; eventId: string; sourceId: string; status?: 'live' }
  | { action: 'zone-live'; zoneId: string; live: boolean }
  | { action: 'replace'; eventId: string; sourceId: string; videoId: string };

export interface LiveViewProps {
  view: LiveViewValue;
  reason?: string;
  videoId?: string;
  message?: string;
  onReason?: (value: string) => void;
  onVideoId?: (value: string) => void;
  onAction?: (action: LiveAction) => void;
}

export function LiveView({ view, reason, videoId, message, onReason, onVideoId, onAction }: LiveViewProps) {
  const send = (action: LiveAction) => () => onAction?.(action);
  return (
    <div data-testid="live-slice">
      <label style={{ display: 'block' }}>
        {LIVE_TEXT.reason}
        <input name="reason" type="text" maxLength={200} value={reason ?? ''} onChange={(e) => onReason?.(e.target.value)} />
      </label>
      <label style={{ display: 'block' }}>
        {LIVE_TEXT.videoId}
        <input name="videoId" type="text" maxLength={64} value={videoId ?? ''} onChange={(e) => onVideoId?.(e.target.value)} />
      </label>
      {view.slots.map((slot) => (
        <section key={slot.which} data-testid={`live-slot-${slot.which}`}>
          <h3>{`${slot.which === 'current' ? LIVE_TEXT.current : LIVE_TEXT.next} — ${slot.moment}`}</h3>
          {slot.events.length === 0 ? <p>{LIVE_TEXT.noEvents}</p> : null}
          {slot.events.map((event) => (
            <div key={event.eventId} data-testid={`live-event-${event.eventId}`}>
              <h4>{`${event.eventId} · ${LIVE_TEXT.zone} ${event.zoneId}${event.zoneLiveUntil ? ` · ${LIVE_TEXT.zoneLiveUntil} ${event.zoneLiveUntil}` : ''}`}</h4>
              <button type="button" data-testid={`zone-live-${event.eventId}`} onClick={send({ action: 'zone-live', zoneId: event.zoneId, live: !event.zoneLiveUntil })}>
                {event.zoneLiveUntil ? LIVE_TEXT.zoneLiveOff : LIVE_TEXT.zoneLive}
              </button>
              {event.sources.length === 0 ? <p>{LIVE_TEXT.noSources}</p> : null}
              <ul>
                {event.sources.map((s) => {
                  const ref = { eventId: event.eventId, sourceId: s.sourceId };
                  return (
                    <li key={s.sourceId} data-testid={`live-source-${s.sourceId}`}>
                      {`${s.label ?? s.sourceId} (${s.videoId ?? '—'}) · ${s.status ?? '—'} · ${s.served ? `${LIVE_TEXT.served}: ${s.served}` : LIVE_TEXT.notServed}`}
                      {s.hidden ? ` · ${LIVE_TEXT.hidden}` : ''}
                      {s.dead ? ` · ${LIVE_TEXT.dead}` : ''}
                      {s.override ? ` · ${s.override}` : ''}{' '}
                      <button type="button" data-testid={`hide-${s.sourceId}`} onClick={send({ action: s.hidden ? 'unhide' : 'hide', ...ref })}>
                        {s.hidden ? LIVE_TEXT.unhide : LIVE_TEXT.hide}
                      </button>
                      <button type="button" data-testid={`main-${s.sourceId}`} onClick={send({ action: 'main', ...ref })}>{LIVE_TEXT.main}</button>
                      <button type="button" data-testid={`override-${s.sourceId}`} onClick={send({ action: 'override', status: 'live', ...ref })}>{LIVE_TEXT.override}</button>
                      <button type="button" data-testid={`replace-${s.sourceId}`} onClick={send({ action: 'replace', ...ref, videoId: (videoId ?? '').trim() })}>{LIVE_TEXT.replace}</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <section data-testid="live-quota">
        <h3>{LIVE_TEXT.quota}</h3>
        <ul>
          {view.quota.map((q) => (
            <li key={q.bucket} data-testid={`quota-${q.bucket}`}>
              {`${LIVE_TEXT.bucket[q.bucket] ?? q.bucket}: ${LIVE_TEXT.used} ${q.used} / ${q.perDay} (${q.percent}%) · ${LIVE_TEXT.resetAt}: ${q.resetAt}`}
            </li>
          ))}
        </ul>
      </section>
      {message ? <p role="alert">{message}</p> : null}
    </div>
  );
}
