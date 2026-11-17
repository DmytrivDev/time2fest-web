import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CentrifugoChannelOptions, CentrifugoConfig } from '../../src/domain/realtime/centrifugoConfig';
import { configFileName, REALTIME_CLASSES, REALTIME_CONFIG_DIR, runRealtimeConfig, type CliIo } from '../../src/cli/realtimeConfig';
import type { EnvClass } from '../../src/platform/env';
import { channelClassesFor } from '../../src/registries/channels';

/** The three generated files, parsed as stored in the repository. */
const stored = Object.fromEntries(
  REALTIME_CLASSES.map((cls) => [cls, JSON.parse(fs.readFileSync(path.join(REALTIME_CONFIG_DIR, configFileName(cls)), 'utf8')) as CentrifugoConfig]),
) as Record<EnvClass, CentrifugoConfig>;

/** Every channel-options block of a configuration: each namespace by name, plus `without_namespace`. */
function blocks(config: CentrifugoConfig): [string, CentrifugoChannelOptions][] {
  const list: [string, CentrifugoChannelOptions][] = config.channel.namespaces.map((ns) => [ns.name, ns]);
  if (config.channel.without_namespace !== undefined) list.push(['<without_namespace>', config.channel.without_namespace]);
  return list;
}

/** Every key at any depth of `node`. */
function allKeys(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(allKeys);
  if (node !== null && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => [k, ...allKeys(v)]);
  return [];
}

const seconds = (duration: string | undefined): number => {
  const match = /^(\d+)s$/.exec(duration ?? '');
  if (match?.[1] === undefined) throw new Error(`not a seconds duration: ${String(duration)}`);
  return Number(match[1]);
};

const silent = (): CliIo & { errors: string[] } => {
  const errors: string[] = [];
  return { errors, out: () => undefined, err: (line) => errors.push(line) };
};

describe('generated Centrifugo configuration (SPEC-06)', () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AC-2: --check is 0 on a copy of the stored files and 1 after one field of the copy changes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-config-'));
    tmpDirs.push(dir);
    for (const cls of REALTIME_CLASSES) {
      fs.copyFileSync(path.join(REALTIME_CONFIG_DIR, configFileName(cls)), path.join(dir, configFileName(cls)));
    }
    const clean = silent();
    expect(runRealtimeConfig(['--check', '--dir', dir], clean)).toBe(0);
    expect(clean.errors).toEqual([]);

    const file = path.join(dir, configFileName('production'));
    const edited = JSON.parse(fs.readFileSync(file, 'utf8')) as CentrifugoConfig;
    edited.client.ping_interval = '30s';
    fs.writeFileSync(file, `${JSON.stringify(edited, null, 2)}\n`);
    const dirty = silent();
    expect(runRealtimeConfig(['--check', '--dir', dir], dirty)).toBe(1);
    expect(dirty.errors).toHaveLength(1);
    expect(dirty.errors[0]).toContain(configFileName('production'));
    expect(dirty.errors[0]).toContain('$.client.ping_interval');
  });

  it('AC-3: no namespace and no channel without one enables publish, history or presence for clients', () => {
    const forbidden = /^allow_(publish|history|presence)_for_/;
    for (const cls of REALTIME_CLASSES) {
      expect(allKeys(stored[cls]).filter((k) => forbidden.test(k)), cls).toEqual([]);
    }
  });

  it('AC-4: rehearsal and production hold no rttest namespace; test does', () => {
    expect(stored.test.channel.namespaces.map((ns) => ns.name)).toContain('rttest');
    for (const cls of ['rehearsal', 'production'] as const) {
      expect(stored[cls].channel.namespaces.map((ns) => ns.name), cls).not.toContain('rttest');
    }
  });

  it('AC-5: client.ping_interval is 25s in all three classes', () => {
    for (const cls of REALTIME_CLASSES) expect(stored[cls].client.ping_interval, cls).toBe('25s');
  });

  it('AC-6: client.allowed_origins is exactly the site origin of the class, loopback in test', () => {
    expect(stored.test.client.allowed_origins).toEqual(['http://127.0.0.1:*', 'http://localhost:*']);
    expect(stored.rehearsal.client.allowed_origins).toEqual(['https://rehearsal.time2fest.com']);
    expect(stored.production.client.allowed_origins).toEqual(['https://time2fest.com']);
  });

  it('AC-7: anonymous connect without a token, empty-sub tokens refused, anonymous subscribe only on public classes', () => {
    for (const cls of REALTIME_CLASSES) {
      expect(stored[cls].client.allow_anonymous_connect_without_token, cls).toBe(true);
      expect(stored[cls].client.disallow_anonymous_connection_tokens, cls).toBe(true);

      const rows = channelClassesFor(cls);
      const publicNamespaces = new Set(rows.filter((r) => r.visibility === 'public').map((r) => r.namespace ?? '<without_namespace>'));
      const personalNamespaces = new Set(rows.filter((r) => r.visibility === 'personal').map((r) => r.namespace ?? '<without_namespace>'));
      expect(personalNamespaces.size, cls).toBeGreaterThan(0);
      for (const [name, options] of blocks(stored[cls])) {
        if (publicNamespaces.has(name)) {
          expect(options.allow_subscribe_for_anonymous, `${cls} ${name}`).toBe(true);
        } else {
          expect(personalNamespaces.has(name), `${cls} ${name} is a registry class`).toBe(true);
          expect(options.allow_subscribe_for_anonymous, `${cls} ${name}`).toBeUndefined();
          expect(options.allow_user_limited_channels, `${cls} ${name}`).toBe(true);
        }
      }
    }
  });

  it('AC-8: personal classes keep history ≤600 s and history_meta_ttl ≤3 600 s', () => {
    for (const cls of REALTIME_CLASSES) {
      const personal = new Set(channelClassesFor(cls).filter((r) => r.visibility === 'personal').map((r) => r.namespace));
      const namespaces = stored[cls].channel.namespaces.filter((ns) => personal.has(ns.name));
      expect(namespaces.map((ns) => ns.name).sort(), cls).toEqual(['notif', 'orders', 'user']);
      for (const ns of namespaces) {
        expect(seconds(ns.history_ttl), `${cls} ${ns.name}`).toBeLessThanOrEqual(600);
        expect(seconds(ns.history_meta_ttl), `${cls} ${ns.name}`).toBeLessThanOrEqual(3600);
      }
    }
  });
});
