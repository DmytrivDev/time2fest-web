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
const ctx: AuthSuiteCtx = {
  freshEmail: (tag) => `sim-${tag}-${n++}@example.com`,
  lastCode: async () => useAuthStore.getState().code!.code,
  expireCode: async () => createSimAuth().devCode!.expire(),
  freeGap: async () => useAuthStore.setState({ sends: [] }),
  breakDelivery: () => useTestControls.setState({ authUnavailable: true }),
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
