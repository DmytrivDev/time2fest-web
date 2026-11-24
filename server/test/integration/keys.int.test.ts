/**
 * Agent API keys (AC-15, AC-16, NFR-5): the value is shown once, never on a read, never in the
 * server's output; a request with the key (a service token through the proxy) → 200; after a
 * revoke the very next request is refused. The journal assertion joins with the journal (W22).
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '@payloadcms/db-postgres';
import { NextRequest } from 'next/server';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IDENTITY_HEADER } from '../../src/adapters/identityMarker';
import { pgEnvOf } from '../../src/adapters/pgDump';
import { getTestSigner } from '../../src/adapters/testSigner';
import { payloadOf } from '../../src/container';
import { proxy } from '../../src/proxy';
import { testDeps } from './helpers';
import { ADMIN_HOST, apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'keys-owner@example.com';
const AGENT = 'keys-agent@example.com';
const PASSWORD = 'keys-password-00000001'; // check-secrets: allow test fake
const SERVICE_CN = String(process.env.T2F_ACCESS_SERVICE_CNS).split(',')[0] ?? '';
const DEFAULTS = { iss: new URL(String(process.env.T2F_ACCESS_TEAM_DOMAIN)).origin, aud: String(process.env.T2F_ACCESS_AUD) };

/** Captures everything the process writes and Payload logs while `fn` runs. */
async function capture(payload: Payload, fn: () => Promise<void>): Promise<string> {
  const seen: string[] = [];
  const restore: (() => void)[] = [];
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      seen.push(String(chunk));
      return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
    }) as typeof stream.write;
    restore.push(() => (stream.write = original));
  }
  const logger = payload.logger as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
    const original = logger[level];
    if (typeof original !== 'function') continue;
    logger[level] = (...args: unknown[]) => {
      seen.push(JSON.stringify(args, (_k, v: unknown) => (v instanceof Error ? `${v.name}: ${v.message}` : v)));
      return original.apply(payload.logger, args);
    };
    restore.push(() => (logger[level] = original));
  }
  try {
    await fn();
  } finally {
    for (const r of restore) r();
  }
  return seen.join('\n');
}

const COMPOSE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docker-compose.yml');

/** `pg_dump --data-only` of `admins` and `audit_log` (the stack's container), as text. Never printed. */
function dumpKeyTables(): string {
  const pg = pgEnvOf(String(process.env.DATABASE_URI));
  return execFileSync(
    'docker',
    [
      'compose', '-p', 't2f', '-f', COMPOSE_FILE, 'exec', '-T',
      '-e', 'PGPASSWORD', '-e', 'PGUSER', '-e', 'PGDATABASE', '-e', 'PGHOST=127.0.0.1', '-e', 'PGPORT=5432',
      'postgres', 'pg_dump', '--data-only', '-t', 'admins', '-t', 'audit_log',
    ],
    { env: { ...process.env, ...pg, PGHOST: '127.0.0.1', PGPORT: '5432' }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
  );
}

/** An agent request as it leaves the proxy: a service token passed the gate and got the marker. */
async function throughProxy(path: string, key: string): Promise<Record<string, string>> {
  const token = await (await getTestSigner()).sign({ kind: 'service', commonName: SERVICE_CN }, DEFAULTS);
  const res = await proxy(
    new NextRequest(`http://${ADMIN_HOST}/cms-api${path}`, {
      headers: { host: ADMIN_HOST, 'Cf-Access-Jwt-Assertion': token, ...apiKeyHeader(key) },
    }),
  );
  expect(res.headers.get('x-middleware-next')).toBe('1');
  return { ...apiKeyHeader(key), [IDENTITY_HEADER]: String(res.headers.get(`x-middleware-request-${IDENTITY_HEADER}`)) };
}

describe('agent API keys (AC-15, AC-16, NFR-5)', () => {
  let payload: Payload;
  let owner: Record<string, string>;
  let ownerId = 0;
  let agentId = 0;

  beforeAll(async () => {
    payload = await payloadOf(testDeps())();
    ownerId = await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('issue once, never read back or logged; works through the proxy; revoke refuses the next request', async () => {
    let key = '';
    const output = await capture(payload, async () => {
      const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
      expect(issued.status).toBe(200);
      expect(issued.headers.get('cache-control')).toBe('no-store');
      key = ((await issued.json()) as { key: string }).key;
      expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);

      for (const path of [`/admins/${agentId}`, '/admins', '/admins?depth=0&showHiddenFields=true']) {
        const read = await rest('GET', path, { headers: owner });
        expect(read.status).toBe(200);
        const text = await read.text();
        expect(text).not.toContain(key);
        expect(text).not.toMatch(/"apiKey"|"enableAPIKey"|"apiKeyIndex"/);
      }
      const agent = { ...apiKeyHeader(key), ...serviceMark() };
      const own = await rest('GET', `/admins/${agentId}`, { headers: agent });
      expect(own.status).toBe(403);
      expect(await own.text()).not.toContain(key);

      const before = await rest('GET', '/agent-test-posts', { headers: await throughProxy('/agent-test-posts', key) });
      expect(before.status).toBe(200);

      expect((await rest('POST', `/admins/${agentId}/revoke-key`, { headers: owner })).status).toBe(200);
      const after = await rest('GET', '/agent-test-posts', { headers: await throughProxy('/agent-test-posts', key) });
      expect(after.status).toBe(403);
    });
    expect(key).not.toBe('');
    expect(output.split(key).length - 1).toBe(0);
  });

  it('AC-20, NFR-5: issue and revoke each write one journal row by the owner, without the key value', async () => {
    const since = (
      await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })
    ).docs[0]?.id ?? 0;
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    const key = ((await issued.json()) as { key: string }).key;
    expect((await rest('POST', `/admins/${agentId}/revoke-key`, { headers: owner })).status).toBe(200);
    const rows = (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: since } }, { 'target.collection': { equals: 'admins' } }, { 'target.ref': { equals: String(agentId) } }] },
        sort: 'id',
        overrideAccess: true,
        depth: 0,
      })
    ).docs;
    expect(rows.map((r) => r.action)).toEqual(['key.issue', 'key.revoke']);
    for (const r of rows) {
      expect(r).toMatchObject({ actor: { kind: 'owner', ref: String(ownerId) }, revertible: false });
      expect(r.at).toBeTruthy();
    }
    expect(JSON.stringify(rows)).not.toContain(key);
    expect(JSON.stringify(rows)).not.toMatch(/"(apiKey|apiKeyIndex|enableAPIKey|hash|salt)"/);
  });

  it('NFR-3 (SPEC-21a): only the one-way index is stored; an unrelated update keeps the key; revoke refuses the next request', async () => {
    const db = (payload.db as unknown as { drizzle: { execute(q: unknown): Promise<{ rows: Record<string, unknown>[] }> } }).drizzle;
    const columns = async () =>
      (await db.execute(sql`SELECT "api_key", "api_key_index" FROM "admins" WHERE "id" = ${agentId}`)).rows[0] ?? {};
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    const key = ((await issued.json()) as { key: string }).key;

    const row = await columns();
    expect(row.api_key).toBeNull();
    expect(row.api_key_index).toMatch(/^[0-9a-f]{64}$/);
    const dump = dumpKeyTables();
    expect(dump.length).toBeGreaterThan(0);
    expect(dump.split(key).length - 1).toBe(0);

    const ok = async () => (await rest('GET', '/agent-test-posts', { headers: await throughProxy('/agent-test-posts', key) })).status;
    expect(await ok()).toBe(200);

    // An unrelated update of the agent record (through the API and server-side) keeps the index and the key working.
    expect((await rest('PATCH', `/admins/${agentId}`, { headers: owner, body: { email: AGENT } })).status).toBe(200);
    await payload.update({ collection: 'admins', id: agentId, data: { email: AGENT }, overrideAccess: true, depth: 0 });
    expect((await columns()).api_key_index).toBe(row.api_key_index);
    expect((await columns()).api_key).toBeNull();
    expect(await ok()).toBe(200);

    expect((await rest('POST', `/admins/${agentId}/revoke-key`, { headers: owner })).status).toBe(200);
    expect((await columns()).api_key_index ?? null).toBeNull();
    expect(await ok()).toBe(403);
  });

  it('only the owner issues, and only for agent records', async () => {
    expect((await rest('POST', `/admins/${ownerId}/issue-key`, { headers: owner })).status).toBe(400);
    expect((await rest('POST', '/admins/999999999/issue-key', { headers: owner })).status).toBe(404);
    expect((await rest('POST', `/admins/${agentId}/issue-key`, { headers: personMark() })).status).toBe(403);
  });

  it('the key fields cannot be set through the API', async () => {
    const res = await rest('PATCH', `/admins/${agentId}`, { headers: owner, body: { enableAPIKey: true, apiKey: 'chosen-by-hand-0000000000000000' } }); // check-secrets: allow test fake
    expect(res.status).toBeLessThan(500);
    const strategyHit = await rest('GET', '/agent-test-posts', { headers: { ...apiKeyHeader('chosen-by-hand-0000000000000000'), ...serviceMark() } });
    expect(strategyHit.status).toBe(403);
  });
});
