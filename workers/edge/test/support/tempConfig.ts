// Writes a test copy of wrangler.json to the OS temp dir: absolute `main`, every env's assets
// pointed at the fixture site, and `ORIGIN_URL` replaced where the env has one.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = fileURLToPath(new URL('../../', import.meta.url));
export const FIXTURE_SITE = fileURLToPath(new URL('../fixtures/site/', import.meta.url));

type EnvBlock = { assets?: Record<string, unknown>; vars?: Record<string, string> };
type RawConfig = { main: string; env: Record<string, EnvBlock> } & Record<string, unknown>;

export type TempConfig = { dir: string; configPath: string; cleanup: () => void };

/**
 * @param originUrl replaces `vars.ORIGIN_URL` in every env that declares it.
 * @param tag separates configs written by the same process (default: none).
 */
export function writeTempConfig(originUrl: string, tag = ''): TempConfig {
  const raw = JSON.parse(readFileSync(join(PACKAGE_DIR, 'wrangler.json'), 'utf8')) as RawConfig;
  raw.main = join(PACKAGE_DIR, raw.main);
  for (const env of Object.values(raw.env)) {
    if (env.assets) env.assets.directory = FIXTURE_SITE;
    if (env.vars && 'ORIGIN_URL' in env.vars) env.vars.ORIGIN_URL = originUrl;
  }
  const dir = join(tmpdir(), `t2f-edge-${process.pid}${tag ? `-${tag}` : ''}`);
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify(raw, null, 2));
  return { dir, configPath, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
