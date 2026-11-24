'use client';
/**
 * «Джерела» slice (SPEC-21a AC-20): polls the owner read path every 5 s (not while the tab is hidden) and sends the
 * actions. The agent key section calls the owner-only `POST /cms-api/admins/:id/{issue,revoke}-key` after a confirm
 * step; an issued key lives only in this component's state until «Сховати» or the page goes (never logged, stored or
 * put in a URL).
 */
import type { StreamsActionBody, StreamsViewValue } from '@time2fest/contracts';
import { useCallback, useEffect, useState } from 'react';
import { callApi } from './api';
import { STREAMS_TEXT, streamsReasonText } from './messages';
import { StreamsView, type AgentKeyStep, type StreamsFilter } from './StreamsView';

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
  const [confirming, setConfirming] = useState<{ op: 'issue' | 'revoke'; adminId: string } | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ adminId: string; key: string } | null>(null);

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

  async function keyAction(op: 'issue' | 'revoke', adminId: string) {
    if (!/^\d{1,15}$/.test(adminId)) return;
    setIssuedKey(null);
    const res = await callApi('POST', `/admins/${adminId}/${op}-key`).catch(() => null);
    const key = (res?.body as { key?: unknown } | null | undefined)?.key;
    const ok = !!res && res.status === 200 && (op === 'revoke' || (typeof key === 'string' && key.length > 0));
    if (ok && op === 'issue') setIssuedKey({ adminId, key: key as string });
    setMessage(ok ? (op === 'issue' ? STREAMS_TEXT.agentKey.issued : STREAMS_TEXT.agentKey.revoked) : STREAMS_TEXT.agentKey.failed);
    await load();
  }

  function onKey(step: AgentKeyStep) {
    if (step.step === 'ask') return setConfirming({ op: step.op, adminId: step.adminId });
    if (step.step === 'hide') return setIssuedKey(null);
    const pending = confirming;
    setConfirming(null);
    if (step.step === 'confirm' && pending) void keyAction(pending.op, pending.adminId);
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
      confirming={confirming}
      issuedKey={issuedKey}
      onKey={onKey}
    />
  );
}
