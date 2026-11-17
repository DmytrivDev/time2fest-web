/**
 * Acknowledging an alarm (AC-38), ring 3: only the owner; `acknowledgedAt` comes from the server
 * clock; the store writes it and its journal row in one transaction. Acknowledging an already
 * acknowledged alarm changes nothing and writes no second journal row.
 */
import type { Clock } from '../ports';
import type { AlarmStore } from './ports';
import type { Tx } from '../events/ports';

export type AcknowledgeResult = { ok: true } | { ok: false; reason: 'forbidden' | 'not-found' };

export interface AlarmService {
  acknowledge(tx: Tx, actorRole: string | null, id: string): Promise<AcknowledgeResult>;
}

export function createAlarmService(store: AlarmStore, clock: Clock): AlarmService {
  return {
    async acknowledge(tx, actorRole, id) {
      if (actorRole !== 'owner') return { ok: false, reason: 'forbidden' };
      const outcome = await store.acknowledge(tx, id, clock.now());
      return outcome === 'not-found' ? { ok: false, reason: 'not-found' } : { ok: true };
    },
  };
}
