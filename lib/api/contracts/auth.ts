/**
 * Контракт домену «Вхід» (`docs/backend/frontend-seam.md`, 3.6): асинхронна сесія.
 * Сервер — Better Auth (плагін `emailOTP` — код із 6 цифр, Google, анонімний гість з об’єднанням при вході). Пас —
 * властивість акаунта на сервері: `Session.hasPass` — єдине, звідки інтерфейс знає «пас є».
 *
 * Пошта — лише кодом (рішення власника 2026-11-13): `requestCode` надсилає лист із 6 цифрами, `verifyCode` впускає.
 * Однаково для нової адреси й наявної; входу без підтвердження пошти немає (і після оплати пасу гостем — теж: пас працює
 * на пристрої, в акаунт він потрапляє після входу з поштою з оплати).
 */
import type { ApiError, ApiResult, Unsubscribe } from '../result';
import type { Ms } from '@/lib/data/types';

export type AuthIntent = 'signin' | 'signup';

export interface SessionUser {
  id: string;
  email: string;
  via: 'google' | 'email';
  signedInAt: Ms;
  /** Ім’я з профілю Google (у крок «Як тебе показувати» йде перше слово); пошта — немає. */
  name?: string;
}

/** Останній код, який цей пристрій попросив (крок «Введи код», відлік «Надіслати ще раз»). */
export interface CodeInfo {
  email: string;
  intent: AuthIntent;
  sentAt: Ms;
  /** Раніше не можна просити новий («Надіслати ще раз через 0:25»). */
  resendAt: Ms;
  expiresAt: Ms;
  /** Скільки спроб лишилось (5 на код). */
  attemptsLeft: number;
}

export interface Session {
  /** `null` — гість (анонімна сесія: штампи, графік, сповіщення прив’язані до неї й переносяться при вході). */
  user: SessionUser | null;
  /** Ідентифікатор гостя (Better Auth `anonymous`; у `sim` — `guest.id`). */
  guestId: string;
  /** Пас: на акаунті, що увійшов, або оплачений на цьому пристрої без входу (`devicePass`). */
  hasPass: boolean;
  /** Коли пас оформлено (для «Пас активний з …»). */
  passSince: Ms | null;
  /**
   * Пас, оплачений гостем без входу (рішення власника 2026-11-13): працює на цьому пристрої (у `http` — на анонімній
   * сесії); в акаунт потрапляє після входу з поштою `email` (код чи Google). `null` — немає або вже в акаунті.
   */
  devicePass: { email: string; since: Ms } | null;
  /** Пас у подарунок до тосту $10 чекає першого входу на цьому пристрої. */
  pendingPassGift: boolean;
  /** Код, що його чекає цей пристрій (у `http` адаптер тримає його локально з відповіді `requestCode`). */
  code: CodeInfo | null;
}

/** Результат входу. */
export interface SignInOutcome {
  isNew: boolean;
  email: string;
}

export type GoogleOutcome = ({ kind: 'signed-in' } & SignInOutcome) | { kind: 'redirect'; url: string };

/** Тестова пошта (лише `sim` у тестовій і демо-збірці): код із «листа». */
export interface DevCode {
  email: string;
  code: string;
  purpose: 'signin' | 'email-change';
  sentAt: Ms;
  expiresAt: Ms;
  used: boolean;
}

export interface DevCodeBox {
  get(): DevCode | null;
  subscribe(cb: () => void): Unsubscribe;
  /** Зробити останній код простроченим. */
  expire(): void;
}

/**
 * Причини відмов коду (`ApiError.reason`), однакові для входу й зміни пошти:
 * - `validation` / `wrong-code` — код не підходить, `attemptsLeft` — скільки ще можна;
 * - `conflict` / `expired` — код прострочено (10 хв), використано чи його немає — потрібен новий;
 * - `rate_limited` / `too-many-attempts` — 5 невдалих спроб, код згорів — потрібен новий;
 * - `rate_limited` / `wait` | `too-many` — новий код ще не можна (`retryAfterMs`: відлік 30 с або ліміт 5 кодів за 10 хв);
 * - `validation` / `email` — пошта з помилкою; `unavailable` — сервіс входу не відповідає; `network` — немає зв’язку.
 * Google: `conflict` / `cancelled`.
 */
export type AuthCodeError = 'wrong-code' | 'expired' | 'too-many-attempts' | 'cooldown' | 'rate-limited' | 'network' | 'unavailable' | 'unknown';

/** Відмова сервісу → що показати людині (одна функція для входу, вікна пасу й кабінету). */
export function authCodeError(e: ApiError): AuthCodeError {
  if (e.code === 'network') return 'network';
  if (e.code === 'unavailable') return 'unavailable';
  if (e.reason === 'wrong-code') return 'wrong-code';
  if (e.reason === 'expired') return 'expired';
  if (e.reason === 'too-many-attempts') return 'too-many-attempts';
  if (e.code === 'rate_limited') return e.reason === 'wait' ? 'cooldown' : 'rate-limited';
  return 'unknown';
}

export interface AuthService {
  /** Поточна сесія. `GET /api/auth/get-session`. */
  session(): Promise<ApiResult<Session>>;
  /** Остання відома сесія без запиту (кеш на пристрої) — перший кадр після гідратації без «гостя на мить». */
  peek(): Session | undefined;
  /** Зміна сесії: інша вкладка увійшла чи вийшла, пас видано вебхуком. Вкладки — `storage`/`BroadcastChannel`; сервер — `user:#<id>`. */
  subscribe(onChange: (session: Session) => void): Unsubscribe;
  /** Надіслати код на пошту. `POST /api/auth/email-otp/send-verification-otp` (`type: 'sign-in'`). */
  requestCode(email: string, intent: AuthIntent): Promise<ApiResult<CodeInfo>>;
  /** Перевірити код і увійти (нова адреса — акаунт створено, `isNew`). `POST /api/auth/sign-in/email-otp`. */
  verifyCode(email: string, code: string): Promise<ApiResult<SignInOutcome>>;
  /**
   * Google. `POST /api/auth/sign-in/social` → `redirect` (сторінка переходить на Google і повертається на `returnPath`
   * з `?signin=google`; відмова — `&error=cancelled`). `sim` — вхід після імітованої затримки.
   */
  google(opts: { returnPath: string; signal?: AbortSignal }): Promise<ApiResult<GoogleOutcome>>;
  /** `POST /api/auth/sign-out`. */
  signOut(): Promise<ApiResult<void>>;
  /** Лише `sim` у тестовій і демо-збірці: код із «листа». */
  devCode?: DevCodeBox;
  /** Лише `sim`: «Скинути стан гостя» — стерти імітовані акаунти, паси, код. */
  devReset?(): void;
}
