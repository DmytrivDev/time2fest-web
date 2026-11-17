import { EventEmitter } from 'node:events';
import type { Payload } from 'payload';
import { describe, expect, it } from 'vitest';
import { guardPool } from '../../src/container';
import type { AlarmInput } from '../../src/ports';

describe('guardPool (AC-72: a lost pooled connection must not kill the process)', () => {
  it('an idle-client error (57P01) is absorbed and raised as a log alarm with the code only', () => {
    const pool = new EventEmitter();
    const raised: AlarmInput[] = [];
    guardPool({ db: { pool } } as unknown as Payload, { raise: (a) => raised.push(a) });

    const err = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    expect(() => pool.emit('error', err)).not.toThrow();
    expect(raised).toEqual([{ level: 'log', source: 'postgres', code: 'pool_client_error', details: { pgCode: '57P01' } }]);
  });

  it('an adapter without a pool is left alone', () => {
    expect(() => guardPool({ db: {} } as unknown as Payload, { raise: () => undefined })).not.toThrow();
  });
});
