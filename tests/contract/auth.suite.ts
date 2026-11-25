import { describe, expect, it } from 'vitest';
import { authCodeError, type AuthService } from '@/lib/api/contracts/auth';

/** What a suite run needs from the world around the adapter (sim: stores; http: the server's test doors). */
export interface AuthSuiteCtx {
  /** An address no earlier test used. */
  freshEmail(tag: string): string;
  /** The code of the latest mail to `email` (sim: devCode; http: `/api/_test/auth/last-code`). */
  lastCode(email: string): Promise<string>;
  /** Makes the latest code of `email` expired (sim: devCode.expire; http: `/api/_test/auth/expire-code`). */
  expireCode(email: string): Promise<void>;
  /** Frees the resend gap of `email` so a second code can be asked at once; absent where nothing can. */
  freeGap?(email: string): Promise<void>;
  /** Makes delivery fail (sim switch); absent where a test cannot break the mail. */
  breakDelivery?(): void | Promise<void>;
  /** Runs one Google sign-in of `svc` to its end: «ok» signs in, «cancel» is a refusal at Google. */
  google(svc: AuthService, scenario: 'ok' | 'cancel'): Promise<{ signedIn: boolean; cancelled: boolean }>;
}

const wrongOf = (c: string) => (c === '000000' ? '111111' : '000000');

/**
 * One behaviour suite for the `auth` domain (SPEC-10 AC-54), run on the sim adapter and on the http adapter against
 * this worktree's server. `makeService` gives a fresh client (http: its own cookie jar).
 */
export function describeDomain(name: string, makeService: () => AuthService, ctx: AuthSuiteCtx): void {
  async function request(svc: AuthService, email: string, intent: 'signin' | 'signup' = 'signin') {
    const sent = await svc.requestCode(email, intent);
    if (!sent.ok) throw new Error(`requestCode → ${sent.error.code}/${sent.error.reason}`);
    return sent.value;
  }

  describe(name, () => {
    it('a new address: the code is held, sign-in only after the code, the account is new', async () => {
      const svc = makeService();
      const email = ctx.freshEmail('new');
      const info = await request(svc, email, 'signup');
      expect(info).toMatchObject({ email, intent: 'signup', attemptsLeft: 5 });
      expect(info.resendAt - info.sentAt).toBeGreaterThan(20_000);
      expect(info.expiresAt).toBeGreaterThan(info.sentAt);
      expect(svc.peek()?.code ?? (await svc.session().then((r) => (r.ok ? r.value.code : null)))).toMatchObject({ email });
      const before = await svc.session();
      expect(before.ok && before.value.user).toBeNull();
      const done = await svc.verifyCode(email, await ctx.lastCode(email));
      expect(done).toEqual({ ok: true, value: { isNew: true, email } });
      const after = await svc.session();
      if (!after.ok) throw new Error(`session() → ${after.error.code}`);
      expect(after.value.user).toMatchObject({ email, via: 'email' });
      expect(after.value.code).toBeNull();
      expect(svc.peek()?.user?.email).toBe(email);
    });

    it('an existing address: same flow, the account is not new', async (t) => {
      if (!ctx.freeGap) return t.skip();
      const svc = makeService();
      const email = ctx.freshEmail('again');
      await request(svc, email, 'signup');
      await svc.verifyCode(email, await ctx.lastCode(email));
      expect((await svc.signOut()).ok).toBe(true);
      await ctx.freeGap(email);
      await request(svc, email, 'signin');
      expect(await svc.verifyCode(email, await ctx.lastCode(email))).toEqual({ ok: true, value: { isNew: false, email } });
    });

    it('wrong code: attempts count down, the fifth miss burns the code (too-many-attempts)', async () => {
      const svc = makeService();
      const email = ctx.freshEmail('wrong');
      await request(svc, email);
      const wrong = wrongOf(await ctx.lastCode(email));
      const first = await svc.verifyCode(email, wrong);
      expect(first).toEqual({ ok: false, error: { code: 'validation', reason: 'wrong-code', attemptsLeft: 4 } });
      if (!first.ok) expect(authCodeError(first.error)).toBe('wrong-code');
      for (const left of [3, 2, 1]) {
        expect(await svc.verifyCode(email, wrong)).toEqual({ ok: false, error: { code: 'validation', reason: 'wrong-code', attemptsLeft: left } });
      }
      const burnt = await svc.verifyCode(email, wrong);
      expect(!burnt.ok && authCodeError(burnt.error)).toBe('too-many-attempts');
      expect(!burnt.ok && burnt.error.code).toBe('rate_limited');
    });

    it('an expired code is refused as expired', async () => {
      const svc = makeService();
      const email = ctx.freshEmail('expired');
      await request(svc, email);
      const code = await ctx.lastCode(email);
      await ctx.expireCode(email);
      const r = await svc.verifyCode(email, code);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatchObject({ code: 'conflict', reason: 'expired' });
        expect(authCodeError(r.error)).toBe('expired');
      }
    });

    it('a second code at once → rate_limited / wait with a countdown', async () => {
      const svc = makeService();
      const email = ctx.freshEmail('wait');
      await request(svc, email);
      const again = await svc.requestCode(email, 'signin');
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
        expect(again.error.retryAfterMs).toBeGreaterThan(0);
        expect(authCodeError(again.error)).toBe('cooldown');
      }
    });

    it('a malformed address is a validation error', async () => {
      const r = await makeService().requestCode('not-an-email', 'signin');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('validation');
    });

    it('delivery down → unavailable', async (t) => {
      if (!ctx.breakDelivery) return t.skip();
      await ctx.breakDelivery();
      const svc = makeService();
      const r = await svc.requestCode(ctx.freshEmail('down'), 'signin');
      expect(r).toEqual({ ok: false, error: { code: 'unavailable' } });
    });

    it('Google: sign-in signs the person in as «google»', async () => {
      const svc = makeService();
      const r = await ctx.google(svc, 'ok');
      expect(r).toEqual({ signedIn: true, cancelled: false });
      const s = await svc.session();
      expect(s.ok && s.value.user?.via).toBe('google');
    });

    it('Google: cancel at Google → no sign-in, reported as cancelled', async () => {
      const svc = makeService();
      const r = await ctx.google(svc, 'cancel');
      expect(r).toEqual({ signedIn: false, cancelled: true });
      const s = await svc.session();
      expect(s.ok && s.value.user).toBeNull();
    });

    it('signOut ends the session', async () => {
      const svc = makeService();
      const email = ctx.freshEmail('out');
      await request(svc, email);
      await svc.verifyCode(email, await ctx.lastCode(email));
      expect((await svc.signOut()).ok).toBe(true);
      const s = await svc.session();
      expect(s.ok && s.value.user).toBeNull();
    });

    it('subscribe() returns an unsubscribe that may be called twice', () => {
      const off = makeService().subscribe(() => {});
      expect(typeof off).toBe('function');
      off();
      off();
    });
  });
}
