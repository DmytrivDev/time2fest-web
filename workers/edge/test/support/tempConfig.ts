// Writes a test copy of wrangler.json to the OS temp dir: absolute `main`, every env's assets
// pointed at the fixture site, and `ORIGIN_URL` replaced where the env has one. Per-env `r2_buckets`
// (not inherited by wrangler) are copied as they are; a test may add a local `SITE_BUCKET` to one env.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_SITE = fileURLToPath(new URL('../fixtures/site/', import.meta.url));

type R2Binding = { binding: string; bucket_name: string };
type EnvBlock = { assets?: Record<string, unknown>; vars?: Record<string, string>; r2_buckets?: R2Binding[] };
type RawConfig = { main: string; env: Record<string, EnvBlock> } & Record<string, unknown>;

export type TempConfig = { dir: string; configPath: string; cleanup: () => void };

/** A local `SITE_BUCKET` (+ `R2_PREFIX`) added to one env of the copy; the harness backs it with local R2. */
export type SiteBucketOption = { env: string; prefix: string };

/**
 * @param originUrl replaces `vars.ORIGIN_URL` in every env that declares it.
 * @param tag separates configs written by the same process (default: none).
 * @param siteBucket adds (or replaces) the `SITE_BUCKET` binding and `R2_PREFIX` of that env.
 */
export function writeTempConfig(originUrl: string, tag = '', siteBucket?: SiteBucketOption): TempConfig {
  const raw = JSON.parse(readFileSync(join(PACKAGE_DIR, 'wrangler.json'), 'utf8')) as RawConfig;
  raw.main = join(PACKAGE_DIR, raw.main);
  for (const env of Object.values(raw.env)) {
    if (env.assets) env.assets.directory = FIXTURE_SITE;
    if (env.vars && 'ORIGIN_URL' in env.vars) env.vars.ORIGIN_URL = originUrl;
  }
  if (siteBucket) {
    const env = raw.env[siteBucket.env];
    if (!env) throw new Error(`no env ${siteBucket.env} in wrangler.json`);
    const others = (env.r2_buckets ?? []).filter((b) => b.binding !== 'SITE_BUCKET');
    env.r2_buckets = [...others, { binding: 'SITE_BUCKET', bucket_name: `t2f-edge-test-${siteBucket.env}` }];
    env.vars = { ...env.vars, R2_PREFIX: siteBucket.prefix };
  }
  const dir = join(tmpdir(), `t2f-edge-${process.pid}${tag ? `-${tag}` : ''}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(raw, null, 2));
  return { dir, configPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
