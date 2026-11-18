/** SPEC-07 AC-23: `t2f-time/no-rule-copy` applies to server/src like on the site. */
import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('AC-23 no-rule-copy in server/src', () => {
  it('midnightMs + 15 * 60_000 gives one t2f-time/no-rule-copy error', async () => {
    const eslint = new ESLint({ cwd: path.resolve(__dirname, '../..') });
    const [result] = await eslint.lintText('export const x = midnightMs + 15 * 60_000;\n', {
      filePath: path.resolve(__dirname, '../../src/example.ts'),
    });
    expect(result!.messages.filter((m) => m.ruleId === 't2f-time/no-rule-copy')).toHaveLength(1);
  }, 60_000);
});
