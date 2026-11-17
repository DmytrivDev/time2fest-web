#!/usr/bin/env node
/**
 * Additive-only check of the seam contract surface (SPEC-01, AC-38..AC-41).
 *
 *   node scripts/contract-surface.mjs [--check]            compare with the baseline (default)
 *   node scripts/contract-surface.mjs --update             refresh the baseline (additive changes only)
 *   node scripts/contract-surface.mjs --update --breaking  refresh and record the breaking changes
 *   options: --root <dir>  --baseline <file>
 *
 * Exit codes: 0 ok, 1 violation or mismatch, 2 usage or IO error.
 * Covered: every *.ts of packages/contracts/src and lib/api/contracts, plus the declarations of
 * lib/data/types.ts reachable from them. Nothing here executes the covered code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function usage(msg) {
  console.error(msg);
  console.error('Usage: contract-surface.mjs [--check | --update [--breaking]] [--root <dir>] [--baseline <file>]');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { mode: 'check', breaking: false, root: path.resolve(scriptDir, '..'), baseline: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.mode = 'check';
    else if (a === '--update') o.mode = 'update';
    else if (a === '--breaking') o.breaking = true;
    else if (a === '--root' || a === '--baseline') {
      const v = argv[++i];
      if (!v) usage(`${a} needs a value`);
      if (a === '--root') o.root = path.resolve(v);
      else o.baseline = path.resolve(v);
    } else usage(`Unknown argument: ${a}`);
  }
  if (o.breaking && o.mode !== 'update') usage('--breaking is only valid with --update');
  o.baseline ??= path.join(o.root, 'scripts', 'contract-surface.baseline.json');
  return o;
}

const posix = (p) => p.split(path.sep).join('/');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function listTs(dir, recursive) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (recursive) out.push(...listTs(full, true));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(full);
  }
  return out.sort();
}

function buildSurface(root) {
  const covered = [
    ...listTs(path.join(root, 'packages', 'contracts', 'src'), true),
    ...listTs(path.join(root, 'lib', 'api', 'contracts'), false),
  ];
  const typesFile = path.join(root, 'lib', 'data', 'types.ts');
  const program = ts.createProgram(covered, {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
    baseUrl: root,
    paths: {
      '@/*': ['./*'],
      '@time2fest/contracts': ['./packages/contracts/src/index.ts'],
    },
  });
  const checker = program.getTypeChecker();
  const rel = (f) => posix(path.relative(root, f));
  const isCoveredFile = (f) => {
    const r = rel(f);
    return r.startsWith('packages/contracts/src/') || (r.startsWith('lib/api/contracts/') && !r.slice(18).includes('/'));
  };
  const isTypesFile = (f) => rel(f) === 'lib/data/types.ts';

  const surfaces = {};
  const queue = [];

  const declKey = (decl, name) => `${rel(decl.getSourceFile().fileName)}#${name}`;

  /** Resolve an entity name to its first declaration (following import aliases). */
  function resolveDecl(nameNode) {
    let sym = checker.getSymbolAtLocation(nameNode);
    if (!sym) return null;
    if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
    const decl = sym.declarations?.[0];
    return decl ? { decl, name: sym.getName() } : null;
  }

  function refKey(typeRefNode) {
    if (typeRefNode.typeArguments?.length) return null;
    const r = resolveDecl(typeRefNode.typeName);
    if (!r) return null;
    const file = r.decl.getSourceFile().fileName;
    if (isCoveredFile(file) || isTypesFile(file)) {
      if (isTypesFile(file)) queue.push(r);
      return declKey(r.decl, r.name);
    }
    return null;
  }

  /** Enqueue every declaration of lib/data/types.ts mentioned anywhere under node. */
  function collectRefs(node) {
    const visit = (n) => {
      if (ts.isTypeReferenceNode(n)) {
        const r = resolveDecl(n.typeName);
        if (r && isTypesFile(r.decl.getSourceFile().fileName)) queue.push(r);
      } else if (ts.isExpressionWithTypeArguments(n) && ts.isIdentifier(n.expression)) {
        const r = resolveDecl(n.expression);
        if (r && isTypesFile(r.decl.getSourceFile().fileName)) queue.push(r);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
  }

  const propName = (m) => (m.name ? m.name.getText().replace(/^['"]|['"]$/g, '') : '?');

  function describeMembers(members) {
    const props = {};
    for (const m of members) {
      if (ts.isPropertySignature(m)) {
        props[propName(m)] = { optional: !!m.questionToken, type: m.type ? describeType(m.type) : { text: 'any' } };
      } else if (ts.isMethodSignature(m)) {
        props[propName(m)] = { optional: !!m.questionToken, type: { fn: norm(m.getText()) } };
      } else if (ts.isIndexSignatureDeclaration(m)) {
        props[`[${norm(m.parameters.map((p) => p.getText()).join(','))}]`] = {
          optional: false,
          type: m.type ? describeType(m.type) : { text: 'any' },
        };
      } else {
        props[`<${ts.SyntaxKind[m.kind]}:${norm(m.getText())}>`] = { optional: false, type: { text: norm(m.getText()) } };
      }
    }
    return { props };
  }

  const isSimple = (n) =>
    ts.isLiteralTypeNode(n) ||
    (n.kind >= ts.SyntaxKind.FirstKeyword && n.kind <= ts.SyntaxKind.LastKeyword) ||
    n.kind === ts.SyntaxKind.NullKeyword;

  function discriminantOf(member) {
    if (!ts.isTypeLiteralNode(member)) return null;
    for (const name of ['type', 'kind']) {
      for (const m of member.members) {
        if (ts.isPropertySignature(m) && propName(m) === name && m.type && ts.isLiteralTypeNode(m.type)) {
          return { name, value: m.type.getText() };
        }
      }
    }
    return null;
  }

  function describeType(node) {
    if (ts.isParenthesizedTypeNode(node)) return describeType(node.type);
    if (ts.isTypeLiteralNode(node)) return describeMembers(node.members);
    if (ts.isTypeReferenceNode(node)) {
      const k = refKey(node);
      return k ? { ref: k } : { text: norm(node.getText()) };
    }
    if (ts.isLiteralTypeNode(node)) return { union: [norm(node.getText())] };
    if (ts.isFunctionTypeNode(node)) return { fn: norm(node.getText()) };
    if (ts.isUnionTypeNode(node)) {
      const members = node.types;
      if (members.every(isSimple)) return { union: members.map((m) => norm(m.getText())).sort() };
      const discs = members.map(discriminantOf);
      if (members.every((m) => ts.isTypeLiteralNode(m)) && discs.every(Boolean) && new Set(discs.map((d) => d.name)).size === 1) {
        const variants = {};
        members.forEach((m, i) => {
          variants[discs[i].value] = describeMembers(m.members);
        });
        return { variants };
      }
      const items = members.map((m) => {
        if (isSimple(m)) return norm(m.getText());
        const d = describeType(m);
        return d.ref ? `ref:${d.ref}` : JSON.stringify(sortKeys(d));
      });
      return { union: items.sort() };
    }
    return { text: norm(node.getText()) };
  }

  function describeDecl(decl) {
    const params = decl.typeParameters?.length ? { params: norm(decl.typeParameters.map((p) => p.getText()).join(',')) } : {};
    if (ts.isInterfaceDeclaration(decl)) {
      const ext = (decl.heritageClauses ?? []).flatMap((h) => h.types.map((t) => norm(t.getText()))).sort();
      return { ...describeMembers(decl.members), ...(ext.length ? { extends: ext } : {}), ...params };
    }
    if (ts.isTypeAliasDeclaration(decl)) return { ...describeType(decl.type), ...params };
    if (ts.isFunctionDeclaration(decl)) {
      const end = decl.body ? decl.body.getStart() : decl.getEnd();
      return { fn: norm(decl.getText().slice(0, end - decl.getStart())) };
    }
    if (ts.isVariableDeclaration(decl)) {
      return { text: canonText(checker.typeToString(checker.getTypeAtLocation(decl), undefined, ts.TypeFormatFlags.NoTruncation)) };
    }
    return { text: norm(decl.getText()) };
  }

  function addDecl(decl, name) {
    const key = declKey(decl, name);
    if (surfaces[key]) return;
    surfaces[key] = {}; // guard against cycles
    surfaces[key] = describeDecl(decl);
    collectRefs(decl);
  }

  for (const file of covered) {
    const sf = program.getSourceFile(file);
    const modSym = sf && checker.getSymbolAtLocation(sf);
    if (!modSym) continue;
    for (let sym of checker.getExportsOfModule(modSym)) {
      if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      const decl = sym.declarations?.[0];
      if (!decl || !isCoveredFile(decl.getSourceFile().fileName)) continue;
      addDecl(decl, sym.getName());
    }
  }
  if (fs.existsSync(typesFile)) {
    while (queue.length) {
      const { decl, name } = queue.shift();
      addDecl(decl, name);
    }
  }
  return sortKeys(surfaces);
}

/** Sorts the top-level `|` members of a type string; leaves it alone when a top-level `=>` makes the split ambiguous. */
function sortUnion(str) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < str.length && str[i] !== ch; i++) if (str.charCodeAt(i) === 92) i++;
    } else if (ch === '=' && str[i + 1] === '>') {
      if (depth === 0) return str;
      i++;
    } else if ('([{<'.includes(ch)) depth++;
    else if (')]}>'.includes(ch)) depth--;
    else if (ch === '|' && depth === 0) {
      parts.push(str.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (!parts.length) return str;
  parts.push(str.slice(start).trim());
  return parts.sort().join(' | ');
}

/**
 * Canonical form of a printed type. Order-insensitive ONLY for the `;`-separated members of `{ ... }` blocks
 * (innermost first) and for top-level union members of a type / member value. Parameters, tuple elements,
 * generic arguments and overloads keep their order. The TS checker prints these in type-interning order,
 * which shifts when unrelated files are added; the member set, not its order, is the contract.
 */
function canonText(text) {
  if (typeof text !== 'string') return text;
  let i = 0;
  function block(inBrace) {
    const members = [];
    let cur = '';
    const flush = () => {
      const m = cur.trim();
      cur = '';
      if (!m) return;
      const c = m.search(/:/);
      members.push(c > 0 ? `${m.slice(0, c + 1)} ${sortUnion(m.slice(c + 1).trim())}` : m);
    };
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        cur += ch;
        for (i++; i < text.length && text[i] !== ch; i++) {
          if (text.charCodeAt(i) === 92) cur += text[i++];
          cur += text[i] ?? '';
        }
        cur += text[i++] ?? '';
      } else if (ch === '{') {
        i++;
        cur += `{ ${block(true)} }`;
      } else if (ch === '}' && inBrace) {
        i++;
        break;
      } else if (ch === ';' && inBrace) {
        flush();
        i++;
      } else {
        cur += ch;
        i++;
      }
    }
    if (!inBrace) return sortUnion(cur.trim());
    flush();
    return members.sort().map((m) => `${m};`).join(' ');
  }
  return block(false);
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  }
  return v;
}

/** Compare descriptors. Pushes { kind: 'breaking' | 'additive', line } into out. */
function compareDesc(base, cur, where, out) {
  const bk = Object.keys(base ?? {}).sort();
  const ck = Object.keys(cur ?? {}).sort();
  for (const k of new Set([...bk, ...ck])) {
    const b = base?.[k];
    const c = cur?.[k];
    const at = `${where}`;
    if (b === undefined) {
      out.push({ kind: 'breaking', line: `${at}: ${k} appeared in a different shape` });
      continue;
    }
    if (c === undefined) {
      out.push({ kind: 'breaking', line: `${at}: ${k} removed (shape changed)` });
      continue;
    }
    if (k === 'props') {
      for (const p of new Set([...Object.keys(b), ...Object.keys(c)])) {
        if (!(p in c)) out.push({ kind: 'breaking', line: `${at}.${p}: property removed` });
        else if (!(p in b)) out.push({ kind: 'additive', line: `${at}.${p}: property added` });
        else {
          if (b[p].optional && !c[p].optional) out.push({ kind: 'breaking', line: `${at}.${p}: optional became required` });
          else if (!b[p].optional && c[p].optional) out.push({ kind: 'additive', line: `${at}.${p}: required became optional` });
          compareDesc(b[p].type, c[p].type, `${at}.${p}`, out);
        }
      }
    } else if (k === 'variants') {
      for (const v of new Set([...Object.keys(b), ...Object.keys(c)])) {
        if (!(v in c)) out.push({ kind: 'breaking', line: `${at}.variant ${v}: variant removed` });
        else if (!(v in b)) out.push({ kind: 'additive', line: `${at}.variant ${v}: variant added` });
        else compareDesc(b[v], c[v], `${at}.variant ${v}`, out);
      }
    } else if (k === 'union') {
      for (const m of b) if (!c.includes(m)) out.push({ kind: 'breaking', line: `${at}: union member ${m} removed` });
      for (const m of c) if (!b.includes(m)) out.push({ kind: 'additive', line: `${at}: union member ${m} added` });
    } else if (JSON.stringify(k === 'text' ? canonText(b) : b) !== JSON.stringify(k === 'text' ? canonText(c) : c)) {
      out.push({ kind: 'breaking', line: `${at}: ${k} changed (${JSON.stringify(b)} -> ${JSON.stringify(c)})` });
    }
  }
}

function compareSurfaces(base, cur) {
  const out = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(cur)])) {
    if (!(key in cur)) out.push({ kind: 'breaking', line: `${key}: declaration removed` });
    else if (!(key in base)) out.push({ kind: 'additive', line: `${key}: declaration added` });
    else compareDesc(base[key], cur[key], key, out);
  }
  return out.sort((a, b) => a.line.localeCompare(b.line));
}

function writeBaseline(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  let cur;
  try {
    cur = buildSurface(o.root);
  } catch (e) {
    console.error(`Cannot build the contract surface: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  let baseline = { version: 1, surfaces: {}, breaking: [] };
  const hasBaseline = fs.existsSync(o.baseline);
  if (hasBaseline) {
    try {
      baseline = JSON.parse(fs.readFileSync(o.baseline, 'utf8'));
    } catch (e) {
      console.error(`Cannot read the baseline ${o.baseline}: ${e instanceof Error ? e.message : e}`);
      process.exit(2);
    }
  } else if (o.mode === 'check') {
    console.error(`Baseline not found: ${o.baseline}. Run: node scripts/contract-surface.mjs --update`);
    process.exit(2);
  }
  const changes = compareSurfaces(baseline.surfaces ?? {}, cur);
  const breaking = changes.filter((c) => c.kind === 'breaking');
  const additive = changes.filter((c) => c.kind === 'additive');

  if (o.mode === 'check') {
    if (breaking.length) {
      console.log('Breaking contract changes:');
      for (const c of breaking) console.log(`  BREAKING ${c.line}`);
      if (additive.length) for (const c of additive) console.log(`  additive ${c.line}`);
      console.log('Regenerate the baseline on purpose with: node scripts/contract-surface.mjs --update --breaking');
      process.exit(1);
    }
    if (additive.length) {
      for (const c of additive) console.log(`  additive ${c.line}`);
      console.log('Contract surface grew but the baseline is not refreshed. Run: node scripts/contract-surface.mjs --update');
      process.exit(1);
    }
    console.log('Contract surface matches the baseline.');
    process.exit(0);
  }

  if (breaking.length && !o.breaking) {
    console.log('Breaking contract changes:');
    for (const c of breaking) console.log(`  BREAKING ${c.line}`);
    console.log('Refusing to update. To record them on purpose, re-run with: node scripts/contract-surface.mjs --update --breaking');
    process.exit(1);
  }
  const record = Array.isArray(baseline.breaking) ? [...baseline.breaking] : [];
  if (breaking.length && o.breaking) {
    record.push({ recordedAt: new Date().toISOString(), changes: breaking.map((c) => c.line) });
  }
  writeBaseline(o.baseline, { version: 1, surfaces: cur, breaking: record });
  console.log(`Baseline written: ${Object.keys(cur).length} declarations${breaking.length ? `, ${breaking.length} breaking change(s) recorded` : ''}.`);
  process.exit(0);
}

main();
