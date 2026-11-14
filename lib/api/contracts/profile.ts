/**
 * Контракт домену «Профіль» (`docs/backend/frontend-seam.md`, E3): нік і прапор (видно в чаті іншим), налаштування кабінету
 * (`stores/account.ts`), пошта й Google акаунта, «Мій графік» (сервер шле за ним сповіщення «трансляція почалась»).
 * Суто пристроєві речі — тема, згорнуті блоки, вікна кімнати, згода на cookies — лишаються в `localStorage` і сюди не йдуть.
 * Дії повертають збережений профіль; інтерфейс змінює свої поля одразу (оптимістично), як і раніше.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { NickReason } from './chat';

export interface ProfileSettings {
  hour12: boolean;
  homeCountry: string | null;
  homeZoneId: string | null;
  showPassport: boolean;
  showPath: boolean;
  passportHints: boolean;
  quietDefault: boolean;
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
  /** Нова пошта чекає підтвердження з листа. */
  pendingEmail: { email: string; sentAt: number } | null;
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
  /** Зміни профілю (інша вкладка, інший пристрій). У `http` — особистий канал `user:#<id>` (подія `profile`). */
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
  /** Зміна пошти: лист на нову адресу. `POST /api/me/email`; скасувати — `DELETE /api/me/email`. */
  changeEmail(email: string): Promise<ApiResult<Profile>>;
  cancelEmailChange(): Promise<ApiResult<Profile>>;
  /** Підключити / відключити Google до акаунта з поштою. `POST/DELETE /api/me/google` (у `http` — перехід на Google). */
  linkGoogle(): Promise<ApiResult<Profile>>;
  unlinkGoogle(): Promise<ApiResult<Profile>>;
  /** «Завантажити мої дані». `GET /api/me/export`. */
  exportData(): Promise<ApiResult<Record<string, unknown>>>;
  /** Видалення акаунта (разом з даними гостя на пристрої). `DELETE /api/me`. */
  deleteAccount(): Promise<ApiResult<void>>;
  /** Лише `sim` у тестовій збірці: «лист підтвердження відкрито» — пошту змінено. */
  devConfirmEmail?(): Promise<ApiResult<Profile>>;
}

export type { NickReason };
