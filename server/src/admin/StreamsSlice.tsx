'use client';
/** «Джерела» slice (SPEC-21a AC-20): polls the owner read path every 5 s (not while the tab is hidden) and sends the actions. */
import type { StreamsActionBody } from '@time2fest/contracts';
import { useCallback, useEffect, useState } from 'react';
import { callApi } from './api';
import { STREAMS_TEXT, streamsReasonText } from './messages';
import { StreamsView, type StreamsFilter, type StreamsViewValue } from './StreamsView';

const POLL_MS = 5000;

const queryOf = (f: StreamsFilter) => {
  const q = new URLSearchParams();
  if (f.state) q.set('state', f.state);
  if (f.eventId) q.set('eventId', f.eventId);
  if (f.cursor) q.set('cursor', f.cursor);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export function StreamsSlice() {
  const [view, setView] = useState<StreamsViewValue | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<StreamsFilter>({});
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', `/streams/view${queryOf(filter)}`).catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: StreamsViewValue } | null | undefined;
    if (res && res.status === 200 && answer?.ok && answer.value) {
      setView(answer.value);
      setFailed(false);
    } else setFailed(true);
  }, [filter]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function send(body: StreamsActionBody) {
    const res = await callApi('POST', `/streams/${body.action}`, body).catch(() => null);
    const ok = !!res && res.status >= 200 && res.status < 300 && (res.body as { ok?: boolean } | null)?.ok === true;
    setMessage(ok ? STREAMS_TEXT.saved : streamsReasonText(res?.body ?? null));
    if (ok) await load();
  }

  if (!view) return <p data-testid="streams-slice-state">{failed ? STREAMS_TEXT.unavailable : STREAMS_TEXT.loading}</p>;
  return (
    <StreamsView
      view={view}
      filter={filter}
      message={message || (failed ? STREAMS_TEXT.unavailable : '')}
      onFilter={setFilter}
      onAction={(body) => void send(body)}
      onRefuse={setMessage}
    />
  );
}
