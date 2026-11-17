'use client';
/** Test slice of the first screen (AC-28, AC-29): exists only in the `test` class. */
import { useEffect, useState } from 'react';
import { callApi } from './api';

export function TestSlice({ fail }: { fail: boolean }) {
  const [count, setCount] = useState(0);
  const [failed, setFailed] = useState(false);
  const [info, setInfo] = useState('');
  const [postId, setPostId] = useState<string | null>(null);

  // Thrown after mount so the client error boundary catches it (not during server rendering).
  useEffect(() => {
    if (fail) setFailed(true);
  }, [fail]);
  if (failed) throw new Error('admin test slice: forced failure');

  // First click creates the test post, later clicks update its title: an update is journalled as revertible (AC-29).
  async function act() {
    const next = count + 1;
    const title = `slice-${next}`;
    const res =
      postId === null
        ? await callApi('POST', '/agent-test-posts', { title, status: 'draft' })
        : await callApi('PATCH', `/agent-test-posts/${postId}`, { title });
    const id = (res.body as { doc?: { id?: unknown } } | null)?.doc?.id;
    if ((res.status === 201 || res.status === 200) && id !== undefined) {
      setCount(next);
      setPostId(String(id));
      setInfo(`Збережено запис ${String(id)}: ${title}`);
    } else {
      setInfo('Не вдалося зберегти');
    }
  }

  return (
    <div data-testid="test-slice">
      <p data-testid="test-slice-count">{`Лічильник: ${count}`}</p>
      <button type="button" onClick={act} data-testid="test-slice-action">
        Додати тестовий запис
      </button>
      <p data-testid="test-slice-info">{info}</p>
    </div>
  );
}
