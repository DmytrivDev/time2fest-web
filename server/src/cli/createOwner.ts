/**
 * `pnpm --dir server owner:create --email <email>` (AC-13): the only way to create the owner.
 * Ring 4 entry point.
 * - The password is read from stdin: typed without echo on a terminal, or piped. Never printed.
 * - The email must be one of `T2F_OWNER_EMAILS`.
 * - Refuses with exit 2 when an owner already exists; 1 on any other refusal or failure.
 * Neither the email nor the password is printed. Journaling with the actor `system:owner-create`
 * is added with the audit journal (W22).
 */
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import type { Payload } from 'payload';
import { TRUSTED_CONTEXT_KEY } from '../access/payloadGuard';
import { isOwnerEmail, parseOwnerEmails } from '../domain/access/ownerEmails';

export const OWNER_CREATE_ACTOR = 'system:owner-create';
export const MIN_PASSWORD_LENGTH = 12;

export type CreateOwnerResult = { code: 0 | 1 | 2; message: string };

/** Creates the one owner record through the Local API, as a server-side call. */
export async function createOwner(
  payload: Payload,
  input: { email: string; password: string; ownerEmailsRaw: string | undefined },
): Promise<CreateOwnerResult> {
  const owners = parseOwnerEmails(input.ownerEmailsRaw);
  if (!owners.ok) return { code: 1, message: 'T2F_OWNER_EMAILS is not set or invalid' };
  const email = input.email.trim().toLowerCase();
  if (!isOwnerEmail(owners.emails, email)) return { code: 1, message: 'the email is not in T2F_OWNER_EMAILS' };
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { code: 1, message: `the password must have at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  const context = { [TRUSTED_CONTEXT_KEY]: true, t2fActor: OWNER_CREATE_ACTOR };
  const existing = await payload.count({ collection: 'admins', where: { role: { equals: 'owner' } }, overrideAccess: true, context });
  if (existing.totalDocs > 0) return { code: 2, message: 'an owner already exists' };
  await payload.create({ collection: 'admins', data: { email, password: input.password, role: 'owner' }, overrideAccess: true, context });
  return { code: 0, message: 'owner created' };
}

/** The password from stdin: without echo on a terminal, else the piped text up to the first newline. */
async function readPassword(): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk as Buffer));
    return (Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0] ?? '');
  }
  process.stderr.write('Password: ');
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      process.stderr.write('\n');
      fn();
    };
    const onData = (text: string) => {
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(value));
        if (ch === '\u0003') return done(() => reject(new Error('cancelled')));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function emailArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf('--email');
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const email = emailArg(process.argv.slice(2));
  if (!email) {
    process.stderr.write('owner:create: usage: pnpm --dir server owner:create --email <email>\n');
    return 1;
  }
  const password = await readPassword();
  const [{ getPayload }, { default: config }] = await Promise.all([import('payload'), import('../payload.config')]);
  const payload = await getPayload({ config });
  try {
    const result = await createOwner(payload, { email, password, ownerEmailsRaw: process.env.T2F_OWNER_EMAILS });
    (result.code === 0 ? process.stdout : process.stderr).write(`owner:create: ${result.message}\n`);
    return result.code;
  } finally {
    await payload.destroy();
  }
}

const isEntry = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().then(
    (code) => process.exit(code),
    () => {
      process.stderr.write('owner:create: failed\n');
      process.exit(1);
    },
  );
}
