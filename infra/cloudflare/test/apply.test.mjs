// @ts-check
// apply на фальшивому API: порядок, ідемпотентність (AC-39), рядок журналу (AC-43), файл токена без друку (AC-42),
// зупинка на першій відмові з переліком застосованого (AC-44), перемикач «під атакою» (AC-51).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { PHASE_CONFIG, PHASE_CUSTOM } from '../lib/config.mjs';
import { convergedSeed, createFakeApi } from './support/fakeApi.mjs';

// Фальшиві секрети збираються під час виконання.
const tok = `tok-${'f6'.repeat(8)}`;
const edgeSecret = `es-${'a7'.repeat(8)}`;
const tunnelTok = `tt-${'b8'.repeat(8)}`;

/** @type {string} */
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cf-apply-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const localDir = () => path.join(tmp, '.local');
const tokenFile = () => path.join(localDir(), 'tunnel-test.env');

/**
 * @param {{ fetch: typeof globalThis.fetch }} fake
 * @param {string[]} argv
 */
async function run(fake, argv) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, {
    env: {
      CLOUDFLARE_API_TOKEN_INFRA: tok,
      CLOUDFLARE_ACCOUNT_ID: 'acct-test',
      CLOUDFLARE_ZONE_ID: 'zone-test',
      T2F_EDGE_SECRET: edgeSecret,
      T2F_LOCK_DIR: path.join(tmp, 'locks'),
    },
    fetch: fake.fetch,
    out: (l) => lines.push(l),
    now: () => new Date(2026, 10, 17, 12, 0, 0),
    localDir: localDir(),
  });
  return { code, lines, text: lines.join('\n') };
}

/** Фальшивий Cloudflare, що вже відповідає бажаному стану (усі середовища: cf.mjs завжди будує їх разом). */
function converged() {
  const fake = createFakeApi();
  fake.seed(convergedSeed(fake, tunnelTok));
  return fake;
}

const JOURNAL = /^- \d{4}-\d{2}-\d{2} — infra\/cloudflare apply \(test\): .+$/;

describe('apply', () => {
  it('порожній Cloudflare: зміни по порядку, рядок журналу, файл токена без друку токена', async () => {
    const fake = createFakeApi();
    const r = await run(fake, ['apply', '--env', 'test']);
    expect(r.code).toBe(0);

    // cf.mjs будує всі середовища разом (W28, AC-28): тунелі test і rehearsal, три CNAME (o-test, o-rehearsal,
    // rt-rehearsal; адмінки без --with-access немає — F2), два PUT фаз.
    const tunnelId = fake.state.tunnels[0]?.id;
    const rehearsalId = fake.state.tunnels.find((t) => t.name === 't2f-rehearsal')?.id;
    expect(fake.mutations()).toEqual([
      { method: 'POST', path: '/accounts/acct-test/cfd_tunnel' },
      { method: 'PUT', path: `/accounts/acct-test/cfd_tunnel/${tunnelId}/configurations` },
      { method: 'POST', path: '/accounts/acct-test/cfd_tunnel' },
      { method: 'PUT', path: `/accounts/acct-test/cfd_tunnel/${rehearsalId}/configurations` },
      { method: 'POST', path: '/zones/zone-test/dns_records' },
      { method: 'POST', path: '/zones/zone-test/dns_records' },
      { method: 'POST', path: '/zones/zone-test/dns_records' },
      { method: 'PUT', path: `/zones/zone-test/rulesets/phases/${PHASE_CUSTOM}/entrypoint` },
      { method: 'PUT', path: `/zones/zone-test/rulesets/phases/${PHASE_CONFIG}/entrypoint` },
    ]);
    expect(fake.state.dns.find((x) => x.name === 'o-test.time2fest.com')).toEqual(
      expect.objectContaining({ type: 'CNAME', content: `${tunnelId}.cfargotunnel.com`, proxied: true }),
    );
    expect(fake.state.dns.some((x) => x.name === 'admin-rehearsal.time2fest.com')).toBe(false);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    // пошта не зачеплена
    expect(fake.state.dns.find((x) => x.type === 'MX')).toEqual(expect.objectContaining({ name: 'time2fest.com', content: 'mx.example.net' }));

    const journal = r.lines.filter((l) => JOURNAL.test(l));
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatch(/^- 2026-11-17 — /);
    expect(journal[0]).toContain('t2f-skip-exempt');

    const token = String(fake.state.tunnels[0]?.token);
    expect(fs.readFileSync(tokenFile(), 'utf8')).toBe(`TUNNEL_TOKEN=${token}\n`);
    if (process.platform !== 'win32') expect(fs.statSync(tokenFile()).mode & 0o777).toBe(0o600);
    for (const s of [token, tok, edgeSecret]) expect(r.text).not.toContain(s);
  });

  it('другий apply: «без змін» і жодного запиту на зміну (AC-39)', async () => {
    const fake = createFakeApi();
    expect((await run(fake, ['apply', '--env', 'test'])).code).toBe(0);
    const before = fake.mutations().length;
    const second = await run(fake, ['apply', '--env', 'test']);
    expect(second.code).toBe(0);
    expect(second.text).toBe('без змін');
    expect(fake.mutations().length).toBe(before);
  });

  it('файл токена вже є: не перезаписується й токен не запитується', async () => {
    const fake = converged();
    fs.mkdirSync(localDir(), { recursive: true });
    fs.writeFileSync(tokenFile(), 'TUNNEL_TOKEN=keep\n');
    const r = await run(fake, ['apply', '--env', 'test']);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(tokenFile(), 'utf8')).toBe('TUNNEL_TOKEN=keep\n');
    expect(fake.log.some((l) => l.path.endsWith('/token'))).toBe(false);
  });

  it('збіжний стан без файлу токена: токен записано, не надруковано', async () => {
    const fake = converged();
    const r = await run(fake, ['apply', '--env', 'test']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(fs.readFileSync(tokenFile(), 'utf8')).toBe(`TUNNEL_TOKEN=${tunnelTok}\n`);
    expect(r.text).not.toContain(tunnelTok);
  });

  it('403 на зміні правил WAF: код 3, названо дозвіл, перелічено застосоване (AC-44)', async () => {
    const fake = createFakeApi();
    /** @type {typeof globalThis.fetch} */
    const refusingWaf = async (input, init) => {
      const url = String(input);
      if ((init?.method ?? 'GET') !== 'GET' && url.includes(`/rulesets/phases/${PHASE_CUSTOM}/`)) {
        return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: 'fake' }], result: null }), { status: 403 });
      }
      return fake.fetch(input, init);
    };
    const r = await run({ fetch: refusingWaf }, ['apply', '--env', 'test']);
    expect(r.code).toBe(3);
    expect(r.text).toContain(`refused 403 on waf PUT /zones/zone-test/rulesets/phases/${PHASE_CUSTOM}/entrypoint; needs permission: Zone · Zone WAF · Edit`);
    const after = r.lines.slice(r.lines.indexOf('applied before the refusal:') + 1);
    expect(after.some((l) => l.includes('тунель t2f-test'))).toBe(true);
    expect(after.some((l) => l.includes('DNS o-test.time2fest.com'))).toBe(true);
    expect(after.some((l) => l.includes('t2f-skip-exempt'))).toBe(false);
    // зупинка на першій відмові: фаза конфіг-правил не чіпалась, журналу й файлу токена немає
    expect(fake.mutations().some((m) => m.path.includes(PHASE_CONFIG))).toBe(false);
    expect(r.lines.some((l) => JOURNAL.test(l))).toBe(false);
    expect(fs.existsSync(tokenFile())).toBe(false);
    expect(r.text).not.toContain(tok);
  });

  it('--under-attack on, потім звичайний plan: одна різниця на t2f-under-attack-test (AC-51)', async () => {
    const fake = converged();
    const on = await run(fake, ['apply', '--env', 'test', '--under-attack', 'on']);
    expect(on.code).toBe(0);
    expect(fake.mutations()).toEqual([{ method: 'PUT', path: `/zones/zone-test/rulesets/phases/${PHASE_CONFIG}/entrypoint` }]);
    expect(fake.state.rulesets[PHASE_CONFIG]?.find((x) => x.ref === 't2f-under-attack-test')?.enabled).toBe(true);

    const plan = await run(fake, ['plan', '--env', 'test']);
    expect(plan.code).toBe(0);
    expect(plan.lines).toHaveLength(1);
    expect(plan.lines[0]).toContain('t2f-under-attack-test');
  });
});
