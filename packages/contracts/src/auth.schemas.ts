/** Zod wire schemas of the auth contract (SPEC-10). Server and tests only. */
import { z } from 'zod';
import { SESSION_EVENT_REASONS } from './auth';

const email = z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/);
const ms = z.number().int().nonnegative();

export const AuthCodeIntentSchema = z.enum(['signin', 'signup']);

/** `POST /api/auth/request-code` body. */
export const requestCodeBody = z.object({ email, intent: AuthCodeIntentSchema }).strict();
export type RequestCodeBody = z.infer<typeof requestCodeBody>;

/** `POST /api/auth/verify-code` body. */
export const verifyCodeBody = z.object({ email, otp: z.string().regex(/^\d{6}$/) }).strict();
export type VerifyCodeBody = z.infer<typeof verifyCodeBody>;

/** `POST /api/auth/google` body. */
export const googleBody = z.object({ returnPath: z.string().min(1).max(512) }).strict();
export type GoogleBody = z.infer<typeof googleBody>;

export const codeInfoSchema = z
  .object({
    email,
    intent: AuthCodeIntentSchema,
    sentAt: ms,
    resendAt: ms,
    expiresAt: ms,
    attemptsLeft: z.number().int().min(0).max(5),
  })
  .strict();
export type CodeInfoWire = z.infer<typeof codeInfoSchema>;

export const signInOutcomeSchema = z.object({ isNew: z.boolean(), email }).strict();
export type SignInOutcomeWire = z.infer<typeof signInOutcomeSchema>;

export const googleRedirectSchema = z.object({ kind: z.literal('redirect'), url: z.string().min(1) }).strict();
export type GoogleRedirectWire = z.infer<typeof googleRedirectSchema>;

export const sessionUserSchema = z
  .object({
    id: z.string().min(1),
    email,
    via: z.enum(['google', 'email']),
    signedInAt: ms,
    name: z.string().optional(),
  })
  .strict();

/** Mirrors `lib/api/contracts/auth.ts` `Session` (pass fields are neutral until the pass wave). */
export const sessionSchema = z
  .object({
    user: sessionUserSchema.nullable(),
    guestId: z.string().min(1),
    hasPass: z.boolean(),
    passOn: z.enum(['account', 'device']).nullable(),
    passSince: ms.nullable(),
    passNight: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    devicePass: z.object({ email, since: ms }).strict().nullable(),
    code: codeInfoSchema.nullable(),
  })
  .strict();
export type SessionWire = z.infer<typeof sessionSchema>;

export const sessionEventSchema = z
  .object({
    type: z.literal('session'),
    id: z.string().min(1).max(64),
    data: z.object({ reason: z.enum(SESSION_EVENT_REASONS) }).strict(),
  })
  .strict();

/** Test doors (`/api/_test/auth/*`, `/api/_test/mail/counter`). */
export const authLastCodeDoor = z.object({ to: email }).strict();
export const authExpireCodeDoor = z.object({ email }).strict();
export const authGoogleUserDoor = z
  .object({ sub: z.string().min(1).max(128), email, emailVerified: z.boolean(), name: z.string().max(128).optional() })
  .strict();
export const mailCounterDoor = z
  .object({ provider: z.enum(['primary', 'fallback']), count: z.number().int().nonnegative() })
  .strict();

/** Test doors of the rights wave (SPEC-11): `/api/_test/rights/*`. */
const doorEmail = z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/);
export const rightsPassGrantDoor = z
  .object({
    holder: z.union([
      z.object({ account: z.string().min(1).max(64) }).strict(),
      z.object({ device: z.string().min(1).max(64), paymentEmail: doorEmail }).strict(),
    ]),
    source: z.string().min(1).max(32),
    grantRef: z.string().min(1).max(128),
    issuedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
export const rightsPassRevokeDoor = z.object({ grantRef: z.string().min(1).max(128) }).strict();
export const rightsBanDoor = z
  .object({ kind: z.enum(['account', 'guest', 'device', 'ip-day']), subject: z.string().min(1).max(128) })
  .strict();
export const rightsFixtureDoor = z.object({ name: z.string().min(1).max(64) }).strict();
export const rightsLinkFaultDoor = z.object({ handler: z.string().min(1).max(64) }).strict();
