/**
 * Контракт домену «Вхід» (`docs/backend/frontend-seam.md`): асинхронна сесія замість синхронних дій `stores/auth.ts`
 * (`signInGoogle(now): SignInResult`). Сервер — Better Auth (magic link, Google, анонімний гість з об’єднанням при вході).
 * Пас — властивість акаунта на сервері; `guest.hasPass` на пристрої зникає (лишається лише кеш сесії).
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms } from '@/lib/data/types';

export type AuthIntent = 'signin' | 'signup';

export interface SessionUser {
  id: string;
  email: string;
  via: 'google' | 'email';
  signedInAt: Ms;
}

export interface Session {
  /** `null` — гість (анонімна сесія: штампи, графік, сповіщення прив’язані до неї й переносяться при вході). */
  user: SessionUser | null;
  /** Ідентифікатор анонімної сесії гостя (Better Auth `anonymous`). */
  guestId: string;
  /** Пас на акаунті (сервер — джерело правди). */
  hasPass: boolean;
  /** Пас у подарунок чекає входу з поштою з оплати тосту. */
  pendingPassGift: boolean;
}

export type EmailSignInOutcome =
  /** Нова адреса — акаунт створено й людина увійшла одразу (рішення 2026-10-30; див. питання в документі). */
  | { kind: 'signed-in'; isNew: true; email: string }
  /** Адреса з акаунтом — надіслано посилання для входу. */
  | { kind: 'link-sent'; email: string };

export interface SignInOutcome {
  isNew: boolean;
  email: string;
}

/**
 * Причини відмов (`ApiError.reason`): `rate_limited` — `wait` | `too-many` (`retryAfterMs`); `validation` — `email`;
 * `openLink`: `conflict` — `expired`, `not_found` — `none`; `unavailable` — сервіс входу не відповідає.
 */
export interface AuthService {
  /** Поточна сесія. `GET /api/auth/get-session`. */
  session(): Promise<ApiResult<Session>>;
  /** Зміна сесії (інша вкладка увійшла чи вийшла, пас видано вебхуком). Вкладки — `BroadcastChannel`; сервер — `user:#<id>`. */
  subscribe(onChange: (session: Session) => void): Unsubscribe;
  /** `POST /api/auth/sign-in/magic-link`. */
  emailSignIn(email: string, intent: AuthIntent): Promise<ApiResult<EmailSignInOutcome>>;
  /** Посилання з листа. `GET /api/auth/magic-link/verify?token=`. */
  openLink(token: string): Promise<ApiResult<SignInOutcome>>;
  /** Google: сервер дає адресу переходу; повернення — на `returnPath`. `POST /api/auth/sign-in/social`. */
  googleStart(returnPath: string): Promise<ApiResult<{ redirectUrl: string }>>;
  /** `POST /api/auth/sign-out`. */
  signOut(): Promise<ApiResult<void>>;
}
