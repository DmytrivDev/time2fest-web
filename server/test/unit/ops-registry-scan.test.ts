/**
 * SPEC-13b W38 (AC-26): every literal alarm kind raised in `server/src` is in the ops registry.
 * The scanner parses each source file with the TypeScript compiler API (multi-line objects, any property
 * order), takes the literal `source` / `code` of `raise({ ... })` object arguments, resolves identifiers to
 * top-level string constants of the same file, and covers the poller helper `raise(level, '<code>', ...)`.
 * A kind built at run time cannot be seen: it must be allowlisted below with a reason (the AC-25 table test
 * in `ops-registry.test.ts` covers the registry rows of those kinds).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { findKind, kindOf } from '../../src/registries/ops';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

interface Found {
  file: string;
  line: number;
  source: string | null;
  code: string | null;
  /** The source text of the `source` and `code` expressions (for the allowlist key when dynamic). */
  expr: string;
}

/** Run-time kinds: `relative file :: source expr | code expr` → why the scanner cannot see them. */
const DYNAMIC_ALLOWED: Record<string, string> = {
  'moderation/spend.ts::\'mod\' | toasts ? `toasts_spend_${level}` : `spend_${level}`':
    'mod/spend_80|100, mod/toasts_spend_80|100 are built from the level; rows asserted by the AC-25 table test',
  "ops/spend.ts::'spend' | code": 'spend/<server|cloudflare>-<80|100> built from the counter key and level; AC-25 table test',
  'live/poller.ts::ALARM_SOURCE | code': 'the `raise(level, code)` helper itself; its literal call sites are scanned separately',
  'test-doors/alarm.ts::source | code': 'the test door raises whatever kind the test sends (tests prove unregistered kinds on purpose)',
};

function stringOf(node: ts.Expression | undefined, consts: Map<string, string>): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return stringOf(node.expression, consts);
  if (ts.isIdentifier(node)) return consts.get(node.text) ?? null;
  return null;
}

function propOf(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name.getText() === name) return p.initializer;
    if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) return p.name;
  }
  return undefined;
}

export function scanSource(text: string, file: string): Found[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const consts = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) {
        const v = stringOf(d.initializer, new Map());
        if (v !== null) consts.set(d.name.text, v);
      }
    }
  }
  const out: Found[] = [];
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const first = node.arguments[0];
      if (/(^|\.)raise$/.test(callee) && first && ts.isObjectLiteralExpression(first)) {
        const s = propOf(first, 'source');
        const c = propOf(first, 'code');
        if (s && c) out.push({ file, line: line(node), source: stringOf(s, consts), code: stringOf(c, consts), expr: `${s.getText(sf)} | ${c.getText(sf)}` });
      } else if (callee === 'raise' && node.arguments.length >= 2) {
        // The poller helper `raise(level, 'live/quota-80', details)` with source `ALARM_SOURCE`.
        const c = node.arguments[1];
        const code = stringOf(c, consts);
        if (code !== null) out.push({ file, line: line(node), source: consts.get('ALARM_SOURCE') ?? null, code, expr: `ALARM_SOURCE | ${c!.getText(sf)}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) && !/\.(test|spec)\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/** Failures as `file:line source/code`, plus the allowlist keys that were used. */
export function check(found: Found[]): { problems: string[]; usedAllowed: Set<string> } {
  const problems: string[] = [];
  const usedAllowed = new Set<string>();
  for (const f of found) {
    if (f.source === null || f.code === null) {
      const key = `${f.file}::${f.expr}`;
      if (key in DYNAMIC_ALLOWED) usedAllowed.add(key);
      else problems.push(`${f.file}:${f.line} dynamic kind ${f.expr} is neither literal nor allowlisted`);
      continue;
    }
    if (!findKind(f.source, f.code)) problems.push(`${f.file}:${f.line} ${kindOf({ source: f.source, code: f.code })} is not in registries/ops.ts`);
  }
  return { problems, usedAllowed };
}

describe('ops registry scanner (AC-26)', () => {
  it('every literal raised kind in server/src is in the registry; the allowlist has no stale entry', () => {
    const found = walk(srcDir).flatMap((f) => scanSource(fs.readFileSync(f, 'utf8'), path.relative(srcDir, f).split(path.sep).join('/')));
    expect(found.length).toBeGreaterThan(30);
    const { problems, usedAllowed } = check(found);
    expect(problems).toEqual([]);
    expect([...usedAllowed].sort()).toEqual(Object.keys(DYNAMIC_ALLOWED).sort());
  });

  it('a planted raise({source:"x", code:"y"}) fails with the file name and line', () => {
    const fixture = ['export function f(alarm: { raise(a: unknown): void }) {', '  alarm.raise({', "    code: 'y',", "    level: 'page',", "    source: 'x',", '  });', '}'].join('\n');
    const { problems } = check(scanSource(fixture, 'fixture.ts'));
    expect(problems).toEqual(['fixture.ts:2 x/y is not in registries/ops.ts']);
  });

  it('resolves a top-level const code and flags an unknown dynamic kind', () => {
    const fixture = "const C = 'copy-failed';\nfunction f(d: any, k: string) {\n  d.alarm.raise({ level: 'page', source: 'catalog', code: C });\n  d.alarm.raise({ level: 'page', source: 'catalog', code: k });\n}";
    const found = scanSource(fixture, 'fx.ts');
    expect(found.map((x) => [x.source, x.code])).toEqual([['catalog', 'copy-failed'], ['catalog', null]]);
    expect(check(found).problems).toEqual([
      'fx.ts:3 catalog/copy-failed is not in registries/ops.ts',
      'fx.ts:4 dynamic kind \'catalog\' | k is neither literal nor allowlisted',
    ]);
  });
});
