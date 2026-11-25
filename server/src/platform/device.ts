/**
 * Device cookie `__Host-t2f_device` (SPEC-10 W14, [П-3], AC-1, AC-2), ring 3.
 * - 128 random bits as 22 base64url characters; a cookie of any other shape is treated as missing.
 * - Attributes: `Max-Age` 400 days, `Path=/`, `Secure; HttpOnly; SameSite=Lax`, no `Domain`.
 * - Not under Better Auth's cookie prefix, so signing out never touches it (AC-2).
 * - `__Host-` name (S10-04): a sibling subdomain cannot plant it with `Domain=`; the browser requires `Secure`, `Path=/`
 *   and no `Domain`, which it already has.
 */
import { randomBytes } from 'node:crypto';

export const DEVICE_COOKIE = '__Host-t2f_device';
export const DEVICE_MAX_AGE_S = 400 * 24 * 60 * 60;
const DEVICE_ID = /^[A-Za-z0-9_-]{22}$/;

/** Value of cookie `name` in a `Cookie` header (first occurrence), or `undefined`. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Whether `value` has the shape of a device id. */
export function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID.test(value);
}

/** The device id of a valid `__Host-t2f_device` cookie of `req`, or `undefined`. */
export function readDevice(req: Request): string | undefined {
  const value = readCookie(req.headers.get('cookie'), DEVICE_COOKIE);
  return isDeviceId(value) ? value : undefined;
}

/** A fresh device id: 128 random bits, base64url (22 characters). */
export function newDevice(): string {
  return randomBytes(16).toString('base64url');
}

/** The `Set-Cookie` value for `id`. */
export function deviceCookie(id: string): string {
  return `${DEVICE_COOKIE}=${id}; Max-Age=${DEVICE_MAX_AGE_S}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
