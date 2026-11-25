import { describe, expect, it } from 'vitest';
import { runSubjectData, type SubjectDataHandler } from '../../src/platform/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';

function handler(capability: string, fail = false): SubjectDataHandler {
  const act = async (id: string) => {
    if (fail) throw new Error(`${capability} is down`);
    return { capability, id };
  };
  return { capability, export: act, erase: act, anonymise: act };
}

describe('subject-data registry', () => {
  it('AC-57: one failing handler → a failure naming it; the other still ran', async () => {
    const calls: string[] = [];
    const ok = handler('chat');
    const spying: SubjectDataHandler = {
      ...ok,
      export: async (id) => {
        calls.push(id);
        return ok.export(id);
      },
    };
    expect(await runSubjectData('export', 'subj-1', [spying, handler('orders', true)])).toEqual({ ok: false, failed: ['orders'], declarative: [] });
    expect(calls).toEqual(['subj-1']);
  });

  it('AC-57: every handler succeeds → all results keyed by capability', async () => {
    expect(await runSubjectData('erase', 'subj-2', [handler('chat'), handler('orders')])).toEqual({
      ok: true,
      declarative: [],
      results: { chat: { capability: 'chat', id: 'subj-2' }, orders: { capability: 'orders', id: 'subj-2' } },
    });
  });

  it('AC-57: no handlers → an empty result', async () => {
    expect(await runSubjectData('anonymise', 'subj-3', [])).toEqual({ ok: true, results: {}, declarative: [] });
    // SPEC-10 W40: the registry's only handler is `auth`, which runs only inside the auth scope
    // (`runSubjectDataInScope`; covered by `auth-subject-data.int`) — here only the declarative rows are named.
    const declarations = subjectDataRegistry.filter((r) => 'declarative' in r);
    expect(await runSubjectData('export', 'subj-3', declarations)).toEqual({
      ok: true,
      results: {},
      declarative: ['auth-codes', 'ip-day-fingerprint'],
    });
  });
});
