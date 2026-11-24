/**
 * Stream sources wire vocabulary (SPEC-21a): channels, blacklist, candidate queue, owner slice «Джерела» actions and
 * the stream-search agent's three addresses. Zod-free types and constants; schemas live in `streams.schemas.ts`.
 */

export const CANDIDATE_STATES = ['new', 'proposed', 'approved', 'rejected', 'active', 'dead', 'archive'] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/** Why a candidate is `rejected`: the cheap check (AC-11), the blacklist (AC-3) or the owner. */
export const CANDIDATE_REASONS = ['blacklisted', 'private', 'not-embeddable', 'not-live', 'not-found', 'owner'] as const;
export type CandidateReason = (typeof CANDIDATE_REASONS)[number];

/** Where a candidate was found (AC-7); a candidate keeps every origin it was added from (AC-9). */
export const FOUND_BY = ['owner', 'agent', 'playlist', 'search', 'import'] as const;
export type FoundBy = (typeof FOUND_BY)[number];

/** `watched` = «стежимо», `proposed` = «запропоновано» (by the agent, not watched until the owner approves), `off`. */
export const CHANNEL_STATES = ['watched', 'proposed', 'off'] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/** Channel types of the expected-streams table; `irl` = streamers (В4). */
export const CHANNEL_KINDS = ['address', 'celebration', 'irl', 'tv', 'webcam'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const CHANNEL_PRIORITIES = [1, 2, 3] as const;
export type ChannelPriority = (typeof CHANNEL_PRIORITIES)[number];

/** AC-14: anything else is `invalid` without a YouTube call. */
export const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export const STREAMS_EVIDENCE_URL_MAX = 500;
export const STREAMS_NOTE_MAX = 300;
export const STREAMS_REASON_MAX = 200;
export const STREAMS_NAME_MAX = 120;
/** Every owner and agent body of this wave (AC-21, AC-33). */
export const STREAMS_BODY_MAX_BYTES = 1024;
/** Agent candidate list page size (contract `GET /cms-api/stream-agent/candidates`). */
export const AGENT_CANDIDATES_PAGE_MAX = 100;

/** A raw request body within `STREAMS_BODY_MAX_BYTES` (UTF-8 bytes, not characters). */
export function streamsBodyWithinLimit(raw: string): boolean {
  return new TextEncoder().encode(raw).length <= STREAMS_BODY_MAX_BYTES;
}

// ---- Agent: `GET /cms-api/stream-agent/channels` ----

export interface AgentChannel {
  channelId: string;
  name: string;
  type: ChannelKind;
  zones: string[];
  seasons: string[];
  priority: ChannelPriority;
  state: ChannelState;
}

export interface AgentChannelsResponse {
  channels: AgentChannel[];
  /** Blacklisted channelIds. */
  blacklist: string[];
}

// ---- Agent: `GET /cms-api/stream-agent/candidates?state=&eventId=&cursor=` ----

export interface AgentCandidatesQuery {
  state?: CandidateState;
  eventId?: string;
  cursor?: string;
}

export interface AgentCandidate {
  videoId: string;
  /** Absent while the cheap check has not run yet (AC-13) or the video was not found. */
  channelId?: string;
  foundBy: FoundBy[];
  state: CandidateState;
  eventId?: string;
  reason?: CandidateReason;
  scheduledStartTime?: string;
  checkedAt?: string;
}

export interface AgentCandidatesResponse {
  /** At most `AGENT_CANDIDATES_PAGE_MAX`. */
  items: AgentCandidate[];
  next?: string;
}

// ---- Agent: `POST /cms-api/stream-agent/candidates` ----

interface ProposeExtras {
  eventId?: string;
  /** https only, ≤ `STREAMS_EVIDENCE_URL_MAX`. */
  evidenceUrl?: string;
  /** ≤ `STREAMS_NOTE_MAX`. */
  note?: string;
}

export type AgentProposeBody = ({ videoId: string } | { channelId: string }) & ProposeExtras;

export interface AgentProposeResult {
  videoId?: string;
  channelId?: string;
  /** A candidate state for `videoId`, a channel state for `channelId`. */
  state: CandidateState | ChannelState;
  reason?: CandidateReason;
  created: boolean;
  /** For `channelId`: candidates added from the uploads playlist (AC-12). */
  added?: number;
}

// ---- Owner: `/cms-api/streams/*` (slice «Джерела», owner only) ----

export const STREAMS_ACTIONS = [
  'channel-add',
  'channel-edit',
  'blacklist',
  'unblacklist',
  'channel-approve',
  'candidate-add',
  'approve',
  'reject',
  'requeue',
] as const;
export type StreamsAction = (typeof STREAMS_ACTIONS)[number];

interface ChannelFields {
  name: string;
  kind: ChannelKind;
  zones: string[];
  priority: ChannelPriority;
}

export type StreamsActionBody =
  | ({ action: 'channel-add'; channelId: string } & ChannelFields)
  | ({ action: 'channel-edit'; channelId: string } & Partial<ChannelFields> & { state?: 'watched' | 'off' })
  | { action: 'blacklist' | 'unblacklist'; channelId: string; reason: string }
  | { action: 'channel-approve'; channelId: string }
  | ({ action: 'candidate-add'; eventId?: string } & ({ videoId: string } | { channelId: string }))
  | { action: 'approve'; videoId: string; eventId: string; reason?: string }
  | { action: 'reject'; videoId: string; reason: string }
  | { action: 'requeue'; videoId: string };

/** `GET /cms-api/streams/view` filters (AC-20). */
export interface StreamsViewQuery {
  state?: CandidateState;
  eventId?: string;
}

// ---- Input file `data/stream-channels.json` (`import channels`, AC-39) ----

export interface StreamChannelsFileChannel {
  channelId: string;
  name: string;
  kind: ChannelKind;
  zones: string[];
  priority: ChannelPriority;
}

export interface StreamChannelsFile {
  version: 1;
  /** `YYYY-YY`, e.g. `2026-27`. */
  season: string;
  channels: StreamChannelsFileChannel[];
  blacklist: { channelId: string; reason: string }[];
}
