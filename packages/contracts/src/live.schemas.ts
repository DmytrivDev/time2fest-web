/** Zod schemas of the live wire (SPEC-12). Server and tests only (via `schemas.ts`). */
import { z } from 'zod';
import {
  LIVE_ARCHIVE_DECISIONS,
  LIVE_REASON_MAX,
  LIVE_VIDEO_STATES,
  SOURCE_ERROR_CODES,
  type ChainsResponse,
  type LiveActionBody,
  type LiveArchiveRow,
  type LiveDoorBody,
  type SourceErrorReport,
  type StreamChain,
  type StreamEvent,
  type StreamSource,
  type ViewerSummary,
} from './live';

const str = z.string();
const id = z.string().min(1);
const int0 = z.number().int().nonnegative();
const StatusSchema = z.enum(['live', 'expected', 'possible']);

export const StreamSourceSchema = z
  .object({
    id,
    platform: z.enum(['youtube', 'facebook', 'twitch']),
    videoId: str.optional(),
    url: str,
    kind: z.enum(['main', 'webcam', 'tv']),
    title: z.object({ uk: str }).strict(),
    order: int0,
    status: StatusSchema,
    startsAt: str.optional(),
    embeddable: z.boolean(),
    lastChecked: str,
    verified: z.boolean(),
    isLive: z.boolean(),
    replay: z.object({ videoId: str.optional(), url: str }).strict().optional(),
    isRecording: z.boolean().optional(),
    test: z.boolean().optional(),
    testNote: str.optional(),
    alwaysOn: z.boolean().optional(),
    sync: z.object({ midnightSec: z.number().finite(), durationSec: z.number().finite().optional() }).strict().optional(),
    override: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<StreamSource>;

export const StreamChainSchema = z
  .object({ eventId: id, sources: z.array(StreamSourceSchema), version: int0.optional() })
  .strict() satisfies z.ZodType<StreamChain>;

export const StreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('source'), eventId: id, source: StreamSourceSchema, version: int0 }).strict(),
  z.object({ type: z.literal('chain'), chain: StreamChainSchema, version: int0 }).strict(),
  z.object({ type: z.literal('hide'), eventId: id, sourceId: id, version: int0 }).strict(),
]) satisfies z.ZodType<StreamEvent>;

export const ChainsResponseSchema = z
  .object({ version: int0, at: str, chains: z.array(StreamChainSchema) })
  .strict() satisfies z.ZodType<ChainsResponse>;

export const ViewerSummarySchema = z
  .object({
    countries: z.array(z.object({ iso: str, name: str, flagCode: str }).strict()),
    people: int0.optional(),
    at: str,
  })
  .strict() satisfies z.ZodType<ViewerSummary>;

export const SourceErrorReportSchema = z
  .object({
    eventId: id,
    sourceId: id,
    code: z.number().refine((c): c is SourceErrorReport['code'] => (SOURCE_ERROR_CODES as readonly number[]).includes(c)),
  })
  .strict() satisfies z.ZodType<SourceErrorReport>;

const reason = z.string().min(1).max(LIVE_REASON_MAX);

export const LiveActionBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('hide'), eventId: id, sourceId: id, reason }).strict(),
  z.object({ action: z.literal('unhide'), eventId: id, sourceId: id, reason }).strict(),
  z.object({ action: z.literal('main'), eventId: id, sourceId: id, reason }).strict(),
  z.object({ action: z.literal('override'), eventId: id, sourceId: id, status: StatusSchema, reason }).strict(),
  z.object({ action: z.literal('zone-live'), zoneId: id, live: z.boolean(), reason }).strict(),
  z.object({ action: z.literal('replace'), eventId: id, sourceId: id, videoId: id, reason }).strict(),
]) satisfies z.ZodType<LiveActionBody>;

export const LiveDoorBodySchema = z.discriminatedUnion('door', [
  z.object({ door: z.literal('video-status'), videoId: id, state: z.enum(LIVE_VIDEO_STATES) }).strict(),
  z.object({ door: z.literal('quota'), used: int0, exceeded: z.boolean().optional() }).strict(),
  z.object({ door: z.literal('viewers'), people: int0, countries: z.array(str) }).strict(),
  z.object({ door: z.literal('hide'), eventId: id, sourceId: id }).strict(),
  z.object({ door: z.literal('reset-live') }).strict(),
]) satisfies z.ZodType<LiveDoorBody>;

export const LiveArchiveRowSchema = z
  .object({ videoId: id, label: str, order: int0, decision: z.enum(LIVE_ARCHIVE_DECISIONS) })
  .strict() satisfies z.ZodType<LiveArchiveRow>;
