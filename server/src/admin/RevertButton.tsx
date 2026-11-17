'use client';
/** "Скасувати зміну" of one journal row (AC-24): rendered only for a revertible row. */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from './api';
import { reasonOf, reasonText } from './messages';

export function RevertButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function revert() {
    setBusy(true);
    setError('');
    const res = await callApi('POST', `/audit-log/${id}/revert`);
    setBusy(false);
    if ((res.body as { ok?: unknown } | null)?.ok === true) router.refresh();
    else setError(reasonText(reasonOf(res.body)));
  }

  return (
    <span>
      <button type="button" onClick={revert} disabled={busy} data-testid="revert-button">
        Скасувати зміну
      </button>
      {error ? (
        <span role="alert" data-testid="revert-error">
          {` ${error}`}
        </span>
      ) : null}
    </span>
  );
}
