/**
 * Roles and the role → operation policy of the admin (AC-14, AC-17, AC-18). Ring 1: pure.
 *
 * - Exactly three roles. A name outside `ROLES` is refused by the `role` select.
 * - Agents may only `read` the catalog. Every other group is owner-only, except `test`
 *   (the `agent-test-posts` collection of AC-19), which agents may read, create and update —
 *   the collection itself opens that only in the `test` class.
 */
export const ROLES = ['owner', 'content-agent', 'stream-agent'] as const;
export type Role = (typeof ROLES)[number];

export const AGENT_ROLES: readonly Role[] = ['content-agent', 'stream-agent'];

export type CollectionGroup = 'catalog' | 'corrections' | 'audit' | 'keys' | 'unattended' | 'alarms' | 'settings' | 'test';
export type Operation = 'read' | 'create' | 'update' | 'delete';

const AGENT_POLICY: Readonly<Record<CollectionGroup, readonly Operation[]>> = {
  catalog: ['read'],
  corrections: [],
  audit: [],
  keys: [],
  unattended: [],
  alarms: [],
  settings: [],
  test: ['read', 'create', 'update'],
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isAgentRole(value: unknown): boolean {
  return isRole(value) && AGENT_ROLES.includes(value);
}

/** Whether `role` may perform `op` on `group`. An unknown or absent role may do nothing. */
export function can(role: unknown, group: CollectionGroup, op: Operation): boolean {
  if (!isRole(role)) return false;
  if (role === 'owner') return true;
  return AGENT_POLICY[group].includes(op);
}

/**
 * The single-owner invariant (AC-14) for a write that does not come from `owner:create`:
 * a create may not produce an `owner`, and an update may not turn a non-owner into one.
 */
export function ownerChangeRefused(input: { operation: 'create' | 'update'; nextRole: unknown; previousRole: unknown }): boolean {
  if (input.nextRole !== 'owner') return false;
  return input.operation === 'create' || input.previousRole !== 'owner';
}
