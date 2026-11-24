/**
 * SPEC-13b AC-40 (W27): two server processes (own containers, pools and lease holders) both tick the ops runner
 * every 250 ms on a substitute wall clock moved to a daily backup slot (10.02.2027 03:00:01 UTC) → exactly one copy
 * of the slot: one `backup-runs` row and one object pair, thanks to the `ops-backup` lease and the slot check.
 * The instances use the production `pg_dump` adapter (local client 17). HEAVY: run under the exclusive lock.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf } from '../../src/container';
import { spawnAlarmInstance, startTelegramFake, type AlarmInstance, type FakeTelegramHandle } from '../support/fakeTelegram';
import { testDeps } from '../integration/helpers';
import { deleteUnder, listKeys, r2Env, type R2Env } from '../integration/r2-helpers';

const TEST_BACKUP_KEY = 'dGVzdC1iYWNrdXAta2V5LW5vdC1yZWFsLTMyYnl0ZXM='; // check-secrets: allow test fake backup key
const SLOT_AT = Date.parse('2027-02-10T03:00:01Z');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('two instances, one backup per slot (AC-40, exclusive)', () => {
  let fake: FakeTelegramHandle;
  let payload: Payload;
  let env: R2Env;
  let backups: string;
  let a: AlarmInstance | undefined;
  let b: AlarmInstance | undefined;

  const runs = async () => (await payload.find({ collection: 'backup-runs', overrideAccess: true, depth: 0 })).docs;

  beforeAll(async () => {
    fake = await startTelegramFake();
    env = r2Env();
    backups = `${env.prefix}backups/db/`;
    payload = await payloadOf(testDeps({}, fake.env))();
    await deleteUnder(env, backups);
    await payload.delete({ collection: 'backup-runs', where: { id: { exists: true } }, overrideAccess: true });
    const withKey = { ...fake.env, T2F_BACKUP_KEY: TEST_BACKUP_KEY };
    [a, b] = await Promise.all([spawnAlarmInstance('bk-a', withKey), spawnAlarmInstance('bk-b', withKey)]);
  }, 240_000);

  afterAll(async () => {
    await Promise.all([a?.stop(), b?.stop()]);
    await fake?.close();
    await deleteUnder(env, backups).catch(() => undefined);
  });

  it('both runners tick through the slot → one copy', async () => {
    const offset = SLOT_AT - Date.now();
    a!.offset(offset);
    b!.offset(offset);
    const end = Date.now() + 120_000;
    while ((await runs()).length < 1 && Date.now() < end) await sleep(500);
    // Both keep ticking inside the slot: still one copy.
    await sleep(5_000);
    const rows = await runs();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ result: 'ok', kind: 'daily' });
    const keys = await listKeys(env, backups);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/20270210T03\d{4}Z\.dump\.enc$/);
  }, 300_000);
});
