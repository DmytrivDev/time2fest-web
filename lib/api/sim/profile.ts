/**
 * Адаптер `sim` домену «Профіль» (`docs/backend/frontend-seam.md`, E3): делегує сторам гостя (`nick`, прапор, графік) і
 * кабінету (`stores/account`). Поведінка — та сама, що була в компонентах (кабінет, крок «Як тебе показувати»).
 */
import { ok } from '../result';
import type { Profile, ProfileService, ProfileSettings } from '../contracts/profile';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { DEFAULT_ACCOUNT, useAccountStore } from '@/stores/account';
import { accountHasPass, useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';

const SETTING_KEYS = Object.keys(DEFAULT_ACCOUNT).filter((k) => k !== 'googleLinked' && k !== 'pendingEmail') as (keyof ProfileSettings)[];

function profileNow(): Profile {
  const g = useGuestStore.getState();
  const a = useAccountStore.getState();
  const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, a[k]])) as unknown as ProfileSettings;
  return {
    nick: g.nick ?? null,
    flagCode: g.flagCode ?? null,
    detectedFlag: g.detectedFlag ?? null,
    settings,
    schedule: g.schedule,
    googleLinked: a.googleLinked,
    pendingEmail: a.pendingEmail,
  };
}

/** Той самий об’єкт, поки поля профілю не змінились (стор гостя змінюється часто — чат, пропозиції — профіль ні). */
let cached: Profile | null = null;
function profileCached(): Profile {
  const next = profileNow();
  const same =
    cached &&
    cached.nick === next.nick &&
    cached.flagCode === next.flagCode &&
    cached.detectedFlag === next.detectedFlag &&
    cached.schedule === next.schedule &&
    cached.googleLinked === next.googleLinked &&
    cached.pendingEmail === next.pendingEmail &&
    SETTING_KEYS.every((k) => cached!.settings[k] === next.settings[k]);
  if (!same) cached = next;
  return cached!;
}

export function createSimProfile(): ProfileService {
  return {
    async get() {
      return ok(profileCached());
    },
    peek: () => profileCached(),
    subscribe(onChange) {
      let last = profileCached();
      const emit = () => {
        const p = profileCached();
        if (p !== last) {
          last = p;
          onChange(p);
        }
      };
      const offGuest = useGuestStore.subscribe(emit);
      const offAccount = useAccountStore.subscribe(emit);
      return () => {
        offGuest();
        offAccount();
      };
    },
    async update(patch) {
      const g = useGuestStore.getState();
      if (patch.detectedFlag) g.setDetectedFlag(patch.detectedFlag);
      if (patch.nick !== undefined) g.setNick(patch.nick, patch.flagCode);
      else if (patch.flagCode) g.setFlag(patch.flagCode);
      const acc = useAccountStore.getState();
      for (const [k, v] of Object.entries(patch.settings ?? {})) acc.set(k as keyof ProfileSettings, v as never);
      return ok(profileNow());
    },
    async setSchedule(eventIds) {
      useGuestStore.getState().setSchedule([...eventIds]);
      return ok(useGuestStore.getState().schedule);
    },
    async toggleSchedule(eventId) {
      useGuestStore.getState().toggleSchedule(eventId);
      return ok(useGuestStore.getState().schedule);
    },
    async replaceSchedule(outIso, eventId) {
      useGuestStore.getState().replaceSchedule(outIso, eventId);
      return ok(useGuestStore.getState().schedule);
    },
    async changeEmail(email) {
      useAccountStore.getState().set('pendingEmail', { email, sentAt: Date.now() });
      return ok(profileNow());
    },
    async cancelEmailChange() {
      useAccountStore.getState().set('pendingEmail', null);
      return ok(profileNow());
    },
    linkGoogle() {
      // Імітований перехід до Google (як раніше в кабінеті).
      return new Promise((resolve) =>
        setTimeout(() => {
          useAccountStore.getState().set('googleLinked', true);
          resolve(ok(profileNow()));
        }, GOOGLE_DELAY_MS),
      );
    },
    async unlinkGoogle() {
      useAccountStore.getState().set('googleLinked', false);
      return ok(profileNow());
    },
    async exportData() {
      const guest = useGuestStore.getState();
      const user = useAuthStore.getState().user;
      return ok({
        account: { email: user?.email ?? '', via: user?.via },
        nick: guest.nick,
        flag: guest.flagCode,
        stamps: guest.stamps,
        schedule: guest.schedule,
        hasPass: accountHasPass(useAuthStore.getState()),
        settings: Object.fromEntries(Object.entries(useAccountStore.getState()).filter(([, v]) => typeof v !== 'function')),
      });
    },
    async deleteAccount() {
      const email = useAuthStore.getState().user?.email ?? '';
      useAuthStore.setState((a) => ({
        user: null,
        accounts: a.accounts.filter((x) => x !== email),
        passes: Object.fromEntries(Object.entries(a.passes).filter(([k]) => k !== email)),
      }));
      useGuestStore.getState().resetGuest();
      useAccountStore.getState().reset();
      return ok(undefined);
    },
    async devConfirmEmail() {
      const pending = useAccountStore.getState().pendingEmail;
      if (pending) {
        const email = useAuthStore.getState().user?.email ?? '';
        useAuthStore.setState((a) => ({
          user: a.user ? { ...a.user, email: pending.email } : a.user,
          accounts: a.accounts.map((x) => (x === email ? pending.email : x)),
        }));
        useAccountStore.getState().set('pendingEmail', null);
      }
      return ok(profileNow());
    },
  };
}
