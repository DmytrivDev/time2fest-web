/**
 * Перевірка ніка для O-NICK (US4, FR-051): 2–20 символів, без посилань; «зайнятий» і «заборонений» — стани вікна.
 * Правило живе в `packages/rules/src/text/nick.ts` (SPEC-09); це повторний експорт для споживачів сайту.
 */
export { validateNick, type NickIssue } from '@time2fest/rules/text';
