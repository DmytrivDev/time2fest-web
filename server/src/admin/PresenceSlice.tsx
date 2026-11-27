'use client';
/** «Присутність» slice (SPEC-14 W38, AC-19): polls the owner view every 5 s (not while the tab is hidden); adds a manual downtime through `/cms-api/presence/downtime`. */
import { useCallback, useEffect, useState } from 'react';
import { callApi } from './api';
import { PRESENCE_TEXT, PresenceView, type PresenceData } from './PresenceView';

const POLL_MS = 5000;

export function PresenceSlice() {
  const [data, setData] = useState<PresenceData | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', '/presence').catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: PresenceData } | null | undefined;
    if (res && res.status === 200 && answer?.ok && answer.value) {
      setData(answer.value);
      setFailed(false);
    } else setFailed(true);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function add(body: { eventId?: string; from?: number; to?: number; reason: string }) {
    const res = await callApi('POST', '/presence/downtime', body).catch(() => null);
    const ok = !!res && res.status >= 200 && res.status < 300 && (res.body as { ok?: boolean } | null)?.ok === true;
    setMessage(ok ? PRESENCE_TEXT.saved : res?.status === 404 ? PRESENCE_TEXT.notFound : res?.status === 400 ? PRESENCE_TEXT.invalid : PRESENCE_TEXT.failed);
    if (ok) await load();
  }

  if (!data) return <p data-testid="presence-slice-state">{failed ? PRESENCE_TEXT.unavailable : PRESENCE_TEXT.loading}</p>;
  return <PresenceView data={data} message={message || (failed ? PRESENCE_TEXT.unavailable : '')} onAdd={(b) => void add(b)} />;
}
