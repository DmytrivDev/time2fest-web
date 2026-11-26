'use client';
/** «Бани» slice (SPEC-11 W38, AC-22): polls the owner list every 5 s (not while the tab is hidden); bans and unbans through `/cms-api/bans/*`. */
import { useCallback, useEffect, useState } from 'react';
import { callApi } from './api';
import { BANS_TEXT, BansView, type BanRow } from './BansView';

const POLL_MS = 5000;

export function BansSlice() {
  const [bans, setBans] = useState<BanRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', '/bans').catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: { bans: BanRow[] } } | null | undefined;
    if (res && res.status === 200 && answer?.ok && answer.value) {
      setBans(answer.value.bans);
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

  async function send(path: string, body: unknown) {
    const res = await callApi('POST', path, body).catch(() => null);
    const ok = !!res && res.status >= 200 && res.status < 300 && (res.body as { ok?: boolean } | null)?.ok === true;
    setMessage(ok ? BANS_TEXT.saved : res?.status === 404 ? BANS_TEXT.notFound : BANS_TEXT.failed);
    if (ok) await load();
  }

  if (!bans) return <p data-testid="bans-slice-state">{failed ? BANS_TEXT.unavailable : BANS_TEXT.loading}</p>;
  return (
    <BansView
      bans={bans}
      message={message || (failed ? BANS_TEXT.unavailable : '')}
      onBan={(kind, subjectId) => void send('/bans/ban', { kind, subjectId })}
      onUnban={(banId) => void send('/bans/unban', { banId })}
    />
  );
}
