import { afterEach, beforeEach, vi } from 'vitest';
import { createSimAuth } from '@/lib/api/sim/auth';
import { createSimProfile } from '@/lib/api/sim/profile';
import { CHAT_SCRIPT } from '@/lib/chat-sim/script';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { useAccountStore } from '@/stores/account';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { describeDomain, type ProfileSuiteCtx } from '../../contract/profile.suite';
import { fullZoneOfData } from '../../contract/zones';

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, unclaimed: {}, attached: {}, devicePass: null });
  useGuestStore.getState().resetGuest();
  useAccountStore.getState().reset();
  useTestControls.setState({ authUnavailable: false, googleCancelled: false });
});
afterEach(() => vi.useRealTimers());

let n = 0;
const ctx: ProfileSuiteCtx = {
  freshEmail: (tag) => `sim-${tag}-${n++}@example.com`,
  async signIn(_svc, email) {
    const auth = createSimAuth();
    const sent = await auth.requestCode(email, 'signup');
    if (!sent.ok) throw new Error(`requestCode → ${sent.error.code}`);
    const done = await auth.verifyCode(email, useAuthStore.getState().code!.code);
    if (!done.ok) throw new Error(`verifyCode → ${done.error.code}`);
    useAuthStore.setState({ sends: [] }); // the sim's resend gap is per client; the server keys email-change limits by the new address
  },
  lastCode: async () => useAuthStore.getState().code!.code,
  takenNick: async () => CHAT_SCRIPT.authors[0]!.nick,
  async givePass() {
    useAuthStore.getState().grantDevicePass(`sim-pass-${n++}@example.com`, Date.now());
  },
  fullZone: fullZoneOfData,
  // SPEC-10: a new address from Google with `email_verified:false` → Google is the account's only sign-in method.
  async googleOnlyAccount() {
    const email = `sim-go-${n++}@example.com`;
    useAuthStore.setState((s) => ({ user: { email, via: 'google', signedInAt: Date.now(), emailUnverified: true }, accounts: [...s.accounts, email] }));
    useAccountStore.getState().set('googleLinked', true);
  },
  async linkGoogle(svc) {
    vi.useFakeTimers();
    try {
      const pending = svc.linkGoogle();
      vi.advanceTimersByTime(GOOGLE_DELAY_MS);
      const r = await pending;
      return r.ok && r.value.googleLinked;
    } finally {
      vi.useRealTimers();
    }
  },
};

describeDomain('profile (sim)', () => createSimProfile(), ctx);
