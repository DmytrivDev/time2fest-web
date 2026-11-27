/** Zod wire schemas of the passport contract (SPEC-14). Server and tests only. */
import { z } from 'zod';
import { PRESENCE_SOURCES } from './passport';

const ms = z.number().int().nonnegative();
const eventId = z.string().min(1).max(64);
const source = z.enum(PRESENCE_SOURCES);

/** `POST /api/presence` body: 1..8 events, no player state. */
export const presenceBeatBody = z.object({ eventIds: z.array(eventId).min(1).max(8), source, openedAt: ms.optional() }).strict();
export type PresenceBeatBody = z.infer<typeof presenceBeatBody>;

export const presenceBeatResponse = z.object({ nextBeatMs: ms.nullable() }).strict();

/** `POST /api/me/stamps` body. */
export const stampClaimBody = z.object({ eventId, source, at: ms }).strict();
export type StampClaimBody = z.infer<typeof stampClaimBody>;

export const stampSchema = z
  .object({
    eventId: z.string().min(1).max(128),
    grantedAt: ms,
    presenceSource: source,
    illustrationId: z.string().min(1).max(128),
    cityName: z.string().min(1).max(128),
    countryIso: z.string().min(1).max(16),
  })
  .strict();
export const stampListSchema = z.array(stampSchema).max(512);

export const stampEventSchema = z
  .object({
    type: z.literal('stamp'),
    id: z.string().min(1).max(64),
    data: z.union([
      z.object({ kind: z.literal('granted'), stamp: stampSchema }).strict(),
      z.object({ kind: z.literal('snapshot'), stamps: stampListSchema }).strict(),
    ]),
  })
  .strict();

const reason = z.string().min(1).max(200);
const region = z.string().min(1).max(32);

/** Test door `/api/_test/presence/fault` (this process only). */
export const presenceFaultDoor = z
  .object({
    fastStore: z.enum(['down', 'up']).optional(),
    dbWrite: z.enum(['down', 'up']).optional(),
    beatErrorRate: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Test door `/api/_test/presence/downtime`: a manual record (one event or a range) or an edge-region report. */
export const presenceDowntimeDoor = z.union([
  z.object({ kind: z.literal('manual'), eventId, reason }).strict(),
  z.object({ kind: z.literal('manual'), from: ms, to: ms, reason }).strict(),
  z.object({ kind: z.literal('edge-region'), region, from: ms, to: ms }).strict(),
]);

export const presenceTickDoor = z.object({}).strict();
export const presenceHealthDoor = z.object({ eventId }).strict();

/** Admin body: add a manual downtime (an event, or a range when `eventId` is absent). */
export const presenceDowntimeAdd = z.object({ eventId: eventId.optional(), from: ms, to: ms, reason }).strict();
export type PresenceDowntimeAdd = z.infer<typeof presenceDowntimeAdd>;
