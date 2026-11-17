// @ts-check
/**
 * Secret check (SPEC-02 W25). Scans tracked and staged files for secret-shaped strings.
 * Prints `file:line pattern-name` only, never the match. Exit 1 on a hit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.env.T2F_CHECK_ROOT ? path.resolve(process.env.T2F_CHECK_ROOT) : root;

/**
 * Known test fakes carry an inline marker on the SAME line as the hit: a trailing comment
 * `check-secrets: allow <reason>` (`//` in TS, `#` in Python). The marker counts only under test paths.
 * Keep small; never weaken a pattern instead.
 */
const ALLOW_MARKER = /check-secrets: allow \S/;
const TEST_PATH = /(^|\/)(test|tests)\/|^scripts\/tests\//;

const SKIP_PATH = /(^|\/)(pnpm-lock\.yaml|data\/|docs\/)|\.(png|jpe?g|webp|woff2)$/;
// This file and its test fixtures hold the patterns themselves.
const SELF = /^scripts\/check-secrets\.mjs$/;

const PATTERNS = [
  ['aws-access-key', /AKIA[0-9A-Z]{16}/],
  ['google-api-key', /AIza[0-9A-Za-z_-]{35}/],
  // The plan's pattern, narrowed to look like a credential: a credential-named identifier, then a quoted
  // value of 16+ chars (plan: 8+; narrowed after 100+ UI-label false positives) with only base64/hex-like characters (no spaces, colons or dots) that mixes a letter and a digit (UI labels and i18n keys do not).
  ['generic-secret', /(secret|key|token|password)\s*[:=]\s*['"](?=[A-Za-z0-9+/_=-]{16,}['"])(?=[^'"]*\d[^'"]*\d)(?=[^'"]*[A-Za-z])/i],
  ['private-key', /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{36,}/],
  ['npm-token', /npm_[A-Za-z0-9]{36}/],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['postgres-url-credentials', /postgres(ql)?:\/\/[^:@\s]+:[^@\s]+@/],
];

const files = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean);

let hits = 0;
for (const f of files) {
  if (SKIP_PATH.test(f) || SELF.test(f)) continue;
  if (/(^|\/)\.env(\..*)?$/.test(f) && !/(^|\/)\.env\.example$/.test(f)) {
    console.log(`${f}:0 tracked-env-file`);
    hits += 1;
    continue;
  }
  let text;
  try {
    text = fs.readFileSync(path.join(cwd, f), 'utf8');
  } catch {
    continue; // deleted in the worktree, or unreadable
  }
  if (text.includes('\0')) continue;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    for (const [name, re] of PATTERNS) {
      if (!re.test(lines[i] ?? '')) continue;
      if (TEST_PATH.test(f) && ALLOW_MARKER.test(lines[i] ?? '')) continue;
      console.log(`${f}:${i + 1} ${name}`);
      hits += 1;
    }
  }
}
if (hits > 0) {
  console.error(`check-secrets: ${hits} hit(s)`);
  process.exit(1);
}
console.log('check-secrets: clean');
