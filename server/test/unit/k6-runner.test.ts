import { describe, expect, it } from 'vitest';
import { buildDockerArgs, K6_IMAGE, k6Env, parseArgs, prefixChannel, toSeconds } from '../../scripts/k6.mjs';

const BASE = ['--scenario', 'publish', '--vus', '50', '--ramp', '10s', '--duration', '60s', '--token', 'door:0.1', '--channels', 'site:state,rttest:batch,toasts'];

describe('k6 runner (AC-63)', () => {
  it('parses the arguments with defaults', () => {
    const a = parseArgs(BASE);
    expect(a).toMatchObject({ scenario: 'publish', vus: 50, ramp: '10s', duration: '60s', token: 'door:0.1', rate: '60/min', origin: '' });
    expect(a.channels).toEqual(['site:state', 'rttest:batch', 'toasts']);
    expect(parseArgs(['--scenario', 'steady', '--channels', 'a:b']).token).toBe('anon');
  });

  it.each([
    [['--scenario', 'nope', '--channels', 'a:b']],
    [['--scenario', 'steady']],
    [['--scenario', 'steady', '--channels', 'a:b', '--vus', '0']],
    [['--scenario', 'steady', '--channels', 'a:b', '--token', 'door:2']],
    [['--scenario', 'steady', '--channels', 'a:b', '--vus']],
  ])('rejects bad arguments %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });

  it('prefixes channels by the AC-10 rule', () => {
    expect(prefixChannel('site:state', 'spec_06_')).toBe('site:spec_06_state');
    expect(prefixChannel('chat:world', 'spec_06_')).toBe('chat:spec_06_world');
    expect(prefixChannel('toasts', 'spec_06_')).toBe('spec_06_toasts');
    expect(prefixChannel('site:state', '')).toBe('site:state');
  });

  it('parses durations', () => {
    expect([toSeconds('90s'), toSeconds('2m'), toSeconds('500ms'), toSeconds('30')]).toEqual([90, 120, 0.5, 30]);
  });

  it('builds the docker argv with the pinned image and the env file, never the API key', () => {
    const key = 'k'.repeat(40);
    const a = parseArgs(BASE);
    const env = k6Env(a, 'spec_06_', { network: 't2f_default', wsUrl: 'ws://centrifugo:8000/connection/websocket', apiUrl: 'http://centrifugo:8000', tokensFile: '/data/tokens.json' });
    const argv = buildDockerArgs({ scenario: 'publish', loadDir: '/w/load/realtime', dataDir: '/tmp/x', envFile: '/tmp/x/k6.env', network: 't2f_default' });
    expect(argv.slice(0, 3)).toEqual(['run', '--rm', '--network']);
    expect(argv).toContain(K6_IMAGE);
    expect(K6_IMAGE).toBe('grafana/k6:2.4.0');
    expect(argv).toEqual(expect.arrayContaining(['--env-file', '/tmp/x/k6.env', '/scripts/publish.js']));
    expect(argv.join(' ')).not.toContain(key);
    expect(Object.keys(env)).not.toContain('API_KEY');
    expect(env.CHANNELS).toBe('site:spec_06_state,rttest:spec_06_batch,spec_06_toasts');
    expect(env.TOKENS_FILE).toBe('/data/tokens.json');
    expect(env).toMatchObject({ VUS: '50', RAMP: '10s', DURATION: '60s', TOKEN_SOURCE: 'door:0.1', PUBLISH_RATE: '60/min' });
  });

  it('omits the network and the data mount for a remote anonymous run', () => {
    const argv = buildDockerArgs({ scenario: 'storm', loadDir: '/l', dataDir: undefined, envFile: '/e', network: undefined });
    expect(argv).not.toContain('--network');
    expect(argv.filter((x) => x === '-v')).toHaveLength(1);
  });
});
