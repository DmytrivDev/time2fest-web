/** Zod schemas of the stream sources wire (SPEC-21a). Server and tests only (via `schemas.ts`). */
import { z } from 'zod';
import {
  AGENT_CANDIDATES_PAGE_MAX,
  CANDIDATE_REASONS,
  CANDIDATE_STATES,
  CHANNEL_ID_PATTERN,
  CHANNEL_KINDS,
  CHANNEL_STATES,
  FOUND_BY,
  STREAMS_EVIDENCE_URL_MAX,
  STREAMS_NAME_MAX,
  STREAMS_NOTE_MAX,
  STREAMS_REASON_MAX,
  VIDEO_ID_PATTERN,
  type AgentCandidatesQuery,
  type AgentCandidatesResponse,
  type AgentChannelsResponse,
  type AgentProposeBody,
  type AgentProposeResult,
  type StreamChannelsFile,
  type StreamsActionBody,
  type StreamsViewQuery,
} from './streams';

/** AC-14. */
export const VideoIdSchema = z.string().regex(VIDEO_ID_PATTERN);
export const ChannelIdSchema = z.string().regex(CHANNEL_ID_PATTERN);

/** A catalog event id in a request (same alphabet as the live wire). */
const eventId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
/** A zone id like `utc+0545`. */
const zoneId = z.string().regex(/^[a-z0-9+:-]{1,32}$/);
const iso = z.string().min(1);
const priority = z.union([z.literal(1), z.literal(2), z.literal(3)]);
const name = z.string().trim().min(1).max(STREAMS_NAME_MAX);
const reason = z.string().trim().min(1).max(STREAMS_REASON_MAX);
const kind = z.enum(CHANNEL_KINDS);
const zones = z.array(zoneId).max(64);
const candidateState = z.enum(CANDIDATE_STATES);
const candidateReason = z.enum(CANDIDATE_REASONS);
const evidenceUrl = z
  .string()
  .max(STREAMS_EVIDENCE_URL_MAX)
  .refine((u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  });
const note = z.string().max(STREAMS_NOTE_MAX);
const cursor = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const CandidateStateSchema = candidateState;
export const ChannelStateSchema = z.enum(CHANNEL_STATES);
export const FoundBySchema = z.enum(FOUND_BY);

// ---- Agent ----

export const AgentChannelsResponseSchema = z
  .object({
    channels: z.array(
      z
        .object({
          channelId: ChannelIdSchema,
          name: z.string(),
          type: kind,
          zones: z.array(z.string()),
          seasons: z.array(z.string()),
          priority,
          state: ChannelStateSchema,
        })
        .strict(),
    ),
    blacklist: z.array(ChannelIdSchema),
  })
  .strict() satisfies z.ZodType<AgentChannelsResponse>;

export const AgentCandidatesQuerySchema = z
  .object({ state: candidateState.optional(), eventId: eventId.optional(), cursor: cursor.optional() })
  .strict() satisfies z.ZodType<AgentCandidatesQuery>;

export const AgentCandidatesResponseSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            videoId: VideoIdSchema,
            channelId: ChannelIdSchema.optional(),
            foundBy: z.array(FoundBySchema),
            state: candidateState,
            eventId: z.string().optional(),
            reason: candidateReason.optional(),
            scheduledStartTime: iso.optional(),
            checkedAt: iso.optional(),
          })
          .strict(),
      )
      .max(AGENT_CANDIDATES_PAGE_MAX),
    next: cursor.optional(),
  })
  .strict() satisfies z.ZodType<AgentCandidatesResponse>;

/**
 * A token shaped like a secret (S21-02): a run of 32+ base64url characters mixing upper case, lower case and digits
 * (an agent key is 43), or a run of 32+ hex characters with digits and letters (an Access client id / secret). An agent steered by a page into
 * expanding a secret variable into `note` / `evidenceUrl` is refused, so no key reaches the queue, journal or dumps.
 */
export function looksLikeSecret(text: string): boolean {
  const hex = (text.match(/[0-9a-fA-F]{32,}/g) ?? []).some((run) => /\d/.test(run) && /[a-fA-F]/.test(run));
  return hex || (text.match(/[A-Za-z0-9_-]{32,}/g) ?? []).some((run) => /[A-Z]/.test(run) && /[a-z]/.test(run) && /\d/.test(run));
}
const noSecret = (v: string) => !looksLikeSecret(v);

const proposeExtras = {
  eventId: eventId.optional(),
  evidenceUrl: evidenceUrl.refine(noSecret, 'secret-shaped').optional(),
  note: note.refine(noSecret, 'secret-shaped').optional(),
};

/** Exactly one of `videoId` / `channelId` (both at once fail `.strict()` on each side). */
export const AgentProposeBodySchema = z.union([
  z.object({ videoId: VideoIdSchema, ...proposeExtras }).strict(),
  z.object({ channelId: ChannelIdSchema, ...proposeExtras }).strict(),
]) satisfies z.ZodType<AgentProposeBody>;

export const AgentProposeResultSchema = z
  .object({
    videoId: VideoIdSchema.optional(),
    channelId: ChannelIdSchema.optional(),
    state: z.union([candidateState, ChannelStateSchema]),
    reason: candidateReason.optional(),
    created: z.boolean(),
    added: z.number().int().nonnegative().optional(),
  })
  .strict() satisfies z.ZodType<AgentProposeResult>;

// ---- Owner slice ----

const channelFields = { name, kind, zones, priority };

/** A plain union: `candidate-add` has two shapes under one action, which a discriminated union cannot hold. */
export const StreamsActionBodySchema = z.union([
  z.object({ action: z.literal('channel-add'), channelId: ChannelIdSchema, ...channelFields }).strict(),
  z
    .object({
      action: z.literal('channel-edit'),
      channelId: ChannelIdSchema,
      name: name.optional(),
      kind: kind.optional(),
      zones: zones.optional(),
      priority: priority.optional(),
      state: z.enum(['watched', 'off']).optional(),
    })
    .strict(),
  z.object({ action: z.literal('blacklist'), channelId: ChannelIdSchema, reason }).strict(),
  z.object({ action: z.literal('unblacklist'), channelId: ChannelIdSchema, reason }).strict(),
  z.object({ action: z.literal('channel-approve'), channelId: ChannelIdSchema }).strict(),
  z.object({ action: z.literal('candidate-add'), videoId: VideoIdSchema, eventId: eventId.optional() }).strict(),
  z.object({ action: z.literal('candidate-add'), channelId: ChannelIdSchema, eventId: eventId.optional() }).strict(),
  z.object({ action: z.literal('approve'), videoId: VideoIdSchema, eventId, reason: reason.optional() }).strict(),
  z.object({ action: z.literal('reject'), videoId: VideoIdSchema, reason }).strict(),
  z.object({ action: z.literal('requeue'), videoId: VideoIdSchema }).strict(),
]) satisfies z.ZodType<StreamsActionBody>;

export const StreamsViewQuerySchema = z
  .object({ state: candidateState.optional(), eventId: eventId.optional() })
  .strict() satisfies z.ZodType<StreamsViewQuery>;

// ---- Input file `data/stream-channels.json` ----

export const StreamChannelsFileSchema = z
  .object({
    version: z.literal(1),
    season: z.string().regex(/^\d{4}-\d{2}$/),
    channels: z.array(z.object({ channelId: ChannelIdSchema, ...channelFields }).strict()),
    blacklist: z.array(z.object({ channelId: ChannelIdSchema, reason }).strict()),
  })
  .strict() satisfies z.ZodType<StreamChannelsFile>;
