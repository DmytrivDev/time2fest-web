'use client';

/**
 * Запобіжник шва в кореневому макеті (`docs/backend/frontend-seam.md`, «Запобіжник робочої збірки»): у режимі `http`, поки
 * для перенесених доменів немає адаптерів (бекенду ще немає), сайт НЕ вдає роботу й не імітує — показує наявний стан
 * «сервер недоступний» (`BackendDown`) і пише зрозумілу помилку в консоль. У `sim` (тестова й демо-збірка) — прозорий.
 */
import { useEffect, type ReactNode } from 'react';
import { BackendDown } from '@/components/shell/Offline';
import { IS_TEST_BUILD } from '@/lib/env';
import { API_MODE, type ApiMode } from './mode';
import { missingDomains } from './services';

/** Інтеграційна збірка (test + http): домени без адаптера `http` бере імітація — сайт працює (`lib/api/domains.ts`). */
export function ApiGuard({ children, mode = API_MODE, testBuild = IS_TEST_BUILD }: { children: ReactNode; mode?: ApiMode; testBuild?: boolean }) {
  const missing = mode === 'http' ? missingDomains('http', testBuild).join(', ') : '';
  const down = missing !== '';
  useEffect(() => {
    if (down) console.error(`[api] Режим http: немає адаптерів для ${missing} — сервіс недоступний, сайт не запускається.`);
  }, [down, missing]);
  if (!down) return <>{children}</>;
  return (
    <main id="main" tabIndex={-1} data-api-unavailable="" className="focus:outline-none">
      <BackendDown />
    </main>
  );
}
