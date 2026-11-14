/**
 * Адаптер `sim` домену «Профіль» (`docs/backend/frontend-seam.md`, E3): делегує сторам гостя (`nick`, прапор, графік) і
 * кабінету (`stores/account`). Поведінка — та сама, що була в компонентах (кабінет, крок «Як тебе показувати»).
 */
import { fail, ok } from '../result';
import type { Profile, ProfileService, ProfileSettings } from '../contracts/profile';
import { codeInfoOf, sendFailure, verifyFailure } from './auth';
import { GOOGLE_DELAY_MS, isEmail, normalizeEmail } from '@/lib/auth/sim';
import { DEFAULT_ACCOUNT, useAccountStore } from '@/stores/account';
import { accountHasPass, useAuthStore, type AuthCode } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

const SETTING_KEYS = Object.keys(DEFAULT_ACCOUNT).filter((k) => k !== 'googleLinked') as (keyof ProfileSettings)[];

/** Зміна пошти, що чекає коду: той самий об’єкт, поки код у «сервері» не змінився. */
let pendingCache: { code: AuthCode | null; out: Profile['pendingEmail'] } = { code: null, out: null };
function pendingEmailNow(): Profile['pendingEmail'] {
  const c = useAuthStore.getState().code;
  if (pendingCache.code !== c) {
    const info = c?.purpose === 'email-change' ? codeInfoOf(c) : null;
    pendingCache = { code: c, out: info ? { email: info.email, sentAt: info.sentAt, resendAt: info.resendAt, expiresAt: info.expiresAt, attemptsLeft: info.attemptsLeft } : null };
  }
  return pendingCache.out;
}

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
    pendingEmail: pendingEmailNow(),
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
      const offAuth = useAuthStore.subscribe(emit);
      return () => {
        offGuest();
        offAccount();
        offAuth();
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
    async changeEmail(raw) {
      if (useTestControls.getState().authUnavailable) return fail('unavailable');
      const email = normalizeEmail(raw);
      const auth = useAuthStore.getState();
      if (!auth.user) return fail('unauthorized');
      if (!isEmail(email)) return fail('validation', { reason: 'email' });
      if (email === auth.user.email) return fail('validation', { reason: 'same-email' });
      if (auth.accounts.includes(email)) return fail('conflict', { reason: 'taken' });
      const now = Date.now();
      const res = auth.requestCode(email, 'signin', 'email-change', now);
      if (!res.ok) return sendFailure(res, now);
      return ok(profileNow());
    },
    async confirmEmailChange(code) {
      if (useTestControls.getState().authUnavailable) return fail('unavailable');
      const pending = useAuthStore.getState().code;
      if (!pending || pending.purpose !== 'email-change') return fail('conflict', { reason: 'expired' });
      const res = useAuthStore.getState().checkCode(pending.email, code, 'email-change', Date.now());
      if (!res.ok) return verifyFailure(res);
      useAuthStore.getState().changeEmail(res.email);
      return ok(profileNow());
    },
    async cancelEmailChange() {
      if (useAuthStore.getState().code?.purpose === 'email-change') useAuthStore.setState({ code: null });
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
  };
}
