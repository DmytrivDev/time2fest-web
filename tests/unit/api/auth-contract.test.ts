import { afterEach, beforeEach, vi } from 'vitest';
import { createSimAuth } from '@/lib/api/sim/auth';
import { GOOGLE_DELAY_MS } from '@/lib/auth/sim';
import { useAuthStore } from '@/stores/auth';
import { useTestControls } from '@/stores/testControls';
import { describeDomain, type AuthSuiteCtx } from '../../contract/auth.suite';

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null });
  useTestControls.setState({ authUnavailable: false, googleCancelled: false });
});
afterEach(() => vi.useRealTimers());

let n = 0;
let otherDevice: { svc: unknown; email: string } | null = null;
const ctx: AuthSuiteCtx = {
  freshEmail: (tag) => `sim-${tag}-${n++}@example.com`,
  lastCode: async () => useAuthStore.getState().code!.code,
  expireCode: async () => createSimAuth().devCode!.expire(),
  freeGap: async () => {
    useAuthStore.setState({ sends: [] });
  },
  breakDelivery: () => useTestControls.setState({ authUnavailable: true }),
  async grantDevicePass(_svc, email) {
    useAuthStore.getState().grantDevicePass(email, Date.now());
  },
  async grantAccountPass(_svc, email) {
    useAuthStore.getState().grantPass(email, Date.now());
  },
  async signInOtherDevice(_owner, other, email) {
    // One store = one device: apply what the server does when another device signs in with the payment email.
    otherDevice = { svc: other, email };
    useAuthStore.setState((s) => {
      const dp = s.devicePass;
      if (!dp || dp.email !== email) throw new Error('the device holds no pass paid with that email');
      const unclaimed = Object.fromEntries(Object.entries(s.unclaimed).filter(([, v]) => v.id !== dp.id));
      return { passes: { ...s.passes, [email]: dp.since }, attached: { ...s.attached, [dp.id]: email }, unclaimed, devicePass: null };
    });
  },
  useDevice(svc) {
    // The first device stays signed out; the other one is signed in as the payer's account.
    const signedIn = otherDevice !== null && otherDevice.svc === svc;
    useAuthStore.setState({ user: signedIn ? { email: otherDevice!.email, via: 'email', signedInAt: Date.now() } : null });
  },
  async google(svc, scenario) {
    vi.useFakeTimers();
    try {
      if (scenario === 'cancel') {
        const run = new AbortController();
        const pending = svc.google({ returnPath: '/', signal: run.signal });
        run.abort();
        const r = await pending;
        vi.advanceTimersByTime(GOOGLE_DELAY_MS);
        return { signedIn: false, cancelled: !r.ok && r.error.reason === 'cancelled' };
      }
      const pending = svc.google({ returnPath: '/' });
      vi.advanceTimersByTime(GOOGLE_DELAY_MS);
      const r = await pending;
      return { signedIn: r.ok && r.value.kind === 'signed-in', cancelled: false };
    } finally {
      vi.useRealTimers();
    }
  },
};

describeDomain('auth (sim)', () => createSimAuth(), ctx);
