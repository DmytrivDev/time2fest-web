/** Запис на сервер зі станом «Зберігаємо…» / «Збережено» / «Не вдалося зберегти» — спільний для розділів кабінету. */

import { useState } from 'react';
import type { ApiResult } from '@/lib/api/result';

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

/** Запис на сервер з «Зберігаємо…» / «Збережено» / «Не вдалося зберегти» (у `sim` — `window.__t2f.api`). */
export function useSave() {
  const [state, setState] = useState<SaveState>('idle');
  const run = async <T,>(p: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
    setState('saving');
    const res = await p;
    setState(res.ok ? 'saved' : 'failed');
    return res;
  };
  return { state, run, reset: () => setState('idle') };
}
