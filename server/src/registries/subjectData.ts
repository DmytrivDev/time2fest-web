/**
 * Subject-data registry (AC-57, AC-62): one row per capability that stores data about a
 * subject, sorted by `capability`. Empty in SPEC-02; domain waves add their rows.
 */
import { assertRegistry } from '../platform/registry';
import type { SubjectDataHandler } from '../platform/subjectData';

export const subjectDataRegistry: readonly SubjectDataHandler[] = [];

assertRegistry('subject-data', subjectDataRegistry, (h) => h.capability);
