/** Clock wire types (SPEC-07). Types and constants only: zod-free, re-exported from `index.ts`. */

/** Header the edge sets on origin requests: its own `now` in ms (C8). Trusted only with a valid `x-t2f-edge`. */
export const EDGE_NOW_HEADER = 'x-t2f-edge-now';

/** `site:state` event of a virtual-time change on the rehearsal class (C3). */
export interface ClockEvent {
  type: 'clock';
  /** `clock:<epoch>:<seq>` */
  id: string;
  data: { virtual: boolean; speed: number };
}

/** `POST /api/_test/scheduler/night-run` value (C7). */
export interface NightRunValue {
  epoch: number;
}

/** One executed action in the night-run journal (C7). */
export interface NightRunRecord {
  keys: string[];
  action: string;
  plannedAt: number;
  startedAt: number;
  /** Server (virtual) time when the action ran; `at - plannedAt` is the lateness on the clock scale. */
  at: number;
  consequenceId: string;
}

/** `GET /api/_test/scheduler/night-run` value (C7). */
export interface NightRunJournal {
  epoch: number;
  records: NightRunRecord[];
}

/** `POST /api/_test/scheduler/lease` value (C7). */
export interface LeaseDoorValue {
  holder: boolean;
  epoch: number;
}

/** `POST /cms-api/clock` value (C9). */
export interface ClockControlValue {
  now: number;
  speed: number;
  virtual: boolean;
  epoch: number;
}

/** One upcoming moment in the admin slice. */
export interface FestivalStateMoment {
  at: number;
  kind: string;
  /** Zone id or event id the moment belongs to. */
  subject: string | null;
}

/** The blocks of the admin slice; each one is computed on its own (AC-78). */
export const FESTIVAL_STATE_BLOCKS = ['phase', 'slot', 'moments', 'scheduler', 'edge', 'clock'] as const;
export type FestivalStateBlock = (typeof FESTIVAL_STATE_BLOCKS)[number];

/**
 * Data of the admin slice «стан свята» (AC-75). No stream statuses. A block whose source failed is
 * listed in `errors` (AC-78); its fields then hold neutral placeholders and must not be shown as data.
 */
export interface FestivalStateView {
  phase: string;
  slot: { current: string | null; next: string | null };
  moments: FestivalStateMoment[];
  scheduler: {
    holder: string | null;
    epoch: number;
    renewedAgeMs: number | null;
    delayMs: number | null;
    missed24h: number;
  };
  edgeSkewMs: number | null;
  /** `now` — the server instant (virtual while the clock is virtual), ms. */
  clock: { virtual: boolean; speed: number; epoch: number; now?: number };
  /** Blocks whose source failed this time (AC-78); absent or empty when every block is fine. */
  errors?: FestivalStateBlock[];
}
