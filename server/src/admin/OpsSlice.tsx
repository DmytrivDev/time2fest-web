'use client';
/** «Моніторинг» slice (SPEC-13b AC-36): polls the owner overview every 5 s (not while the tab is hidden); acknowledges through the existing alarm endpoint. */
import { useCallback, useEffect, useState } from 'react';
import type { Overview } from '../ops/overviewSchema';
import { callApi } from './api';
import { OPS_TEXT } from './messages';
import { OpsView } from './OpsView';

const POLL_MS = 5000;

export function OpsSlice() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', '/ops/overview').catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: Overview } | null | undefined;
    if (res && res.status === 200 && answer?.ok && answer.value) {
      setOverview(answer.value);
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

  async function acknowledge(id: string) {
    const res = await callApi('POST', `/alarms/${encodeURIComponent(id)}/acknowledge`, {}).catch(() => null);
    setMessage(res && res.status >= 200 && res.status < 300 ? '' : OPS_TEXT.acknowledgeFailed);
    await load();
  }

  if (!overview) return <p data-testid="ops-slice-state">{failed ? OPS_TEXT.unavailable : OPS_TEXT.loading}</p>;
  return <OpsView overview={overview} message={message || (failed ? OPS_TEXT.unavailable : '')} onAcknowledge={(id) => void acknowledge(id)} />;
}
