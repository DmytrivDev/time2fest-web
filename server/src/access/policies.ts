/**
 * Payload `access` functions built from the role policy table (`domain/access/roles.ts`).
 * Payload glue (ring 4), thin: every collection and global of this wave takes its access here.
 * No user, or a role outside the three, may do nothing (deny by default).
 */
import type { Access } from 'payload';
import { can, isRole, type CollectionGroup, type Operation, type Role } from '../domain/access/roles';

/** The role of a signed-in admin record, or `null`. */
export function roleOf(user: unknown): Role | null {
  const role = typeof user === 'object' && user !== null ? (user as { role?: unknown }).role : undefined;
  return isRole(role) ? role : null;
}

/** One Payload access function per operation for a collection group. */
export function accessFor(group: CollectionGroup): Record<Operation, Access> {
  const fn = (op: Operation): Access => ({ req }) => can(roleOf(req.user), group, op);
  return { read: fn('read'), create: fn('create'), update: fn('update'), delete: fn('delete') };
}

/** The owner only (field access and globals). */
export const ownerOnly: Access = ({ req }) => roleOf(req.user) === 'owner';
