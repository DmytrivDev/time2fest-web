import { describe, expect, it } from 'vitest';
import type { ProfileService } from '@/lib/api/contracts/profile';

/** Five events of five distinct countries in one zone (`isos[i]` is the country of `eventIds[i]`). */
export interface FullZone {
  eventIds: string[];
  isos: string[];
}

/** What a profile suite run needs from the world around the adapter (sim: stores; http: the server's test doors). */
export interface ProfileSuiteCtx {
  /** An address no earlier test used. */
  freshEmail(tag: string): string;
  /** `svc` signs in as a new account with `email` (http: the code sign-in on the jar `svc` shares). */
  signIn(svc: ProfileService, email: string): Promise<void>;
  /** The code of the latest mail to `email`. */
  lastCode(email: string): Promise<string>;
  /** A nick another subject already holds. */
  takenNick(): Promise<string>;
  /** `svc`'s subject gets the Year pass (sim: a device pass in the store; http: door `rights/pass-grant`). */
  givePass(svc: ProfileService): Promise<void>;
  /** Five events of five distinct countries in one zone. */
  fullZone(): FullZone;
  /** Runs `linkGoogle()` and says whether the page was sent to Google (sim: the demo link; http: `navigate` got a URL). */
  linkGoogle(svc: ProfileService): Promise<boolean>;
  /** An account whose only sign-in method is Google, if the world can make one (the real server needs an unverified address). */
  googleOnlyAccount?(svc: ProfileService): Promise<void>;
}

type Res<T> = { ok: true; value: T } | { ok: false; error: { code: string; reason?: string } };

async function unwrap<T>(p: Promise<Res<T>>): Promise<T> {
  const r = await p;
  if (!r.ok) throw new Error(`${r.error.code}/${r.error.reason ?? ''}`);
  return r.value;
}

/** One behaviour suite for the `profile` domain (SPEC-11 AC-60, AC-61), run on sim and http. */
export function describeDomain(name: string, makeService: () => ProfileService, ctx: ProfileSuiteCtx): void {
  describe(name, () => {
    it('defaults: no nick, default settings, empty schedule, no Google, no pending change', async () => {
      const p = await unwrap(makeService().get());
      expect(p.nick).toBeNull();
      expect(p.schedule).toEqual([]);
      expect(p.googleLinked).toBe(false);
      expect(p.pendingEmail).toBeNull();
      expect(p.settings).toMatchObject({ hour12: expect.any(Boolean), homeCountry: null, homeZoneId: null, showPassport: expect.any(Boolean) });
    });

    it('nick: a good one is kept; too short → short; one another subject holds → taken; a service word → forbidden', async () => {
      const svc = makeService();
      const nick = `Zorya${Math.floor(Math.random() * 1e6)}`;
      expect((await unwrap(svc.update({ nick }))).nick).toBe(nick);
      expect((await unwrap(svc.get())).nick).toBe(nick);
      expect(await svc.update({ nick: 'a' })).toMatchObject({ ok: false, error: { code: 'validation', reason: 'short' } });
      expect(await svc.update({ nick: await ctx.takenNick() })).toMatchObject({ ok: false, error: { reason: 'taken' } });
      expect(await svc.update({ nick: 'admin' })).toMatchObject({ ok: false, error: { code: 'validation', reason: 'forbidden' } });
    });

    it('flag: a country code is kept; junk → validation / invalid-input', async () => {
      const svc = makeService();
      expect((await unwrap(svc.update({ flagCode: 'PL' }))).flagCode).toBe('PL');
      expect(await svc.update({ flagCode: 'zz9' })).toMatchObject({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
      expect((await unwrap(svc.get())).flagCode).toBe('PL');
    });

    it('settings: a patch round-trips and leaves the other keys alone', async () => {
      const svc = makeService();
      const before = await unwrap(svc.get());
      const after = await unwrap(svc.update({ settings: { hour12: !before.settings.hour12 } }));
      expect(after.settings.hour12).toBe(!before.settings.hour12);
      expect(after.settings.showPassport).toBe(before.settings.showPassport);
      expect((await unwrap(svc.get())).settings.hour12).toBe(!before.settings.hour12);
    });

    it('settings: an unknown key → validation / invalid-input', async () => {
      const r = await makeService().update({ settings: { nope: true } as never });
      expect(r).toMatchObject({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
    });

    describe('schedule', () => {
      it('without a pass → forbidden', async () => {
        const svc = makeService();
        const [a] = ctx.fullZone().eventIds;
        expect(await svc.toggleSchedule(a!)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await svc.setSchedule([a!])).toMatchObject({ ok: false, error: { code: 'forbidden' } });
      });

      it('toggle adds a country; a second toggle removes it', async () => {
        const svc = makeService();
        await ctx.givePass(svc);
        const [a] = ctx.fullZone().eventIds;
        const added = await unwrap(svc.toggleSchedule(a!));
        expect(added).toContain(a);
        expect((await unwrap(svc.get())).schedule).toEqual(added);
        expect(await unwrap(svc.toggleSchedule(a!))).toEqual([]);
      });

      it('an unknown id → validation / invalid-input', async () => {
        const svc = makeService();
        await ctx.givePass(svc);
        expect(await svc.toggleSchedule('no-such-event')).toMatchObject({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
      });

      it('the fifth country of a zone → conflict / schedule-full; replace swaps one country for it', async () => {
        const svc = makeService();
        await ctx.givePass(svc);
        const { eventIds, isos } = ctx.fullZone();
        for (const id of eventIds.slice(0, 4)) await unwrap(svc.toggleSchedule(id));
        expect(await svc.toggleSchedule(eventIds[4]!)).toMatchObject({ ok: false, error: { code: 'conflict', reason: 'schedule-full' } });
        const swapped = await unwrap(svc.replaceSchedule(isos[0]!, eventIds[4]!));
        expect(swapped).toContain(eventIds[4]);
        expect(swapped).not.toContain(eventIds[0]);
        expect((await unwrap(svc.get())).schedule).toEqual(swapped);
      });

      it('setSchedule keeps the list as given', async () => {
        const svc = makeService();
        await ctx.givePass(svc);
        const [a, b] = ctx.fullZone().eventIds;
        const set = await unwrap(svc.setSchedule([a!, b!]));
        expect(set).toEqual(expect.arrayContaining([a, b]));
        expect((await unwrap(svc.get())).schedule).toEqual(set);
      });
    });

    describe('email change', () => {
      it('request → pending; a wrong code counts down; cancel clears it', async () => {
        const svc = makeService();
        await ctx.signIn(svc, ctx.freshEmail('chg'));
        const next = ctx.freshEmail('new');
        const asked = await unwrap(svc.changeEmail(next));
        expect(asked.pendingEmail).toMatchObject({ email: next, attemptsLeft: 5 });
        const code = await ctx.lastCode(next);
        const wrong = await svc.confirmEmailChange(code === '000000' ? '111111' : '000000');
        expect(wrong).toMatchObject({ ok: false, error: { code: 'validation', reason: 'wrong-code', attemptsLeft: 4 } });
        expect((await unwrap(svc.cancelEmailChange())).pendingEmail).toBeNull();
      });

      it('the right code ends the pending change', async () => {
        const svc = makeService();
        await ctx.signIn(svc, ctx.freshEmail('chg2'));
        const next = ctx.freshEmail('new2');
        await unwrap(svc.changeEmail(next));
        expect((await unwrap(svc.confirmEmailChange(await ctx.lastCode(next)))).pendingEmail).toBeNull();
      });

      it('a malformed address → validation / email', async () => {
        const svc = makeService();
        await ctx.signIn(svc, ctx.freshEmail('chg3'));
        expect(await svc.changeEmail('nope')).toMatchObject({ ok: false, error: { code: 'validation', reason: 'email' } });
      });
    });

    describe('Google', () => {
      it('linkGoogle sends the page to Google', async () => {
        const svc = makeService();
        await ctx.signIn(svc, ctx.freshEmail('lnk'));
        expect(await ctx.linkGoogle(svc)).toBe(true);
      });

      it('unlinkGoogle on an account without Google changes nothing', async () => {
        const svc = makeService();
        await ctx.signIn(svc, ctx.freshEmail('unl'));
        expect((await unwrap(svc.unlinkGoogle())).googleLinked).toBe(false);
      });

      it('unlinkGoogle when Google is the only sign-in method → conflict / last-method', async (t) => {
        if (!ctx.googleOnlyAccount) return t.skip();
        const svc = makeService();
        await ctx.googleOnlyAccount(svc);
        expect(await svc.unlinkGoogle()).toMatchObject({ ok: false, error: { code: 'conflict', reason: 'last-method' } });
      });
    });

    describe('data export and account deletion', () => {
      it.skip('exportData answers the subject data — до SPEC-20', () => {});
      it.skip('deleteAccount erases the account — до SPEC-20', () => {});
    });
  });
}
