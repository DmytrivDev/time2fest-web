/** Zod wire schemas of the clock contract (SPEC-07). Server and tests only. */
import { z } from 'zod';
import { FESTIVAL_STATE_BLOCKS, type ClockEvent, type FestivalStateView } from './clock';

/** `POST /api/_test/scheduler/night-run` body (C7). */
export const NightRunBodySchema = z
  .object({
    speed: z.number().int().min(1).max(600).default(60),
    from: z.number().int().nonnegative().optional(),
    to: z.number().int().nonnegative().optional(),
  })
  .strict();
export type NightRunBody = z.infer<typeof NightRunBodySchema>;

/** `POST /api/_test/scheduler/lease` body (C7). */
export const LeaseDoorBodySchema = z.object({ action: z.enum(['pause', 'resume']) }).strict();
export type LeaseDoorBody = z.infer<typeof LeaseDoorBodySchema>;

/** `POST /api/_test/scheduler/fault` body (C7). */
export const FaultDoorBodySchema = z
  .object({ after: z.literal('publish'), action: z.string().min(1).max(64).optional() })
  .strict();
export type FaultDoorBody = z.infer<typeof FaultDoorBodySchema>;

/** `POST /cms-api/clock` body (C9). */
export const ClockControlBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), at: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal('real') }).strict(),
  z.object({ action: z.literal('restart-night') }).strict(),
]);
export type ClockControlBody = z.infer<typeof ClockControlBodySchema>;

/** `clock` event of `site:state` (C3). */
export const ClockEventSchema = z
  .object({
    type: z.literal('clock'),
    id: z.string().regex(/^clock:\d+:\d+$/),
    data: z
      .object({ virtual: z.boolean(), speed: z.number().int().min(0).max(600) })
      .strict(),
  })
  .strict() satisfies z.ZodType<ClockEvent>;

export const FestivalStateViewSchema = z
  .object({
    phase: z.string(),
    slot: z.object({ current: z.string().nullable(), next: z.string().nullable() }).strict(),
    moments: z.array(
      z
        .object({
          at: z.number().int().nonnegative(),
          kind: z.string(),
          subject: z.string().nullable(),
        })
        .strict(),
    ),
    scheduler: z
      .object({
        holder: z.string().nullable(),
        epoch: z.number().int().nonnegative(),
        renewedAgeMs: z.number().nullable(),
        delayMs: z.number().nullable(),
        missed24h: z.number().int().nonnegative(),
      })
      .strict(),
    edgeSkewMs: z.number().nullable(),
    clock: z
      .object({
        virtual: z.boolean(),
        speed: z.number().int().min(0).max(600),
        epoch: z.number().int().nonnegative(),
        now: z.number().int().nonnegative().optional(),
      })
      .strict(),
    errors: z.array(z.enum(FESTIVAL_STATE_BLOCKS)).optional(),
  })
  .strict() satisfies z.ZodType<FestivalStateView>;
