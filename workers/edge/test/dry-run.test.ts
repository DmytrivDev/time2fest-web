// Dry-run bundle of every environment (AC-13, NFR-2): wrangler deploy --dry-run, bundle <= 64 KiB.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeTempConfig } from './support/tempConfig';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ENVS = ['test', 'rehearsal', 'prelaunch', 'production'] as const;
const cfg = writeTempConfig('https://origin.invalid', 'dry');
afterAll(() => cfg.cleanup());

describe('wrangler dry-run', () => {
  it.each(ENVS)('bundles %s within 64 KiB', (env) => {
    const outdir = join(cfg.dir, env);
    execFileSync(
      process.execPath,
      [WRANGLER, 'deploy', '--dry-run', '--config', cfg.configPath, '--env', env, '--outdir', outdir],
      { stdio: 'pipe', cwd: cfg.dir, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
    );
    const js = readdirSync(outdir).filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(0);
    for (const f of js) expect(statSync(join(outdir, f)).size).toBeLessThanOrEqual(65_536);
  });

  it('has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    expect('dependencies' in pkg).toBe(false);
  });

  it('README reserves build:prelaunch', () => {
    const readme = new URL('../README.md', import.meta.url);
    expect(existsSync(readme)).toBe(true);
    expect(readFileSync(readme, 'utf8')).toContain('build:prelaunch');
  });
});
