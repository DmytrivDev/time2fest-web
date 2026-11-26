/**
 * Контракт домену «Профіль» (`docs/backend/frontend-seam.md`, E3): нік і прапор (видно в чаті іншим), налаштування кабінету
 * (`stores/account.ts`), пошта й Google акаунта, «Мій графік» (сервер шле за ним сповіщення «трансляція почалась»).
 * Суто пристроєві речі — тема, згорнуті блоки, вікна кімнати, згода на cookies — лишаються в `localStorage` і сюди не йдуть.
 * Дії повертають збережений профіль; інтерфейс змінює свої поля одразу (оптимістично), як і раніше.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { NickReason } from './chat';

/** Причина відмови прив’язки Google (`conflict`): цей Google уже зайнятий. */
export type LinkGoogleReason = 'google-taken';

/** SPEC-11: `conflict` графіка — пояс заповнено. */
export type ScheduleReason = 'schedule-full';
/** SPEC-11: відмови зміни пошти — `validation` `email` | `same-email`, `conflict` `taken`. */
export type ChangeEmailReason = 'email' | 'same-email' | 'taken';
/** SPEC-11: `conflict` відключення Google — це єдиний спосіб входу. */
export type UnlinkGoogleReason = 'last-method';

export interface ProfileSettings {
  hour12: boolean;
  homeCountry: string | null;
  homeZoneId: string | null;
  showPassport: boolean;
  showPath: boolean;
  passportHints: boolean;
  quietDefault: boolean;
  /** FR-PROF-11: листи-нагадування; типове значення вирішує хвиля профілю (OQ-3). */
  reminderEmails?: boolean;
}

export interface Profile {
  nick: string | null;
  /** Обраний прапор; `null` — сервер підставляє визначений за IP (`detectedFlag`). */
  flagCode: string | null;
  detectedFlag: string | null;
  settings: ProfileSettings;
  /** «Мій графік» — id подій (до 4 країн у поясі; правило перевіряє й сервер). */
  schedule: readonly string[];
  googleLinked: boolean;
  /** Нова пошта чекає коду з листа (6 цифр): коли надіслано, коли можна новий, до коли діє, скільки спроб лишилось. */
  pendingEmail: { email: string; sentAt: number; resendAt: number; expiresAt: number; attemptsLeft: number } | null;
}

export type ProfilePatch = {
  nick?: string;
  flagCode?: string;
  /** Прапор, визначений на пристрої (у `http` визначає сервер за `CF-IPCountry` і поле ігнорує). */
  detectedFlag?: string;
  settings?: Partial<ProfileSettings>;
};

/** Відмови: `validation` з `reason: NickReason`; `conflict` `schedule-full` (пояс заповнено); `unauthorized` для дій акаунта. */
export interface ProfileService {
  /** `GET /api/me/profile` (і для гостя — анонімна сесія). */
  get(): Promise<ApiResult<Profile>>;
  /** Останній відомий профіль без запиту (кеш на пристрої) — форми й шапка мають нік одразу після гідратації. */
  peek?(): Profile | undefined;
  /** Зміни профілю (інша вкладка, інший пристрій). У `http` — особистий канал `user:#<id>`, подія `profile` (клієнт перечитує профіль). */
  subscribe?(onChange: (profile: Profile) => void): Unsubscribe;
  /** `PATCH /api/me/profile`. */
  update(patch: ProfilePatch): Promise<ApiResult<Profile>>;
  /** `PUT /api/me/schedule` — увесь список (простіше за дельти, список малий). */
  setSchedule(eventIds: readonly string[]): Promise<ApiResult<readonly string[]>>;
  /**
   * Календарик: додати країну в поясі чи прибрати (подія тягне інші події тієї ж країни в поясі; повний пояс — без змін).
   * Правило — чисте (`lib/schedule/countryZone`), сервер застосовує те саме. `POST /api/me/schedule/toggle`.
   */
  toggleSchedule(eventId: string): Promise<ApiResult<readonly string[]>>;
  /** «Замінити в графіку?»: країна `outIso` поясу події поступається місцем. `POST /api/me/schedule/replace`. */
  replaceSchedule(outIso: string, eventId: string): Promise<ApiResult<readonly string[]>>;
  /**
   * Зміна пошти — тим самим кодом із 6 цифр, що й вхід (рішення власника 2026-11-13): код на нову адресу
   * (`POST /api/me/email`, Better Auth `emailOTP` `type: 'email-verification'`), повторний виклик — «Надіслати ще раз».
   * Відмови — як у входу (`contracts/auth`, `authCodeError`): `rate_limited` `wait` | `too-many`, `validation` `email` |
   * `same-email`, `conflict` `taken` (адреса вже в іншого акаунта).
   */
  changeEmail(email: string): Promise<ApiResult<Profile>>;
  /** Код з листа на нову адресу → пошту змінено. `POST /api/me/email/verify`. Відмови — `wrong-code`, `expired`, `too-many-attempts`. */
  confirmEmailChange(code: string): Promise<ApiResult<Profile>>;
  /** `DELETE /api/me/email`. */
  cancelEmailChange(): Promise<ApiResult<Profile>>;
  /** Підключити / відключити Google до акаунта з поштою. `POST/DELETE /api/me/google` (у `http` — перехід на Google). */
  linkGoogle(): Promise<ApiResult<Profile>>;
  unlinkGoogle(): Promise<ApiResult<Profile>>;
  /** «Завантажити мої дані». `GET /api/me/export`. */
  exportData(): Promise<ApiResult<Record<string, unknown>>>;
  /** Видалення акаунта (разом з даними гостя на пристрої). `DELETE /api/me`. */
  deleteAccount(): Promise<ApiResult<void>>;
}

export type { NickReason };
