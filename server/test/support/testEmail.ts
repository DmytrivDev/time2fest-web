/**
 * Unique test recipients (SPEC-10 W26, AC-56): Mailpit is shared by every worktree, so each address carries this
 * worktree's slug and a random suffix — `t2f-<slug>-<random8>[+tag]@t2f.test`. The slug is `T2F_SLUG` (set by
 * `scripts/db.mjs` in `.env.local`), else derived from the git branch like the scripts do.
 */
import { randomBytes } from 'node:crypto';
import { resolveWorktree } from '../../scripts/lib/worktree.mjs';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
let derived: string | undefined;

/** This worktree's slug. */
export function worktreeSlug(): string {
  const fromEnv = process.env.T2F_SLUG;
  if (fromEnv) return fromEnv;
  derived ??= (resolveWorktree(process.cwd(), process.env) as { slug: string }).slug;
  return derived;
}

function random8(): string {
  let out = '';
  for (const b of randomBytes(8)) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/** A fresh recipient; `tag` (letters, digits, dashes) is added after `+`. */
export function testEmail(tag?: string, slug: string = worktreeSlug()): string {
  if (tag !== undefined && !/^[a-z0-9-]{1,32}$/.test(tag)) throw new Error(`testEmail: bad tag "${tag}"`);
  return `t2f-${slug}-${random8()}${tag ? `+${tag}` : ''}@t2f.test`;
}
