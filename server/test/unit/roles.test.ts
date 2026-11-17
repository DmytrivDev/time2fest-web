/** Role policy table and the single-owner rule (AC-14, AC-18). */
import { describe, expect, it } from 'vitest';
import { can, isAgentRole, isRole, ownerChangeRefused, ROLES, type CollectionGroup, type Operation } from '../../src/domain/access/roles';

const GROUPS: CollectionGroup[] = ['catalog', 'corrections', 'audit', 'keys', 'unattended', 'alarms', 'settings', 'test'];
const OPS: Operation[] = ['read', 'create', 'update', 'delete'];

describe('roles', () => {
  it('knows exactly three roles', () => {
    expect([...ROLES]).toEqual(['owner', 'content-agent', 'stream-agent']);
    expect(isRole('admin')).toBe(false);
    expect(isRole('Owner')).toBe(false);
    expect(isAgentRole('content-agent')).toBe(true);
    expect(isAgentRole('owner')).toBe(false);
  });

  it('the owner may do everything', () => {
    for (const g of GROUPS) for (const op of OPS) expect(can('owner', g, op)).toBe(true);
  });

  it('agents may only read the catalog (plus the test collection), nothing else', () => {
    for (const role of ['content-agent', 'stream-agent'] as const) {
      for (const g of GROUPS) {
        for (const op of OPS) {
          const allowed = (g === 'catalog' && op === 'read') || (g === 'test' && op !== 'delete');
          expect(can(role, g, op), `${role} ${g} ${op}`).toBe(allowed);
        }
      }
    }
  });

  it('no role, or an unknown role, may do nothing', () => {
    for (const role of [undefined, null, '', 'admin', 42]) {
      for (const g of GROUPS) for (const op of OPS) expect(can(role, g, op)).toBe(false);
    }
  });

  it('a write may not create an owner or turn a record into one', () => {
    expect(ownerChangeRefused({ operation: 'create', nextRole: 'owner', previousRole: undefined })).toBe(true);
    expect(ownerChangeRefused({ operation: 'update', nextRole: 'owner', previousRole: 'content-agent' })).toBe(true);
    expect(ownerChangeRefused({ operation: 'update', nextRole: 'owner', previousRole: 'owner' })).toBe(false);
    expect(ownerChangeRefused({ operation: 'create', nextRole: 'stream-agent', previousRole: undefined })).toBe(false);
    expect(ownerChangeRefused({ operation: 'update', nextRole: 'content-agent', previousRole: 'stream-agent' })).toBe(false);
  });
});
