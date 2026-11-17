/**
 * Agent API keys (AC-15, AC-16, NFR-5). Ring 3: issue and revoke, no Payload import.
 *
 * - Only the owner issues or revokes, and only for agent records.
 * - The key is 32 random bytes, base64url. Its value is returned once, from `issue`, and is never
 *   logged; Payload stores it encrypted and never returns it on a read.
 * - Revoke clears the key, so the very next request with it finds no record (no cache).
 */
import { randomBytes } from 'node:crypto';
import { isAgentRole, type Role } from '../domain/access/roles';

/** The admin records as the key service needs them. */
export interface AgentKeyStore {
  /** The role of the record, or `null` when there is no such record. */
  roleOf(id: string): Promise<string | null>;
  /** Sets the key and enables it, or (with `null`) removes and disables it. */
  setKey(id: string, key: string | null): Promise<void>;
}

export type KeyRefusal = 'forbidden' | 'not-found' | 'not-agent';
export type IssueResult = { ok: true; key: string } | { ok: false; reason: KeyRefusal };
export type RevokeResult = { ok: true } | { ok: false; reason: KeyRefusal };

export interface KeyService {
  issue(actor: Role | null, targetId: string): Promise<IssueResult>;
  revoke(actor: Role | null, targetId: string): Promise<RevokeResult>;
}

const newKey = (): string => randomBytes(32).toString('base64url');

export function createKeyService(store: AgentKeyStore, generate: () => string = newKey): KeyService {
  async function target(actor: Role | null, id: string): Promise<KeyRefusal | null> {
    // The actor is checked before the lookup, so a non-owner learns nothing about the records.
    if (actor !== 'owner') return 'forbidden';
    const role = await store.roleOf(id);
    if (role === null) return 'not-found';
    return isAgentRole(role) ? null : 'not-agent';
  }
  return {
    async issue(actor, id) {
      const refused = await target(actor, id);
      if (refused) return { ok: false, reason: refused };
      const key = generate();
      await store.setKey(id, key);
      return { ok: true, key };
    },
    async revoke(actor, id) {
      const refused = await target(actor, id);
      if (refused) return { ok: false, reason: refused };
      await store.setKey(id, null);
      return { ok: true };
    },
  };
}
