// @ts-check
// Спайк П-RT (infra/ops/spike): план і межа цін, видалення лише за тегами спайку, Cloudflare — рівно одне правило
// окремим запитом і рівно три ресурси на видалення, межа життя й вартості, поділ з’єднань, оцінка підсумку.
// Мережі немає: провайдер — фейк у пам’яті, Cloudflare — підставний `fetch` зі станом.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApi } from '../../../cloudflare/lib/api.mjs';
import { createFakeProvider, FAKE_SIZES } from '../../lib/capacity/fake.mjs';
import { cfDown, cfUp, checkMutation, readState, SpikeRefusal } from '../../spike/lib/cloudflare.mjs';
import { CF } from '../../spike/lib/config.mjs';
import { evaluate, mergeSummaries } from '../../spike/lib/digest.mjs';
import { buildPlan, lifetime, runGuard, splitConnections } from '../../spike/lib/plan.mjs';
import { genEnv } from '../../spike/lib/run.mjs';
import { main, parseArgs, scenarioWith } from '../../spike/spike.mjs';

const SIZES = [...FAKE_SIZES, { slug: 'c-8', vcpus: 8, memoryMb: 16384, diskGb: 100, priceHourly: 0.25 }];
const SPIKE_TAGS = ['t2f-managed', 't2f-env-spike'];

/** @type {string} */
let stateDir;
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-spike-test-'));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

/** @param {Parameters<typeof createFakeProvider>[0]} seed */
function harness(seed) {
  const fake = createFakeProvider(seed);
  /** @type {string[]} */
  const lines = [];
  const run = (/** @type {string[]} */ argv) =>
    main(argv, {
      env: {},
      out: (l) => lines.push(l),
      err: (l) => lines.push(l),
      now: () => new Date('2026-11-21T10:00:00Z'),
      sleep: async () => {},
      stateDir,
      provider: async () => fake.provider,
      fetch: /** @type {any} */ (() => {
        throw new Error('мережа в тесті');
      }),
      sshAs: () => {
        throw new Error('SSH у тесті');
      },
      runLocal: async () => {
        throw new Error('процес у тесті');
      },
    });
  return { fake, lines, run };
}

describe('plan і межа цін', () => {
  it('план за замовчуванням: c-8 + 4 × s-4vcpu-8gb (fra1, fra1, ams3, ams3), $0.536/год', () => {
    const p = buildPlan(SIZES);
    expect(p.refusals).toEqual([]);
    expect(p.rows.map((r) => `${r.size}@${r.region}`)).toEqual(['c-8@fra1', 's-4vcpu-8gb@fra1', 's-4vcpu-8gb@fra1', 's-4vcpu-8gb@ams3', 's-4vcpu-8gb@ams3']);
    expect(p.perHour).toBeCloseTo(0.25 + 4 * 0.07143, 4);
  });

  it('ціна в API понад план більш ніж на 10% — відмова; у межах 10% — ні', () => {
    const dear = SIZES.map((s) => (s.slug === 'c-8' ? { ...s, priceHourly: 0.2751 } : s));
    expect(buildPlan(dear).refusals.join(' ')).toMatch(/c-8.*понад план/);
    const ok = SIZES.map((s) => (s.slug === 'c-8' ? { ...s, priceHourly: 0.274 } : s));
    expect(buildPlan(ok).refusals).toEqual([]);
  });

  it('немає розміру в API — відмова', () => {
    expect(buildPlan(FAKE_SIZES).refusals.join(' ')).toMatch(/c-8 немає/);
  });

  it('`plan` лише читає і з дорогою ціною повертає 2', async () => {
    const h = harness({ sizes: SIZES.map((s) => (s.slug === 's-4vcpu-8gb' ? { ...s, priceHourly: 0.09 } : s)) });
    expect(await h.run(['plan'])).toBe(2);
    expect(h.fake.mutating()).toEqual([]);
    expect(h.lines.join('\n')).toMatch(/ВІДМОВА: s-4vcpu-8gb/);
  });

  it('змінні команди без --confirm spike — відмова до будь-якого виклику', async () => {
    for (const cmd of ['create', 'delete', 'cf-up', 'cf-down']) {
      const h = harness({ sizes: SIZES });
      expect(await h.run([cmd])).toBe(2);
      expect(await h.run([cmd, '--confirm', 'rehearsal'])).toBe(2);
      expect(h.fake.calls).toEqual([]);
    }
    expect(parseArgs(['run', 'S9']).ok).toBe(false);
    expect(parseArgs(['run', 'S1', '--protocol', 'http2', '--label', 'r1']).ok).toBe(true);
  });
});

describe('delete: лише вузли з обома тегами спайку', () => {
  const seed = {
    sizes: SIZES,
    nodes: [
      { name: 't2f-main', size: 's-1vcpu-2gb', tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-main'] },
      { name: 't2f-rehearsal-realtime', size: 's-2vcpu-4gb', tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-realtime'] },
      { name: 'prod-x', size: 'c-4', tags: ['t2f-managed', 't2f-env-production'] },
      { name: 'stray-spike', size: 's-1vcpu-2gb', tags: ['t2f-env-spike'] },
      { name: 't2f-spike-realtime', size: 'c-8', tags: [...SPIKE_TAGS, 't2f-role-realtime'] },
      { name: 't2f-spike-gen-1', size: 's-4vcpu-8gb', tags: [...SPIKE_TAGS, 't2f-role-loadgen'] },
      { name: 't2f-spike-gen-2', size: 's-4vcpu-8gb', tags: [...SPIKE_TAGS, 't2f-role-loadgen'] },
    ],
  };

  it('видаляє рівно три вузли спайку, решту не чіпає, кожен — з requireTags обох тегів', async () => {
    const h = harness(seed);
    expect(await h.run(['delete', '--confirm', 'spike'])).toBe(0);
    expect(h.fake.nodes.map((n) => n.name).sort()).toEqual(['prod-x', 'stray-spike', 't2f-main', 't2f-rehearsal-realtime']);
    const deletes = h.fake.calls.filter((c) => c.method === 'deleteNode');
    expect(deletes).toHaveLength(3);
    expect(h.lines.join('\n')).toMatch(/лишилося вузлів спайку 0/);
    expect(h.lines.join('\n')).toMatch(/stray-spike: тег t2f-env-spike без t2f-managed/);
    const journal = fs.readFileSync(path.join(stateDir, 'journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(journal.filter((j) => j.cmd === 'delete' && j.result === 'ok')).toHaveLength(3);
  });

  it('теги перевіряються ще раз у момент видалення: вузол без тегу спайку не видаляється, навіть якщо список брешe', async () => {
    const h = harness(seed);
    const real = h.fake.provider.listNodes;
    // Список повертає основний вузол з підробленими тегами спайку — провайдер перевіряє справжні теги.
    h.fake.provider.listNodes = async (tags) => {
      const list = await real(tags);
      const main = h.fake.nodes.find((n) => n.name === 't2f-main');
      return main && tags.includes('t2f-env-spike') ? [...list, { ...main, tags: [...SPIKE_TAGS] }] : list;
    };
    expect(await h.run(['delete', '--confirm', 'spike'])).toBe(1);
    expect(h.fake.nodes.some((n) => n.name === 't2f-main')).toBe(true);
    expect(h.lines.join('\n')).toMatch(/t2f-main.*не має тегів/);
  });
});

/**
 * Підставний Cloudflare API зі станом: тунелі, записи DNS, точка входу фази конфіг-правил.
 * @param {{ records?: any[], rules?: any[] }} [seed]
 */
function fakeCf(seed = {}) {
  const st = {
    tunnels: /** @type {any[]} */ ([]),
    records: seed.records ?? [{ id: 'rec-other', name: 'rt-rehearsal.time2fest.com', type: 'CNAME', content: 'x.cfargotunnel.com', proxied: true }],
    rules:
      seed.rules ??
      ['under-attack-test', 'under-attack-rehearsal', 'realtime-rehearsal', 'exempt'].map((d, i) => ({ id: `rule-${i}`, description: `t2f: ${d}`, expression: `(http.host eq "h${i}")`, action: 'set_config' })),
    configs: /** @type {Record<string, any>} */ ({}),
  };
  /** @type {{ method: string, path: string, body: any }[]} */
  const calls = [];
  let n = 0;
  /** @param {any} result */
  const ok = (result) => Response.json({ success: true, result, result_info: { total_pages: 1 } });
  const fetch = /** @type {typeof globalThis.fetch} */ (
    /** @type {any} */ (
      async (/** @type {string} */ url, /** @type {any} */ init) => {
        const u = new URL(String(url));
        const p = u.pathname.replace('/client/v4', '');
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(init.body) : undefined;
        calls.push({ method, path: p, body });
        /** @type {RegExpMatchArray | null} */
        let m;
        if (method === 'GET' && p === '/accounts/acc/cfd_tunnel') return ok(st.tunnels.filter((t) => t.name === u.searchParams.get('name')));
        if (method === 'POST' && p === '/accounts/acc/cfd_tunnel') {
          const t = { id: `0000000${++n}-aaaa-bbbb-cccc-dddddddddddd`, name: body.name, connections: [] };
          st.tunnels.push(t);
          return ok(t);
        }
        if ((m = p.match(/^\/accounts\/acc\/cfd_tunnel\/([^/]+)\/configurations$/))) {
          if (method === 'PUT') st.configs[m[1]] = body.config;
          return ok({ config: st.configs[m[1]] ?? null });
        }
        if ((m = p.match(/^\/accounts\/acc\/cfd_tunnel\/([^/]+)\/token$/))) return ok('tunnel-token-value-0123456789abcdef-SECRET');
        if ((m = p.match(/^\/accounts\/acc\/cfd_tunnel\/([^/]+)\/connections$/)) && method === 'DELETE') return ok(null);
        if ((m = p.match(/^\/accounts\/acc\/cfd_tunnel\/([^/]+)$/)) && method === 'DELETE') {
          st.tunnels = st.tunnels.filter((t) => t.id !== m?.[1]);
          return ok(null);
        }
        if (method === 'GET' && p === '/zones/zone/dns_records') return ok(st.records.filter((r) => r.name === u.searchParams.get('name')));
        if (method === 'POST' && p === '/zones/zone/dns_records') {
          const r = { id: `rec-${++n}`, ...body };
          st.records.push(r);
          return ok(r);
        }
        if ((m = p.match(/^\/zones\/zone\/dns_records\/([^/]+)$/)) && method === 'DELETE') {
          st.records = st.records.filter((r) => r.id !== m?.[1]);
          return ok(null);
        }
        if (method === 'GET' && p === '/zones/zone/rulesets/phases/http_config_settings/entrypoint') return ok({ id: 'rs-config', rules: st.rules });
        if (method === 'POST' && p === '/zones/zone/rulesets/rs-config/rules') {
          st.rules.push({ id: `rule-new-${++n}`, ...body });
          return ok({ id: 'rs-config', rules: st.rules });
        }
        if ((m = p.match(/^\/zones\/zone\/rulesets\/rs-config\/rules\/([^/]+)$/)) && method === 'DELETE') {
          st.rules = st.rules.filter((r) => r.id !== m?.[1]);
          return ok({ id: 'rs-config', rules: st.rules });
        }
        return Response.json({ success: false }, { status: 404 });
      }
    )
  );
  const api = createApi({ env: { CLOUDFLARE_API_TOKEN_INFRA: 'fake-cf-token-for-tests-0123456789' }, fetch }); // check-secrets: allow fake token
  return { st, calls, api, mutations: () => calls.filter((c) => c.method !== 'GET') };
}

const IDS = { account: 'acc', zone: 'zone' };

describe('cf-up / cf-down: три ресурси спайку, одне правило окремим запитом', () => {
  it('cf-up додає рівно одне правило POST-ом, ніколи не PUT переліку; токен — лише в deliverToken', async () => {
    const cf = fakeCf();
    const before = cf.st.rules.map((r) => r.id);
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const delivered = [];
    const r = await cfUp({ api: cf.api, ids: IDS, out: (l) => out.push(l), register: () => {}, deliverToken: async (t) => void delivered.push(t) });
    expect(cf.mutations().map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /accounts/acc/cfd_tunnel',
      `PUT /accounts/acc/cfd_tunnel/${r.tunnelId}/configurations`,
      'POST /zones/zone/dns_records',
      'POST /zones/zone/rulesets/rs-config/rules',
    ]);
    expect(cf.calls.some((c) => c.method === 'PUT' && c.path.includes('/rulesets/'))).toBe(false);
    const rule = cf.mutations().find((c) => c.path.endsWith('/rules'))?.body;
    expect(rule).toEqual({ description: CF.ruleDescription, expression: CF.ruleExpression, action: 'set_config', action_parameters: { security_level: 'essentially_off', bic: false }, enabled: true });
    expect(cf.st.rules.map((x) => x.id).slice(0, 4)).toEqual(before);
    expect(cf.st.rules).toHaveLength(5);
    expect(cf.st.configs[r.tunnelId].ingress).toEqual([{ hostname: CF.host, path: '^/connection/', service: 'http://centrifugo:8000' }, { service: 'http_status:404' }]);
    expect(cf.st.records.find((x) => x.name === CF.host)).toMatchObject({ type: 'CNAME', content: `${r.tunnelId}.cfargotunnel.com`, proxied: true });
    expect(delivered).toEqual(['tunnel-token-value-0123456789abcdef-SECRET']);
    expect(out.join('\n')).not.toContain('tunnel-token-value');
    expect(r.rulesBefore).toBe(4);

    // Повтор нічого не створює.
    const n = cf.mutations().length;
    await cfUp({ api: cf.api, ids: IDS, out: () => {}, register: () => {}, deliverToken: async () => {} });
    expect(cf.mutations()).toHaveLength(n);
  });

  it('cf-down видаляє рівно правило, запис і тунель; чотири наявні правила й чужі записи лишаються', async () => {
    const cf = fakeCf();
    const up = await cfUp({ api: cf.api, ids: IDS, out: () => {}, register: () => {}, deliverToken: async () => {} });
    const n = cf.mutations().length;
    let stopped = 0;
    const r = await cfDown({ api: cf.api, ids: IDS, out: () => {}, rulesBefore: 4, stopConnectors: async () => void stopped++ });
    expect(cf.mutations().slice(n).map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /zones/zone/rulesets/rs-config/rules/${up.ruleId}`,
      `DELETE /zones/zone/dns_records/${up.recordId}`,
      `DELETE /accounts/acc/cfd_tunnel/${up.tunnelId}/connections`,
      `DELETE /accounts/acc/cfd_tunnel/${up.tunnelId}`,
    ]);
    expect(stopped).toBe(1);
    expect(r.rulesAfter).toBe(4);
    expect(cf.st.rules.map((x) => x.id)).toEqual(['rule-0', 'rule-1', 'rule-2', 'rule-3']);
    expect(cf.st.records.map((x) => x.id)).toEqual(['rec-other']);
    expect(cf.st.tunnels).toEqual([]);
  });

  it('cf-down: кількість правил не збігається з тією, що була до cf-up, — помилка', async () => {
    const cf = fakeCf();
    await cfUp({ api: cf.api, ids: IDS, out: () => {}, register: () => {}, deliverToken: async () => {} });
    await expect(cfDown({ api: cf.api, ids: IDS, out: () => {}, rulesBefore: 5, stopConnectors: async () => {} })).rejects.toThrow(/до cf-up було 5/);
  });

  it('чужий запис rt-spike (не CNAME на тунель) — відмова без жодної зміни', async () => {
    const cf = fakeCf({ records: [{ id: 'rec-a', name: CF.host, type: 'A', content: '203.0.113.5', proxied: true }] });
    await expect(cfUp({ api: cf.api, ids: IDS, out: () => {}, register: () => {}, deliverToken: async () => {} })).rejects.toThrow(SpikeRefusal);
    await expect(cfDown({ api: cf.api, ids: IDS, out: () => {}, rulesBefore: null, stopConnectors: async () => {} })).rejects.toThrow(SpikeRefusal);
    expect(cf.mutations()).toEqual([]);
  });

  it('правило про rt-spike з іншим виразом чи описом — чуже, відмова', async () => {
    const rules = [{ id: 'r1', description: 'хтось інший', expression: '(http.host eq "rt-spike.time2fest.com")', action: 'set_config' }];
    const cf = fakeCf({ rules });
    await expect(readState(cf.api, IDS)).rejects.toThrow(/не збігається з правилом спайку/);
    await expect(cfDown({ api: cf.api, ids: IDS, out: () => {}, rulesBefore: null, stopConnectors: async () => {} })).rejects.toThrow(SpikeRefusal);
    expect(cf.mutations()).toEqual([]);
  });

  it('запобіжник: PUT фази, видалення чужого правила, запису чи тунелю — відмова', () => {
    const known = { tunnelId: 't-1', recordId: 'rec-1', entrypointId: 'rs-config', ruleIds: ['rule-s'] };
    const bad = [
      ['PUT', '/zones/zone/rulesets/phases/http_config_settings/entrypoint', { rules: [] }],
      ['PUT', '/zones/zone/rulesets/rs-config', { rules: [] }],
      ['DELETE', '/zones/zone/rulesets/rs-config/rules/rule-0', undefined],
      ['DELETE', '/zones/zone/dns_records/rec-other', undefined],
      ['DELETE', '/accounts/acc/cfd_tunnel/t-rehearsal', undefined],
      ['POST', '/accounts/acc/cfd_tunnel', { name: 't2f-rehearsal', config_src: 'cloudflare' }],
      ['POST', '/zones/zone/dns_records', { type: 'CNAME', name: 'time2fest.com', content: 't-1.cfargotunnel.com', proxied: true }],
      ['POST', '/zones/zone/rulesets/rs-config/rules', { description: 't2f-spike: x', expression: '(http.host eq "time2fest.com")' }],
      ['PATCH', '/zones/zone/settings/security_level', { value: 'off' }],
    ];
    for (const [method, p, body] of bad) expect(() => checkMutation(String(method), String(p), body, IDS, known), `${method} ${p}`).toThrow(SpikeRefusal);
    expect(() => checkMutation('DELETE', '/zones/zone/rulesets/rs-config/rules/rule-s', undefined, IDS, known)).not.toThrow();
    expect(() => checkMutation('DELETE', '/zones/zone/dns_records/rec-1', undefined, IDS, known)).not.toThrow();
  });
});

describe('межа життя й вартості', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  /** @param {number} hoursAgo @param {string} size */
  const node = (hoursAgo, size) => ({ id: '1', name: 'n', size, status: /** @type {const} */ ('active'), tags: SPIKE_TAGS, publicIp: '203.0.113.1', diskGb: 50, createdAt: new Date(now - hoursAgo * 3_600_000).toISOString() });

  it('свіжі вузли й короткий прогін — можна', () => {
    const lt = lifetime([node(0.5, 'c-8'), node(0.5, 's-4vcpu-8gb')], SIZES, now);
    expect(runGuard(lt, 1800)).toEqual([]);
    expect(lt.hoursLeft).toBeCloseTo(5.5, 5);
  });

  it('вузли 5.9 год + прогін 30 хв — відмова (межа 6 год)', () => {
    expect(runGuard(lifetime([node(5.9, 'c-8')], SIZES, now), 1800).join(' ')).toMatch(/понад 6 год/);
  });

  it('прогнозована вартість понад $8 — відмова', () => {
    const many = Array.from({ length: 20 }, () => node(1, 'c-8'));
    expect(runGuard(lifetime(many, SIZES, now), 3600).join(' ')).toMatch(/понад стелю \$8/);
  });

  it('вік невідомий — відмова', () => {
    const { createdAt: _, ...n } = node(1, 'c-8');
    expect(runGuard(lifetime([n], SIZES, now), 60).join(' ')).toMatch(/вік вузлів невідомий/);
  });

  it('`run` на старих вузлах відмовляє до будь-якого SSH', async () => {
    const h = harness({ sizes: SIZES, nodes: [{ name: 't2f-spike-realtime', size: 'c-8', tags: [...SPIKE_TAGS, 't2f-role-realtime'] }, { name: 't2f-spike-gen-1', size: 's-4vcpu-8gb', tags: [...SPIKE_TAGS, 't2f-role-loadgen'] }] });
    for (const n of h.fake.nodes) n.createdAt = '2026-11-21T03:30:00Z';
    expect(await h.run(['run', 'S1'])).toBe(2);
    expect(h.lines.join('\n')).toMatch(/ВІДМОВА: вузлам 6\.50 год/);
  });
});

describe('поділ з’єднань і env генераторів', () => {
  it('30 000 на 4 — по 7 500; 1 000 на 3 — 334/333/333; сума зберігається', () => {
    expect(splitConnections(30000, 4)).toEqual([7500, 7500, 7500, 7500]);
    expect(splitConnections(1000, 3)).toEqual([334, 333, 333]);
    expect(splitConnections(7, 4).reduce((a, b) => a + b, 0)).toBe(7);
    expect(() => splitConnections(10, 0)).toThrow();
  });

  it('env генератора: спільний START_AT, Origin спайку, шквал — лише в S2', () => {
    const base = { label: undefined, protocol: /** @type {const} */ ('auto'), local: false, realtime: /** @type {any} */ (null), gens: [], wsUrl: 'wss://rt-spike.time2fest.com/connection/websocket', origin: CF.origin, k6Network: 'host', runsDir: stateDir };
    const e1 = genEnv({ ...base, scenario: 'S1', sc: scenarioWith('S1', {}) }, 123, 7500, 2, 4);
    expect(e1).toMatchObject({ CONNS: 7500, START_AT: 123, GEN_INDEX: 2, GEN_COUNT: 4, ORIGIN: 'https://rt-spike.time2fest.com', RAMP: '300s', DURATION: '1200s' });
    expect(e1.STORM_AT).toBeUndefined();
    const e2 = genEnv({ ...base, scenario: 'S2', sc: scenarioWith('S2', { 'storm-window': '30s' }) }, 1, 1, 0, 1);
    expect(e2).toMatchObject({ STORM_AT: '360s', STORM_WINDOW: '30s' });
    expect(() => scenarioWith('S3', { hold: '30s' })).toThrow(/перезапуск виходить/);
  });
});

describe('оцінка за порогами плану §5', () => {
  /** @param {Record<string, any>} over */
  const summary = (over = {}) => ({
    meta: { conns: 1000, reportSec: 10 },
    metrics: {
      rt_ever_subscribed: { values: { count: 1000 } },
      rt_unexpected_disconnects_hold: { values: { count: 0 } },
      rt_delivery_latency_ms: { values: { med: 40, 'p(95)': 120, 'p(99)': 300, max: 900, count: 5000 } },
      'rt_connected{b:5}': { values: { count: 1000 } },
      'rt_connected{b:6}': { values: { count: 999 } },
      ...over,
    },
  });
  const sc = scenarioWith('S0', {});

  it('усе в межах — зелений; два генератори складаються', () => {
    const e = evaluate({ scenario: 'S0', sc, summaries: [summary(), summary()], publisher: null, collector: [], genCollectors: [], t0Ms: 0 });
    expect(e.merged.target).toBe(2000);
    expect(e.peakConnected).toBe(2000);
    expect(e.overall).toBe('green');
  });

  it('p95 1.5 с — жовтий; 1.2% обривів — червоний; генератор 90% CPU — недостовірний', () => {
    const e = evaluate({
      scenario: 'S0',
      sc,
      summaries: [summary({ rt_delivery_latency_ms: { values: { med: 40, 'p(95)': 1500, 'p(99)': 1800, max: 2000, count: 10 } }, rt_unexpected_disconnects_hold: { values: { count: 12 } } })],
      publisher: null,
      collector: [],
      genCollectors: [[{ ts: 30, cpu_pct: 90 }]],
      t0Ms: 0,
    });
    expect(e.rows.find((r) => r.key === 'latency')?.grade).toBe('yellow');
    expect(e.rows.find((r) => r.key === 'drops')?.grade).toBe('red');
    expect(e.overall).toBe('red');
    expect(e.unreliable).toBe(true);
  });

  it('підсумок частки — за passes/fails усіх генераторів', () => {
    const m = mergeSummaries([
      summary({ rt_recovered_subscriptions: { values: { passes: 99, fails: 1 } } }),
      summary({ rt_recovered_subscriptions: { values: { passes: 50, fails: 50 } } }),
    ]);
    expect(m.recoveredRate).toBeCloseTo(149 / 200, 6);
  });
});
