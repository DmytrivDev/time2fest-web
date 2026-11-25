/**
 * SPEC-10 review A10-03: the one auth scope (`auth/scope.ts`) — hooks act only inside `runInAuthScope`, a code
 * request keeps the enclosing scope, subject-data deps are reachable only inside `runInSubjectDataScope`.
 */
import { describe, expect, it } from 'vitest';
import { codeRequestState, inAuthScope, requireSubjectDataDeps, runCodeRequest, runInAuthScope, runInSubjectDataScope } from '../../src/auth/scope';
import type { Deps } from '../../src/endpoints/types';

describe('auth scope', () => {
  it('outside any scope: no hooks, no code state, subject data throws', () => {
    expect(inAuthScope()).toBe(false);
    expect(codeRequestState()).toBeUndefined();
    expect(() => requireSubjectDataDeps()).toThrow(/outside runInAuthScope/);
  });

  it('a code request inside a request scope keeps it active and carries its own state', async () => {
    const state = {};
    await runInAuthScope(async () => {
      await runCodeRequest(state, async () => {
        expect(inAuthScope()).toBe(true);
        expect(codeRequestState()).toBe(state);
      });
      expect(codeRequestState()).toBeUndefined();
    });
    await runCodeRequest(state, async () => {
      expect(inAuthScope()).toBe(false);
      expect(codeRequestState()).toBe(state);
    });
  });

  it('subject-data deps only inside runInSubjectDataScope', async () => {
    const deps = {} as Deps;
    await runInSubjectDataScope(deps, async () => {
      expect(inAuthScope()).toBe(true);
      expect(requireSubjectDataDeps()).toBe(deps);
    });
  });
});
