/**
 * Момент півночі на поверхні ефіру (T081, `contracts/ui-events.md`):
 * - `moment:stamp` (+15 с) — штамп в окремому блоці під рядком дій (`StampBlock`, не вікно — вікна збоку його не
 *   прибирають), з «ударом» печатки (запізнілий — без удару).
 * Оголошення для читача екрана «З Новим роком, Франція! Штамп у паспорті» робить свято в шапці (`useStampCelebration`,
 * дошки `Desk-Stamp-Header` / `Phone-Stamp-Header`, 2026-11-12) — один раз, коли свято справді грає (після повного
 * екрана чи повернення на вкладку — словами наздоганяння).
 * «Як тобі шоу?» — рядок у самому штампі з тієї ж миті (рішення власника 2026-11-01); окремої картки оцінки немає:
 * прибрали штамп «×» — прибрали й оцінку (оцінити можна в паспорті).
 * Нічого не лежить поверх плеєра.
 */
import { useEffect } from 'react';
import { on } from '@/lib/events/bus';
import { showStampMoment } from '@/components/stamp/StampBlock';

export function useMomentWindows(): void {
  // +15 с: штамп під плеєром.
  useEffect(
    () =>
      on('moment:stamp', (p) => {
        if (!p.presentEventIds.length) return;
        showStampMoment(p.presentEventIds, !p.late);
      }),
    [],
  );
}
