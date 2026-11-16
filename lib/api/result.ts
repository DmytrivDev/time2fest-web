/**
 * Шов «інтерфейс ↔ бекенд» (`docs/backend/frontend-seam.md`): спільний результат і помилки всіх сервісів.
 * Сервіс не кидає винятків на очікувані відмови (мережа, ліміт, «вже оплачено») — повертає `ApiResult`. Виняток —
 * лише баг. Так хук і компонент бачать усі гілки в типах і не забувають про стан помилки.
 * Джерело тепер у `@time2fest/contracts` (packages/contracts/src/result.ts); тут лише реекспорт.
 */

export type { ApiErrorCode, ApiError, ApiResult, Unsubscribe } from '@time2fest/contracts';
export { ok, fail } from '@time2fest/contracts';
