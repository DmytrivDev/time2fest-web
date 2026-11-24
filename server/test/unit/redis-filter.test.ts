/**
 * Фільтр копії Redis (SPEC-13b AC-49, W23): денна сіль відбитків `*edge:salt:*` не копіюється ніколи,
 * за будь-якого префікса; решта ключів проходить.
 */
import { describe, expect, it } from 'vitest';
import { redisCopyFilter } from '../../src/domain/ops/redisFilter';

describe('redisCopyFilter', () => {
  it('drops every daily salt key, whatever the prefix', () => {
    for (const key of ['edge:salt:2026-12-31', 't2f:spec_13b_ops:edge:salt:2026-12-31', 'x:edge:salt:', 'a:edge:salt:b:c']) {
      expect(redisCopyFilter(key)).toBe(false);
    }
  });

  it('keeps other keys, including near misses', () => {
    for (const key of ['t2f:rl:ip:1', 'edge:salt', 'edge:salts:2026', 'edge-salt:2026', 't2f:presence:room', 'salt:edge:x']) {
      expect(redisCopyFilter(key)).toBe(true);
    }
  });
});
