/**
 * Контракт домену «Вхід» (`docs/backend/frontend-seam.md`, E3): асинхронна сесія замість синхронних дій `stores/auth.ts`.
 * Сервер — Better Auth (magic link, Google, анонімний гість з об’єднанням при вході). Пас — властивість акаунта на
 * сервері: `Session.hasPass` — єдине, звідки інтерфейс знає «пас є».
 *
 * Правило «нова пошта входить одразу, без листа» (рішення 2026-10-30) НЕ закладене в контракт: `emailSignIn` відповідає
 * або `signed-in`, або `link-sent`, і інтерфейс уміє обидва (кроки «Акаунт створено» і «Лист надіслано / Надіслати ще /
 * Посилання прострочене / Інший пристрій»). Тож бекенд може вимагати посилання для КОЖНОЇ пошти без зміни інтерфейсу —
 * рішення за власником (документ, розділ 8). У `sim` правило живе в одному місці: `lib/api/sim/auth.ts`.
 */
import type { ApiResult, Unsubscribe } from '../result';
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

/** Останній лист з посиланням, який цей пристрій попросив (для «Лист надіслано», відліку «Надіслати ще»). */
export interface LinkInfo {
  email: string;
  intent: AuthIntent;
  sentAt: Ms;
  /** Раніше не можна просити новий («Надіслати ще через N с»). */
  resendAt: Ms;
  expiresAt: Ms;
  used: boolean;
  /** Лист «ти увійшов» після створення акаунта (посилання — для інших пристроїв), а не лист для входу. */
  welcome: boolean;
}

export interface Session {
  /** `null` — гість (анонімна сесія: штампи, графік, сповіщення прив’язані до неї й переносяться при вході). */
  user: SessionUser | null;
  /** Ідентифікатор гостя (Better Auth `anonymous`; у `sim` — `guest.id`). */
  guestId: string;
  /** Пас на акаунті, що увійшов (сервер — джерело правди). Гість без входу паса не має (правка власника 2026-11-10). */
  hasPass: boolean;
  /** Коли пас оформлено (для «Пас активний з …»). */
  passSince: Ms | null;
  /** Пас у подарунок до тосту $10 чекає першого входу на цьому пристрої. */
  pendingPassGift: boolean;
  /** Лист, що його чекає цей пристрій (в `http` адаптер тримає його локально з відповіді `emailSignIn`/`sendLink`). */
  link: LinkInfo | null;
}

/** Результат входу без листа. */
export interface SignInOutcome {
  isNew: boolean;
  email: string;
}

export type EmailSignInOutcome = ({ kind: 'signed-in' } & SignInOutcome) | { kind: 'link-sent'; link: LinkInfo };

export type GoogleOutcome = ({ kind: 'signed-in' } & SignInOutcome) | { kind: 'redirect'; url: string };

/** Посилання з листа: прострочене чи використане — не помилка, а стан, який інтерфейс показує. */
export type LinkOutcome = ({ kind: 'signed-in' } & SignInOutcome) | { kind: 'expired'; email?: string } | { kind: 'invalid' };

/** Тестова пошта (лише `sim` у тестовій збірці): посилання з «листа» просто на сторінці. */
export interface DevLetter {
  email: string;
  token: string;
  sentAt: Ms;
  expiresAt: Ms;
  used: boolean;
}

export interface DevMailbox {
  get(): DevLetter | null;
  subscribe(cb: () => void): Unsubscribe;
  /** Зробити останній лист простроченим. */
  expire(): void;
}

/**
 * Причини відмов (`ApiError.reason`): `rate_limited` — `wait` | `too-many` (`retryAfterMs`); `validation` — `email`;
 * `google`: `conflict` — `cancelled`; `unavailable` — сервіс входу не відповідає; `network`.
 */
export interface AuthService {
  /** Поточна сесія. `GET /api/auth/get-session`. */
  session(): Promise<ApiResult<Session>>;
  /** Остання відома сесія без запиту (кеш на пристрої) — перший кадр після гідратації без «гостя на мить». */
  peek(): Session | undefined;
  /** Зміна сесії: інша вкладка увійшла чи вийшла, пас видано вебхуком. Вкладки — `storage`/`BroadcastChannel`; сервер — `user:#<id>`. */
  subscribe(onChange: (session: Session) => void): Unsubscribe;
  /** Вхід поштою. `POST /api/auth/sign-in/magic-link`. Сервер вирішує: одразу (`signed-in`) чи лист (`link-sent`). */
  emailSignIn(email: string, intent: AuthIntent): Promise<ApiResult<EmailSignInOutcome>>;
  /** Лише лист для входу (напр. «На цю адресу пас уже оформлено — увійти»). Той самий маршрут, `force: 'link'`. */
  sendLink(email: string, intent: AuthIntent): Promise<ApiResult<LinkInfo>>;
  /** Посилання з листа. `GET /api/auth/magic-link/verify?token=`. */
  openLink(token: string): Promise<ApiResult<LinkOutcome>>;
  /**
   * Google. `POST /api/auth/sign-in/social` → `redirect` (сторінка переходить на Google і повертається на `returnPath`).
   * `sim` — вхід після імітованої затримки. `signal` — людина скасувала, поки чекали.
   */
  google(opts: { returnPath: string; signal?: AbortSignal }): Promise<ApiResult<GoogleOutcome>>;
  /** `POST /api/auth/sign-out`. */
  signOut(): Promise<ApiResult<void>>;
  /** Лише `sim` у тестовій збірці. */
  devMailbox?: DevMailbox;
}
