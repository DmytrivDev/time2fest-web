/**
 * Відкрите вікно «Замінити в графіку?»: подія, яку додаємо. Поки воно відкрите, на слотах цього поясу на сторінці графіка —
 * кнопки «Замінити» (як «Замінити це вікно» в кімнаті).
 */
import { create } from 'zustand';

export const SCHEDULE_REPLACE_ID = 'O-SCHEDULE-REPLACE';
export const SCHEDULE_ZONE_ID = 'O-SCHEDULE-ZONE';

export const useScheduleReplace = create<{ eventId: string | null }>(() => ({ eventId: null }));
