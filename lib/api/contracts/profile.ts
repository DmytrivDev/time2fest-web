/**
 * Контракт домену «Профіль» (`docs/backend/frontend-seam.md`): нік і прапор (видно в чаті іншим), налаштування кабінету
 * (`stores/account.ts`), «Мій графік» (сервер шле за ним сповіщення «трансляція почалась»).
 * Суто пристроєві речі — тема, згорнуті блоки, вікна кімнати, згода на cookies — лишаються в `localStorage` і сюди не йдуть.
 */
import type { ApiResult } from '../result';
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
  pendingEmail: string | null;
}

export type ProfilePatch = Partial<Pick<Profile, 'nick' | 'flagCode'>> & { settings?: Partial<ProfileSettings> };

/** Відмови: `validation` з `reason: NickReason`; `conflict` `schedule-full` (пояс заповнено); `unauthorized` для дій акаунта. */
export interface ProfileService {
  /** `GET /api/me/profile` (і для гостя — анонімна сесія). */
  get(): Promise<ApiResult<Profile>>;
  /** `PATCH /api/me/profile`. */
  update(patch: ProfilePatch): Promise<ApiResult<Profile>>;
  /** `PUT /api/me/schedule` — увесь список (простіше за дельти, список малий). */
  setSchedule(eventIds: readonly string[]): Promise<ApiResult<readonly string[]>>;
  /** Зміна пошти: лист на нову адресу. `POST /api/me/email`. */
  changeEmail(email: string): Promise<ApiResult<{ pendingEmail: string }>>;
  /** Видалення акаунта. `DELETE /api/me`. */
  deleteAccount(): Promise<ApiResult<void>>;
}

export type { NickReason };
