/**
 * Events of a granted stamp (SPEC-14 [A12], AC-39, AC-40), application ring: the `stamp` envelope (`granted`) on the
 * subject's channel `user:#<subject>` and the internal event `passport.stamp-granted` (subject, season, event, grant
 * kind, new achievement keys) exactly once per inserted stamp. No notification is created here (SPEC-19/21 read the
 * internal event). Neither publication ever throws and neither fails the claim; a failed publish is logged without any
 * subject data (NFR-5), pattern `rights/events.ts` `publishProfileEvent`.
 */
import { randomUUID } from 'node:crypto';
import type { StampEvent } from '@time2fest/contracts';
import type { GrantedStamp } from './stamps';

export const STAMP_GRANTED_TOPIC = 'passport.stamp-granted';

/** Payload of the internal event "stamp granted". */
export interface StampGrantedPayload {
  subject: string;
  season: string;
  eventId: string;
  grantKind: string;
  newKeys: string[];
}

export interface GrantEventPorts {
  /** The channel publisher (absent without realtime). */
  channel(): { publish(channelClass: 'user', key: string, envelope: StampEvent): Promise<{ status: string }> } | undefined;
  /** The internal event publisher (absent without the event log). */
  internal(): { publish(tx: Record<string, never>, topic: string, payload: unknown): Promise<unknown> } | undefined;
  log: { warn(fields: Record<string, unknown>): void };
}

export interface GrantEvents {
  /** Publishes both events for a fresh stamp. Never throws. */
  stampGranted(granted: GrantedStamp, newKeys: readonly string[]): Promise<void>;
}

export function createGrantEvents(ports: GrantEventPorts): GrantEvents {
  const warn = (fields: Record<string, unknown>) => {
    try {
      ports.log.warn(fields);
    } catch {
      // A logger never throws.
    }
  };
  return {
    async stampGranted(granted, newKeys) {
      const envelope: StampEvent = { type: 'stamp', id: randomUUID(), data: { kind: 'granted', stamp: granted.stamp } };
      let result: string;
      try {
        const channel = ports.channel();
        result = channel ? (await channel.publish('user', granted.subjectId, envelope)).status : 'not-configured';
      } catch {
        result = 'unavailable';
      }
      if (result !== 'ok') warn({ event: 'stamp-publish', result });

      const payload: StampGrantedPayload = {
        subject: granted.subjectId,
        season: granted.season,
        eventId: granted.stamp.eventId,
        grantKind: granted.grant.kind,
        newKeys: [...newKeys],
      };
      try {
        const internal = ports.internal();
        if (internal) await internal.publish({}, STAMP_GRANTED_TOPIC, payload);
        else warn({ event: 'stamp-internal-event', result: 'not-configured' });
      } catch {
        warn({ event: 'stamp-internal-event', result: 'unavailable' });
      }
    },
  };
}
