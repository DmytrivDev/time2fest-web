/**
 * Test collection of the `agentPublish` switch (AC-19). Agents may write it only in the `test`
 * class; elsewhere only the owner can. While `agentPublish` is off, an agent write whose result is
 * `published` — a new publication, or an edit of a record already published — is stored as
 * `proposal`; the switch is read fresh on every write (no cache).
 */
import type { Access, CollectionConfig } from 'payload';
import { accessFor, roleOf } from '../access/policies';
import { isAgentRole, type Operation } from '../domain/access/roles';
import { ADMIN_SETTINGS } from '../globals/adminSettings';
import { envClass } from '../platform/env';

const policy = accessFor('test');

/** The role policy, with agents further limited to the `test` class. */
const testOnly =
  (op: Operation): Access =>
  (args) =>
    (roleOf(args.req.user) === 'owner' || envClass(process.env) === 'test') && policy[op](args);

export const agentTestPosts: CollectionConfig = {
  slug: 'agent-test-posts',
  labels: { singular: 'Тестовий запис', plural: 'Тестові записи' },
  admin: { hidden: true },
  access: { read: testOnly('read'), create: testOnly('create'), update: testOnly('update'), delete: policy.delete },
  hooks: {
    beforeChange: [
      async ({ data, originalDoc, req }) => {
        if (!isAgentRole(roleOf(req.user))) return data;
        // The status the record ends up with: an update that does not send `status` keeps the stored
        // one, so an agent's edit of an already published record is a publication too (S4-06).
        const status = (data as { status?: unknown }).status ?? (originalDoc as { status?: unknown } | undefined)?.status;
        if (status !== 'published') return data;
        const settings = await req.payload.findGlobal({ slug: ADMIN_SETTINGS, req, overrideAccess: true, depth: 0 });
        return settings.agentPublish === false ? { ...data, status: 'proposal' } : data;
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      options: ['draft', 'published', 'proposal'],
      required: true,
      defaultValue: 'draft',
    },
  ],
};
