/** Zod wire schemas of the profile contract (SPEC-11). Server and tests only. */
import { z } from 'zod';

const ms = z.number().int().nonnegative();
const email = z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/);
/** Shape only (alpha-2, `GB-XXX`, or a lowercase special word); the server checks the exact list [Q5]. */
export const flagCodeSchema = z.string().regex(/^(?:[A-Z]{2}|GB-[A-Z]{3}|[a-z]{2,8})$/);

export const profileSettingsSchema = z
  .object({
    hour12: z.boolean(),
    homeCountry: z.string().regex(/^[A-Z]{2}$/).nullable(),
    homeZoneId: z.string().min(1).max(32).nullable(),
    showPassport: z.boolean(),
    showPath: z.boolean(),
    passportHints: z.boolean(),
    quietDefault: z.boolean(),
    reminderEmails: z.boolean(),
  })
  .strict();
export type ProfileSettingsWire = z.infer<typeof profileSettingsSchema>;

const eventId = z.string().min(1).max(128);
const eventIds = z.array(eventId).max(512);

export const pendingEmailSchema = z
  .object({ email, sentAt: ms, resendAt: ms, expiresAt: ms, attemptsLeft: z.number().int().min(0).max(5) })
  .strict();

/** Mirrors `lib/api/contracts/profile.ts` `Profile`. */
export const profileSchema = z
  .object({
    nick: z.string().max(64).nullable(),
    flagCode: flagCodeSchema.nullable(),
    detectedFlag: flagCodeSchema.nullable(),
    settings: profileSettingsSchema,
    schedule: eventIds,
    googleLinked: z.boolean(),
    pendingEmail: pendingEmailSchema.nullable(),
  })
  .strict();
export type ProfileWire = z.infer<typeof profileSchema>;

/** `PATCH /api/me/profile` body (`detectedFlag` is accepted and ignored). */
export const profilePatchBody = z
  .object({
    nick: z.string().max(64).optional(),
    flagCode: flagCodeSchema.optional(),
    detectedFlag: flagCodeSchema.optional(),
    settings: profileSettingsSchema.partial().strict().optional(),
  })
  .strict();
export type ProfilePatchBody = z.infer<typeof profilePatchBody>;

export const scheduleBody = z.object({ eventIds }).strict();
export const scheduleToggleBody = z.object({ eventId }).strict();
export const scheduleReplaceBody = z.object({ outIso: z.string().regex(/^[A-Z]{2}$/), eventId }).strict();
export const emailChangeBody = z.object({ email }).strict();
export const emailVerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const googleLinkBody = z.object({ returnPath: z.string().min(1).max(512) }).strict();
export const nickCheckBody = z.object({ nick: z.string().max(64) }).strict();

export const profileEventSchema = z
  .object({ type: z.literal('profile'), id: z.string().min(1).max(64), data: z.object({}).strict() })
  .strict();

/** Test door `/api/_test/rights/profile-seed`. */
export const rightsProfileSeedDoor = z
  .object({
    subject: z.string().min(1).max(64),
    nick: z.string().max(64).optional(),
    flagCode: flagCodeSchema.optional(),
    schedule: eventIds.optional(),
    settings: profileSettingsSchema.partial().strict().optional(),
  })
  .strict();
