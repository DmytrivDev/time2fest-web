/**
 * Передстартова збірка: входу й кабінету немає. Модуль стоїть на місці `@/lib/api/http/auth`, `@/lib/api/http/profile`
 * і `@/lib/api/http/passport`
 * (`resolveAlias` у `next.config.ts`), щоб адаптери входу й профілю (адреси `/api/auth/*`, `/api/me/*`) не потрапили в
 * пакет — `check:prelaunch` шукає їхні підписи. Звернення до домену падає так само, як до неперенесеного домену шва.
 */
import type { AuthService } from '@/lib/api/contracts/auth';
import type { PassportService } from '@/lib/api/contracts/passport';
import type { ProfileService } from '@/lib/api/contracts/profile';

const absent = (name: string): never => {
  throw new Error(`[api] домен «${name}» відсутній у передстартовій збірці`);
};

export function createHttpAuth(): AuthService {
  return absent('auth');
}

export function createHttpProfile(): ProfileService {
  return absent('profile');
}

export function createHttpPassport(): PassportService {
  return absent('passport');
}
