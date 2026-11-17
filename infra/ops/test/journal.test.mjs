// @ts-check
// AC-15 (поля запису розгортання й відкату, без значень секретів), основа AC-24/AC-26/AC-27 (читачі журналу).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localTransport } from '../lib/exec.mjs';
import {
  createJournal,
  currentGeneration,
  deployedShas,
  journalPath,
  JournalRefusal,
  lastOk,
  parseJournal,
  serializeRecord,
} from '../lib/journal.mjs';
import { createRedactor } from '../lib/redact.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const SHA1 = '1'.repeat(40);
const SHA2 = '2'.repeat(40);
const SHA3 = '3'.repeat(40);
/** Сторожове значення, яке ніколи не має опинитися в журналі. */
const SENTINEL = 'sentinelvaluezzqx';
const AT = '2026-11-17T10:00:00.000Z';

const AC15_FIELDS = [
  'at', 'env', 'commit', 'imageBefore', 'imageAfter', 'workerVersionBefore', 'workerVersionAfter',
  'edgeSecretGeneration', 'result', 'failedStep',
];

/**
 * @param {Partial<import('../lib/journal.mjs').OutcomeRecord>} [over]
 * @returns {import('../lib/journal.mjs').OutcomeRecord}
 */
const deploy = (over = {}) => ({
  kind: 'deploy',
  at: AT,
  env: 'rehearsal',
  commit: SHA2,
  imageBefore: `t2f-server:${SHA1}`,
  imageAfter: `t2f-server:${SHA2}`,
  workerVersionBefore: '0f6c1c1e-0000-4000-8000-000000000001',
  workerVersionAfter: '0f6c1c1e-0000-4000-8000-000000000002',
  edgeSecretGeneration: 1,
  result: 'ok',
  failedStep: null,
  ...over,
});

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-journal-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('local journal', () => {
  it('a deploy and a rollback record carry every AC-15 field', async () => {
    const j = createJournal({ transport: localTransport(), file: journalPath(dir, 'local'), env: {} });
    await j.append(deploy({ downtimeSeconds: 3 }));
    await j.append(deploy({ kind: 'rollback', commit: SHA1, result: 'rolled-back', imageAfter: `t2f-server:${SHA1}` }));
    const lines = fs.readFileSync(j.file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const rec = JSON.parse(line);
      for (const f of AC15_FIELDS) expect(Object.hasOwn(rec, f), f).toBe(true);
    }
    expect(JSON.parse(lines[0]).downtimeSeconds).toBe(3);
    const back = await j.read();
    expect(back.map((r) => r.kind)).toEqual(['deploy', 'rollback']);
  });

  it('a missing journal reads as empty', async () => {
    const j = createJournal({ transport: localTransport(), file: journalPath(dir, 'local'), env: {} });
    expect(await j.read()).toEqual([]);
  });

  it('a record holding the value of a secret env variable is refused and nothing is written', async () => {
    const j = createJournal({ transport: localTransport(), file: journalPath(dir, 'local'), env: { T2F_EDGE_SECRET: SENTINEL } });
    await expect(j.append(deploy({ result: 'failed', failedStep: SENTINEL }))).rejects.toThrow(JournalRefusal);
    await expect(j.append(deploy({ workerVersionAfter: `v-${SENTINEL}-x` }))).rejects.toThrow(JournalRefusal);
    expect(fs.existsSync(j.file)).toBe(false);
  });

  it('a value registered in the redactor (base64url form too) is refused', async () => {
    const j = createJournal({ transport: localTransport(), file: journalPath(dir, 'local'), env: {}, redactor: createRedactor([SENTINEL]) });
    const b64 = Buffer.from(SENTINEL).toString('base64url');
    await expect(j.append(deploy({ imageAfter: `t2f-server:${b64}` }))).rejects.toThrow(JournalRefusal);
    await j.append(deploy());
    const text = fs.readFileSync(j.file, 'utf8');
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(b64);
  });

  it('an unknown field (e.g. a secret name) or a missing AC-15 field is refused', () => {
    expect(() => serializeRecord({ ...deploy(), T2F_EDGE_SECRET: 'x' })).toThrow(/недозволене поле T2F_EDGE_SECRET/);
    const { failedStep: _f, ...missing } = deploy();
    expect(() => serializeRecord(missing)).toThrow(/бракує поля failedStep/);
    expect(() => serializeRecord(deploy({ env: 'staging' }))).toThrow(/поля env/);
    expect(() => serializeRecord(deploy({ imageAfter: 'a b' }))).toThrow(/поля imageAfter/);
    expect(() => serializeRecord({ kind: 'note', at: AT })).toThrow(/kind/);
  });

  it('step and edge-secret records', () => {
    expect(JSON.parse(serializeRecord({ kind: 'step', at: AT, env: 'rehearsal', commit: SHA1, step: 'migrate', status: 'ok', ms: 1200 })))
      .toMatchObject({ step: 'migrate', ms: 1200 });
    expect(JSON.parse(serializeRecord({ kind: 'edge-secret', at: AT, env: 'rehearsal', generation: 2 }))).toMatchObject({ generation: 2 });
    expect(() => serializeRecord({ kind: 'edge-secret', at: AT, env: 'rehearsal', generation: 0 })).toThrow(JournalRefusal);
  });
});

describe('remote journal', () => {
  it('appends through the transport with the fixed argv and the line on stdin', async () => {
    const fake = createFakeExec();
    const transport = fake.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/known_hosts' });
    const file = journalPath('/srv/t2f/rehearsal');
    const j = createJournal({ transport, file, env: {} });
    await j.append(deploy());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].argv).toEqual(['sh', '-c', 'cat >> "$1"', '_', '/srv/t2f/rehearsal/journal.jsonl']);
    expect(fake.calls[0].inputLength).toBe(Buffer.byteLength(`${serializeRecord(deploy())}\n`));
  });

  it('a refused record makes no remote call', async () => {
    const fake = createFakeExec();
    const transport = fake.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/known_hosts' });
    const j = createJournal({ transport, file: journalPath('/srv/t2f/rehearsal'), env: { PAYLOAD_SECRET: SENTINEL } });
    await expect(j.append(deploy({ failedStep: SENTINEL }))).rejects.toThrow(JournalRefusal);
    expect(fake.calls).toHaveLength(0);
  });

  it('a remote path with a relative part or unsafe characters is refused', () => {
    const transport = createFakeExec().sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/known_hosts' });
    for (const file of ['srv/j.jsonl', '/srv/../etc/j', '/srv/t2f/a b', '/srv/$(id)']) {
      expect(() => createJournal({ transport, file, env: {} })).toThrow(JournalRefusal);
    }
  });

  it('reads through the transport and skips a damaged line', async () => {
    const text = `${serializeRecord(deploy())}\n{broken\n${serializeRecord({ kind: 'edge-secret', at: AT, env: 'rehearsal', generation: 2 })}\n`;
    const fake = createFakeExec([{ match: ['sh', '-c'], result: { stdout: text } }]);
    const transport = fake.sshTransport({ host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/known_hosts' });
    const records = await createJournal({ transport, file: journalPath('/srv/t2f/rehearsal'), env: {} }).read();
    expect(records.map((r) => r.kind)).toEqual(['deploy', 'edge-secret']);
  });
});

describe('readers', () => {
  const records = parseJournal([
    serializeRecord(deploy({ commit: SHA1, imageAfter: `t2f-server:${SHA1}` })),
    serializeRecord(deploy({ commit: SHA2 })),
    serializeRecord(deploy({ commit: SHA3, result: 'failed', failedStep: 'health' })),
    serializeRecord(deploy({ kind: 'rollback', commit: SHA1, result: 'rolled-back' })),
    serializeRecord(deploy({ commit: SHA1 })),
    serializeRecord(deploy({ env: 'production', commit: SHA3 })),
    serializeRecord({ kind: 'edge-secret', at: AT, env: 'rehearsal', generation: 3 }),
    serializeRecord({ kind: 'edge-secret', at: AT, env: 'rehearsal', generation: 2 }),
  ].join('\n'));

  it('lastOk is the latest successful deploy of that env; failed deploys and rollbacks never count', () => {
    expect(lastOk(records, 'rehearsal')?.commit).toBe(SHA1);
    expect(lastOk(records.slice(0, 4), 'rehearsal')?.commit).toBe(SHA2);
    expect(lastOk(records, 'production')?.commit).toBe(SHA3);
    expect(lastOk(records, 'prelaunch')).toBeUndefined();
    expect(lastOk([], 'rehearsal')).toBeUndefined();
  });

  it('currentGeneration is the max edge-secret generation, default 1', () => {
    expect(currentGeneration(records, 'rehearsal')).toBe(3);
    expect(currentGeneration(records, 'production')).toBe(1);
    expect(currentGeneration([], 'rehearsal')).toBe(1);
  });

  it('deployedShas lists successful deploys most recent first, without repeats', () => {
    expect(deployedShas(records, 'rehearsal')).toEqual([SHA1, SHA2]);
    expect(deployedShas(records, 'production')).toEqual([SHA3]);
  });
});
