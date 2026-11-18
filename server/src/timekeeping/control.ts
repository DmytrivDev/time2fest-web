/**
 * Clock control of the rehearsal (SPEC-07 AC-51, AC-54, AC-56, NFR-7; C3, C9, C10), ring 3.
 *
 * One use case for both entries: the owner's `POST /cms-api/clock` (admin) and the `ops` CLI over
 * SSH. Every action is ONE `SharedClock.change` — one transaction with one journal row naming the
 * actor, before and after (the store writes it) — and then ONE `clock` event on `site:state` with the
 * deterministic id `clock:<epoch>:<seq>` (`clockEventId`). A publish that fails or is not configured
 * is logged and never undoes the change: the clock is the source of truth, the event only a hint for
 * open tabs to resync.
 *
 * - Only in the classes `rehearsal` and `test`; any other class → `forbidden`, nothing changes.
 * - The owner may only «виставити момент» (speed 1), «повернути реальний час», «почати ніч знову»;
 *   a speed other than 1 is an `ops` action only (spec07-q1).
 */
import type { ClockEvent } from '@time2fest/contracts';
import { backToReal, clockEventId, effective, restartNight, setMoment, setSpeed, type VirtualState } from '../domain/timekeeping/virtual';
import { publisherOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import type { EnvClass } from '../platform/env';
import type { Logger } from '../ports';
import type { ChannelPublisher } from '../realtime/ports';
import type { Actor } from './ports';
import type { SharedClock } from './shared';

/** Classes with clock control. Production never has it (AC-52). */
export const CLOCK_CONTROL_CLASSES: readonly EnvClass[] = ['rehearsal', 'test'];

/** The highest speed `ops` may set (C10). */
export const MAX_CLOCK_SPEED = 600;

/** The `ops` actor of the CLI (AC-54): the journal shows who changed the clock. */
export const OPS_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'ops', label: 'ops' });

/** The channel class of the `clock` event (C3). */
export const CLOCK_EVENT_CLASS = 'site:state';

export type ClockAction =
  | { action: 'set'; at: number }
  | { action: 'real' }
  | { action: 'restart-night' }
  | { action: 'speed'; speed: number };

/** Who acts: the owner through the admin, or `ops` through the CLI. */
export type ClockControlRole = 'owner' | 'ops';

export interface ClockControlDeps {
  cls: EnvClass;
  clock: Pick<SharedClock, 'change' | 'view'>;
  /** Absent when realtime is not configured: the change still happens, the event is not sent. */
  publisher?: ChannelPublisher;
  log: Logger;
}

/** What the `clock` event publish ended with; `not-configured` when there is no publisher. */
export type ClockPublishStatus = 'ok' | 'queued' | 'validation' | 'unavailable' | 'not-configured';

/** C9 value plus what the CLI shows. */
export interface ClockControlOutcome {
  now: number;
  speed: number;
  frozen: boolean;
  virtual: boolean;
  epoch: number;
  seq: number;
  eventId: string;
  published: ClockPublishStatus;
}

export type ClockControlResult = { ok: true; value: ClockControlOutcome } | { ok: false; code: 'forbidden' | 'validation' };

/** The control deps of a process, or `undefined` where the class has no shared clock (production). */
export function clockControlDepsOf(deps: Deps): ClockControlDeps | undefined {
  if (!deps.sharedClock) return undefined;
  let publisher: ChannelPublisher | undefined;
  try {
    publisher = publisherOf(deps);
  } catch {
    publisher = undefined;
  }
  return { cls: deps.env.class, clock: deps.sharedClock, log: deps.log, ...(publisher ? { publisher } : {}) };
}

const isInstant = (v: number) => Number.isSafeInteger(v) && v >= 0;
const isSpeed = (v: number) => Number.isInteger(v) && v >= 0 && v <= MAX_CLOCK_SPEED;

/** The transition of `action`, or `null` when its argument is out of range. */
function transitionOf(action: ClockAction): ((s: VirtualState, realNow: number) => VirtualState) | null {
  switch (action.action) {
    case 'set':
      return isInstant(action.at) ? (s, real) => setMoment(s, action.at, real) : null;
    case 'real':
      return (s, real) => backToReal(s, real);
    case 'restart-night':
      return (s, real) => restartNight(s, real);
    case 'speed':
      return isSpeed(action.speed) ? (s, real) => setSpeed(s, action.speed, real) : null;
    default:
      return null;
  }
}

async function publish(d: ClockControlDeps, event: ClockEvent): Promise<ClockPublishStatus> {
  if (!d.publisher) return 'not-configured';
  try {
    return (await d.publisher.publish(CLOCK_EVENT_CLASS, undefined, event)).status;
  } catch {
    return 'unavailable';
  }
}

/**
 * Applies one clock action for `actor` acting as `role`. Refusals (`forbidden`, `validation`) change
 * nothing. A store failure rejects (the caller maps it to `unavailable`); nothing was written then.
 */
export async function controlClock(d: ClockControlDeps, role: ClockControlRole, actor: Actor, action: ClockAction): Promise<ClockControlResult> {
  if (!CLOCK_CONTROL_CLASSES.includes(d.cls)) return { ok: false, code: 'forbidden' };
  if (action.action === 'speed' && role !== 'ops') return { ok: false, code: 'forbidden' };
  const transition = transitionOf(action);
  if (!transition) return { ok: false, code: 'validation' };

  const written = await d.clock.change(actor, transition);
  const { speed, frozen } = effective(written);
  const eventId = clockEventId(written);
  const published = await publish(d, { type: 'clock', id: eventId, data: { virtual: written.virtual, speed } });
  // NFR-7: the journal row is the store's; this line only tells whether open tabs were told. No label (an email).
  const fields = { event: 'clock_control', action: action.action, role, actor: actor.id, epoch: written.runEpoch, seq: written.seq, published };
  if (published === 'ok' || published === 'queued') d.log.info(fields);
  else d.log.warn(fields);
  return {
    ok: true,
    value: { now: d.clock.view().now, speed, frozen, virtual: written.virtual, epoch: written.runEpoch, seq: written.seq, eventId, published },
  };
}
