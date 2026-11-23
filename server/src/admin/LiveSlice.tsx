'use client';
/** «Ефір» slice (SPEC-12 AC-50): polls the owner read path every 5 s (not while the tab is hidden) and sends the live actions. */
import { useCallback, useEffect, useState } from 'react';
import { callApi } from './api';
import { LIVE_TEXT, reasonOf, reasonText } from './messages';
import { LiveView, type LiveAction, type LiveViewValue } from './LiveView';

const POLL_MS = 5000;

export function LiveSlice() {
  const [view, setView] = useState<LiveViewValue | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [videoId, setVideoId] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', '/live/view').catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: LiveViewValue } | null | undefined;
    if (res && res.status === 200 && answer?.ok && answer.value) {
      setView(answer.value);
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

  async function send(action: LiveAction) {
    if (reason.trim() === '') return setMessage(LIVE_TEXT.reasonRequired);
    if (action.action === 'replace' && action.videoId === '') return setMessage(LIVE_TEXT.videoIdRequired);
    const res = await callApi('POST', `/live/${action.action}`, { ...action, reason: reason.trim() });
    const ok = res.status >= 200 && res.status < 300 && (res.body as { ok?: boolean } | null)?.ok !== false;
    setMessage(ok ? LIVE_TEXT.saved : reasonText(reasonOf(res.body)));
    if (ok) {
      setReason('');
      await load();
    }
  }

  if (!view) return <p data-testid="live-slice-state">{failed ? LIVE_TEXT.unavailable : LIVE_TEXT.loading}</p>;
  return (
    <LiveView
      view={view}
      reason={reason}
      videoId={videoId}
      message={message || (failed ? LIVE_TEXT.unavailable : '')}
      onReason={setReason}
      onVideoId={setVideoId}
      onAction={(action) => void send(action)}
    />
  );
}
