'use client';
/** «Стан сайту» slice (SPEC-08 AC-17): polls the owner read path every 5 s (not while the tab is hidden) and sends switches and product choices. */
import { useCallback, useEffect, useState } from 'react';
import type { ProductKey } from '@time2fest/contracts';
import { callApi } from './api';
import { SITE_TEXT, reasonOf, reasonText } from './messages';
import { SiteStateView, type SiteStateViewProps } from './SiteStateView';

const POLL_MS = 5000;

type View = Pick<SiteStateViewProps, 'state' | 'paymentsPause' | 'products' | 'selections'>;

export function SiteStateSlice() {
  const [view, setView] = useState<View | null>(null);
  const [failed, setFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [room, setRoom] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const res = await callApi('GET', '/site/view').catch(() => null);
    const answer = res?.body as { ok?: boolean; value?: View } | null | undefined;
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

  async function send(path: string, body: Record<string, unknown>) {
    if (reason.trim() === '') return setMessage(SITE_TEXT.reasonRequired);
    const res = await callApi('POST', path, { ...body, reason: reason.trim() });
    const ok = res.status >= 200 && res.status < 300 && (res.body as { ok?: boolean } | null)?.ok !== false;
    setMessage(ok ? SITE_TEXT.saved : reasonText(reasonOf(res.body)));
    if (ok) {
      setReason('');
      await load();
    }
  }

  if (!view) return <p data-testid="site-slice-state">{failed ? SITE_TEXT.unavailable : SITE_TEXT.loading}</p>;
  return (
    <SiteStateView
      {...view}
      reason={reason}
      room={room}
      message={message || (failed ? SITE_TEXT.unavailable : '')}
      onReason={setReason}
      onRoom={setRoom}
      onSwitch={(key, value, extra) => void send('/site/switch', { key, value, ...extra })}
      onProduct={(key: ProductKey, productId: string) => void send('/site/product', { key, productId })}
    />
  );
}
