/**
 * SPEC-05 static privacy checks over the sources: no address, salt or fingerprint is a stored
 * field (AC-19), and the fingerprint is reached from a short list of files only (AC-30).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..', 'src');
const PRIVATE_WORDS = new Set(['ip', 'address', 'salt', 'fingerprint']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });
}
const rel = (f: string) => relative(SRC, f).split(sep).join('/');

/** `clientIp`, `ip_address`, `Fingerprint` → whole words, so `description` is not an `ip` field. */
function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.toLowerCase());
}

describe('edge privacy, static (SPEC-05)', () => {
  it('AC-19: no collection declares a field named ip, address, salt or fingerprint', () => {
    const offenders: string[] = [];
    for (const f of files(join(SRC, 'collections'))) {
      readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const named = /\bname\s*:\s*['"`]([^'"`]*)['"`]/.exec(line)?.[1];
        if (named !== undefined && words(named).some((w) => PRIVATE_WORDS.has(w))) offenders.push(`${rel(f)}:${i + 1} ${named}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('AC-30: fingerprintOf, daySalts and ipDay() are called only from the allowed files; the echo door never reads ipDay', () => {
    // SPEC-10 adds two readers of the daily fingerprint (never the raw IP): `auth/codeFlow.ts` keys the code limits on
    // it (AC-9), `auth/request.ts` turns it into the hashed `x-t2f-ip` Better Auth limits on (AC-32).
    const allowed = new Set([
      'platform/edge.ts',
      'platform/fingerprint.ts',
      'container.ts',
      'registries/middleware.ts',
      'test-doors/edgeEcho.ts',
      'auth/codeFlow.ts',
      'auth/request.ts',
      // SPEC-11 W31: the email-change code limits key on the daily fingerprint, like `auth/codeFlow.ts`.
      'auth/link.ts',
      // SPEC-11 W34: the `rights/ban {kind:'ip-day', subject:'current'}` door marks the caller's daily fingerprint.
      'test-doors/rights.ts',
    ]);
    const calls = /\b(fingerprintOf|daySalts)\(|\.ipDay\(/;
    const found = files(SRC).filter((f) => calls.test(readFileSync(f, 'utf8'))).map(rel);
    expect(found.filter((f) => !allowed.has(f))).toEqual([]);
    expect(readFileSync(join(SRC, 'test-doors', 'edgeEcho.ts'), 'utf8')).not.toMatch(/ipDay/);
  });
});
