/**
 * Єдиний вхід реєстру в адаптери `sim` (`docs/backend/frontend-seam.md`, «Запобіжник робочої збірки»). У збірці з
 * `NEXT_PUBLIC_API_MODE=http` `next.config.ts` підміняє цей модуль на `lib/api/http/simEntry.disabled.ts` — імітація не
 * потрапляє в пакет. Компонентам імпортувати заборонено (eslint).
 */
export { simFactories } from './sim';
