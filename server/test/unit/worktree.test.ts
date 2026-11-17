import { describe, expect, it } from 'vitest';
import { isolationFor, portsFor, slotFor, slugFor } from '../../scripts/lib/worktree.mjs';

describe('worktree slot (AC-7)', () => {
  it.each([
    ['master', true, 0],
    ['spec-02-x', false, 4],
    ['spec-13a-x', false, 26],
    ['spec-13b-x', false, 27],
    ['spec-23-x', false, 46],
  ])('%s → %i', (branch, isMainCheckout, slot) => {
    expect(slotFor({ branch, isMainCheckout })).toBe(slot);
  });
});

describe('ports (AC-8)', () => {
  it('gives 48 × 6 distinct ports, the highest 4475', () => {
    const all: number[] = [];
    for (let slot = 0; slot <= 47; slot++) {
      const p = portsFor(slot);
      all.push(p.server, p.web, ...p.fakes);
    }
    expect(all).toHaveLength(48 * 6);
    expect(new Set(all).size).toBe(48 * 6);
    expect(Math.max(...all)).toBe(4475);
  });
});

describe('unknown branch (AC-9)', () => {
  it('refuses a non-spec branch without T2F_SLOT, naming the branch and T2F_SLOT', () => {
    expect(() => slotFor({ branch: 'feature-x', isMainCheckout: false })).toThrow(
      /(?=.*feature-x)(?=.*T2F_SLOT)/,
    );
  });

  it('takes T2F_SLOT=5 for a non-spec branch', () => {
    expect(slotFor({ branch: 'feature-x', isMainCheckout: false, envSlot: '5' })).toBe(5);
  });

  it('rejects an out-of-range T2F_SLOT', () => {
    expect(() => slotFor({ branch: 'feature-x', isMainCheckout: false, envSlot: '48' })).toThrow(/T2F_SLOT/);
  });
});

describe('isolation (AC-10)', () => {
  it('derives the six values for spec-02-server-skeleton', () => {
    const branch = 'spec-02-server-skeleton';
    const slug = slugFor({ branch, isMainCheckout: false });
    const slot = slotFor({ branch, isMainCheckout: false });
    const iso = isolationFor({ slug, slot });
    expect(slug).toBe('spec_02_server_skeleton');
    expect(iso.database).toBe('t2f_spec_02_server_skeleton');
    expect(iso.testDatabase).toBe('t2f_spec_02_server_skeleton_test');
    expect(iso.redisDb).toBe(4);
    expect(iso.redisPrefix).toBe('t2f:spec_02_server_skeleton:');
    expect(iso.channelPrefix).toBe('spec_02_server_skeleton_');
    expect(iso.mailAddress('alice').split('@')[0]).toContain('spec_02_server_skeleton');
  });

  it('cuts a 70-character branch to a slug of [a-z0-9_]{1,40}', () => {
    const long = ('spec-05-' + 'Very-Long/Branch.Name'.repeat(2)).padEnd(70, 'Z');
    expect(long).toHaveLength(70);
    expect(slugFor({ branch: long, isMainCheckout: false })).toMatch(/^[a-z0-9_]{1,40}$/);
  });

  it('names the main checkout slug "main"', () => {
    expect(slugFor({ branch: 'master', isMainCheckout: true })).toBe('main');
  });
});
