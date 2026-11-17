// @ts-check
// Застосунок Access для адмінки (AC-30): лише з --with-access; пошти — лише зі змінної, ніколи з git і не у виводі.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { desiredAccess, diffAccess, diffIdp, parseOwnerEmails } from '../lib/access.mjs';
import { guard } from '../lib/guard.mjs';
import { createRedactor } from '../lib/redact.mjs';
import { convergedSeed, createFakeApi } from './support/fakeApi.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Тестові адреси: єдине місце в infra/cloudflare, де вони є (перевіряється нижче).
const OWNER_A = 'owner.fixture@example.org';
const OWNER_B = 'second.fixture@example.org';
const tok = `tok-${'7e'.repeat(8)}`;
const tunnelTok = `tt-${'8f'.repeat(8)}`;
// Клієнт OAuth Google (фікстури): id не секрет, але друкується лише його хвіст; секрет — ніколи.
const GOOGLE_ID = `fixture-${'1a'.repeat(6)}.apps.googleusercontent.example`;
const GOOGLE_ID_2 = `fixture-${'2b'.repeat(6)}.apps.googleusercontent.example`;
const GOOGLE_SECRET = `gsec-${'9d'.repeat(10)}`;
const OWNERS = { T2F_OWNER_EMAILS: `${OWNER_A}, ${OWNER_B}` };

/** @type {string} */
let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-cf-access-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * @param {ReturnType<typeof createFakeApi>} fake
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [extraEnv]
 */
async function run(fake, argv, extraEnv = OWNERS) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, {
    env: {
      CLOUDFLARE_API_TOKEN_INFRA: tok,
      CLOUDFLARE_ACCOUNT_ID: 'acct-test',
      CLOUDFLARE_ZONE_ID: 'zone-test',
      T2F_LOCK_DIR: path.join(tmp, 'locks'),
      CF_ACCESS_GOOGLE_CLIENT_ID: GOOGLE_ID,
      CF_ACCESS_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
      ...extraEnv,
    },
    fetch: fake.fetch,
    out: (l) => lines.push(l),
    localDir: path.join(tmp, '.local'),
  });
  return { code, lines, text: lines.join('\n') };
}

function converged() {
  const fake = createFakeApi();
  fake.seed(convergedSeed(fake, tunnelTok));
  return fake;
}

/** @param {ReturnType<typeof createFakeApi>} fake */
const accessRequests = (fake) => fake.log.filter((l) => l.path.includes('/access/'));

describe('Access: без --with-access', () => {
  it('у плані немає застосунку Access і немає жодного запиту /access/, навіть коли змінна задана', async () => {
    const fake = converged();
    for (const argv of [['plan', '--env', 'rehearsal'], ['apply', '--env', 'rehearsal']]) {
      const r = await run(fake, argv);
      expect(r.code).toBe(0);
      expect(r.text).not.toContain('access-app');
    }
    expect(accessRequests(fake)).toEqual([]);
    expect(fake.state.accessApps).toEqual([]);
  });

  it('F2: plan і apply без --with-access не показують і не створюють жодного об’єкта admin-rehearsal', async () => {
    const fake = createFakeApi();
    for (const argv of [['plan', '--env', 'rehearsal'], ['apply', '--env', 'rehearsal']]) {
      const r = await run(fake, argv, {});
      expect(r.code).toBe(0);
      expect(r.text).not.toContain('admin-rehearsal');
    }
    expect(fake.state.dns.some((x) => x.name === 'admin-rehearsal.time2fest.com')).toBe(false);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    expect(JSON.stringify(fake.state.rulesets)).not.toContain('admin-rehearsal');
    expect(accessRequests(fake)).toEqual([]);
  });

  it('F2: залишок адмінки (CNAME і ingress) без Access і без позначки → ingress прибрано, ім’я в блок-правилі', async () => {
    const fake = converged();
    const tun = fake.state.tunnels.find((t) => t.name === 't2f-rehearsal');
    if (!tun?.ingress) throw new Error('немає тунелю t2f-rehearsal у фейку');
    tun.ingress = [tun.ingress[0], { hostname: 'admin-rehearsal.time2fest.com', service: 'http://server:3000' }, tun.ingress.at(-1)];
    fake.state.dns.push({ id: 'old-admin', name: 'admin-rehearsal.time2fest.com', type: 'CNAME', content: 'tun2.cfargotunnel.com', proxied: true });
    const plan = await run(fake, ['plan', '--env', 'rehearsal'], {});
    expect(plan.code).toBe(0);
    expect(plan.text).toContain('адмінка admin-rehearsal.time2fest.com: є в Cloudflare без Access');
    expect(plan.text).toContain('update tunnel-config: тунель t2f-rehearsal: оновити ingress');
    expect(plan.text).toContain('update rule: правило t2f-block-tunnel-hosts');
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    const block = (fake.state.rulesets.http_request_firewall_custom ?? []).find((x) => x.ref === 't2f-block-tunnel-hosts');
    expect(block?.expression).toContain('"admin-rehearsal.time2fest.com"');
    expect(accessRequests(fake)).toEqual([]);
  });
});

describe('Access: з --with-access', () => {
  it('немає T2F_OWNER_EMAILS → код 1, змінну названо, жодного запиту', async () => {
    const fake = converged();
    const r = await run(fake, ['plan', '--env', 'rehearsal', '--with-access'], {});
    expect(r.code).toBe(1);
    expect(r.text).toContain('T2F_OWNER_EMAILS');
    expect(fake.log).toEqual([]);
  });

  it('середовище без адмінки (test) → код 1, жодного запиту', async () => {
    const fake = converged();
    const r = await run(fake, ['apply', '--env', 'test', '--with-access']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('adminHost');
    expect(fake.log).toEqual([]);
  });

  it('plan: create access-app (після create access-idp), лише GET, пошти — лише кількістю', async () => {
    const fake = converged();
    const r = await run(fake, ['plan', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(accessRequests(fake)).toEqual([
      { method: 'GET', path: '/accounts/acct-test/access/identity_providers' },
      { method: 'GET', path: '/accounts/acct-test/access/apps' },
    ]);
    expect(r.text).toContain('create access-app: Access t2f-admin-rehearsal (admin-rehearsal.time2fest.com): створити, політика на 2 адрес, вхід лише через Google');
    expect(r.text).toContain('адрес власника — 2');
    for (const e of [OWNER_A, OWNER_B]) expect(r.text).not.toContain(e);
  });

  it('apply: POST з поштами зі змінної, aud надруковано; повтор — без змін', async () => {
    const fake = converged();
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    // F2: постачальник входу Google і застосунок Access — першими, лише потім ingress адмінки і її CNAME.
    expect(fake.mutations()).toEqual([
      { method: 'POST', path: '/accounts/acct-test/access/identity_providers' },
      { method: 'POST', path: '/accounts/acct-test/access/apps' },
      { method: 'PUT', path: '/accounts/acct-test/cfd_tunnel/tun2/configurations' },
      { method: 'POST', path: '/zones/zone-test/dns_records' },
    ]);
    expect(fake.state.dns.find((x) => x.name === 'admin-rehearsal.time2fest.com')).toEqual(
      expect.objectContaining({ type: 'CNAME', content: 'tun2.cfargotunnel.com', proxied: true }),
    );
    expect(fake.state.tunnels.find((t) => t.name === 't2f-rehearsal')?.ingress).toContainEqual({
      hostname: 'admin-rehearsal.time2fest.com',
      path: '^/(admin|cms-api|_next)(/|$)',
      service: 'http://server:3000',
    });
    const app = fake.state.accessApps[0];
    expect(app).toEqual(
      expect.objectContaining({ name: 't2f-admin-rehearsal', domain: 'admin-rehearsal.time2fest.com', type: 'self_hosted', session_duration: '24h' }),
    );
    expect(app.policies).toEqual([
      { name: 't2f-owner-rehearsal', decision: 'allow', include: [{ email: { email: OWNER_A } }, { email: { email: OWNER_B } }] },
    ]);
    expect(r.text).toContain(`aud = ${app.aud}`);
    expect(r.text).toContain('T2F_ACCESS_AUD');
    for (const e of [OWNER_A, OWNER_B, tok]) expect(r.text).not.toContain(e);

    const again = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(again.code).toBe(0);
    expect(again.text).toContain('без змін');
    expect(fake.mutations()).toHaveLength(4);
  });

  it('F2/N3: після успішного кроку Access позначка тримає адмінку і без --with-access — Access лише читається (GET) для перевірки', async () => {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    expect(fs.existsSync(path.join(tmp, '.local', 'access-rehearsal.ok'))).toBe(true);
    const before = fake.log.length;
    const plan = await run(fake, ['plan', '--env', 'rehearsal'], {});
    expect(plan.code).toBe(0);
    expect(plan.text).toContain('без змін');
    const apply = await run(fake, ['apply', '--env', 'test'], {});
    expect(apply.code).toBe(0);
    expect(apply.text).toContain('без змін');
    expect(fake.mutations()).toHaveLength(4);
    // N3: одне читання списку застосунків на запуск, (S8) за ним одне читання постачальників входу, жодної зміни Access.
    expect(fake.log.slice(before).filter((l) => l.path.includes('/access/'))).toEqual([
      { method: 'GET', path: '/accounts/acct-test/access/apps' },
      { method: 'GET', path: '/accounts/acct-test/access/identity_providers' },
      { method: 'GET', path: '/accounts/acct-test/access/apps' },
      { method: 'GET', path: '/accounts/acct-test/access/identity_providers' },
    ]);
    expect(fs.existsSync(path.join(tmp, '.local', 'access-rehearsal.ok'))).toBe(true);
  });

  it('F2: відмова на кроці Access — ні ingress, ні CNAME адмінки, позначки немає', async () => {
    const fake = converged();
    fake.refuse('access', 403);
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(3);
    expect(fake.state.dns.some((x) => x.name === 'admin-rehearsal.time2fest.com')).toBe(false);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    expect(fs.existsSync(path.join(tmp, '.local', 'access-rehearsal.ok'))).toBe(false);
  });

  it('змінився перелік пошт → PUT того самого застосунку', async () => {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    const id = fake.state.accessApps[0].id;
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access'], { T2F_OWNER_EMAILS: OWNER_A });
    expect(r.code).toBe(0);
    expect(fake.mutations().at(-1)).toEqual({ method: 'PUT', path: `/accounts/acct-test/access/apps/${id}` });
    expect(fake.state.accessApps).toHaveLength(1);
    expect(fake.state.accessApps[0].policies[0].include).toEqual([{ email: { email: OWNER_A } }]);
  });

  it('пошти з --secrets-file (не з git)', async () => {
    const fake = converged();
    const file = path.join(tmp, 'secrets.env');
    fs.writeFileSync(file, `T2F_OWNER_EMAILS=${OWNER_B}\n`);
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access', '--secrets-file', file], {});
    expect(r.code).toBe(0);
    expect(fake.state.accessApps[0].policies[0].include).toEqual([{ email: { email: OWNER_B } }]);
    expect(r.text).not.toContain(OWNER_B);
  });

  it('відмова API на Access → код 3, названо дозвіл', async () => {
    const fake = converged();
    fake.refuse('access', 403);
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(3);
    expect(r.text).toContain('Access: Apps and Policies');
  });
});

describe('Access: вхід лише через Google (постачальник t2f-google)', () => {
  const IDP_PATH = '/accounts/acct-test/access/identity_providers';
  const APPS_PATH = '/accounts/acct-test/access/apps';
  /** @param {ReturnType<typeof createFakeApi>} fake */
  const adminDns = (fake) => fake.state.dns.some((x) => x.name === 'admin-rehearsal.time2fest.com');
  const marker = () => path.join(tmp, '.local', 'access-rehearsal.ok');

  it('новий акаунт: POST постачальника, потім POST застосунку з allowed_idps = його id і auto_redirect, потім ingress і DNS; повтор — без змін', async () => {
    const fake = converged();
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([
      { method: 'POST', path: IDP_PATH },
      { method: 'POST', path: APPS_PATH },
      { method: 'PUT', path: '/accounts/acct-test/cfd_tunnel/tun2/configurations' },
      { method: 'POST', path: '/zones/zone-test/dns_records' },
    ]);
    expect(fake.state.identityProviders).toHaveLength(1);
    const idp = fake.state.identityProviders[0];
    expect(idp).toEqual({ id: idp.id, name: 't2f-google', type: 'google', config: { client_id: GOOGLE_ID, client_secret: GOOGLE_SECRET } });
    const app = fake.state.accessApps[0];
    expect(app.allowed_idps).toEqual([idp.id]);
    expect(app.auto_redirect_to_identity).toBe(true);
    expect(r.text).toContain(`client id …${GOOGLE_ID.slice(-6)}`);

    const again = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(again.code).toBe(0);
    expect(again.text).toContain('без змін');
    expect(fake.mutations()).toHaveLength(4);
    expect(fake.state.identityProviders).toHaveLength(1);
  });

  it('plan: рядок create access-idp перед create access-app, лише GET', async () => {
    const fake = converged();
    const r = await run(fake, ['plan', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(r.text).toContain(`create access-idp: постачальник входу t2f-google (Google, client id …${GOOGLE_ID.slice(-6)}): створити`);
    expect(r.text.indexOf('create access-idp')).toBeLessThan(r.text.indexOf('create access-app'));
  });

  it('змінився client id → PUT того самого постачальника з повним тілом; застосунок не змінюється', async () => {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    const id = fake.state.identityProviders[0].id;
    const before = fake.mutations().length;
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access'], { ...OWNERS, CF_ACCESS_GOOGLE_CLIENT_ID: GOOGLE_ID_2 });
    expect(r.code).toBe(0);
    expect(fake.mutations().slice(before)).toEqual([{ method: 'PUT', path: `${IDP_PATH}/${id}` }]);
    expect(fake.state.identityProviders).toEqual([{ id, name: 't2f-google', type: 'google', config: { client_id: GOOGLE_ID_2, client_secret: GOOGLE_SECRET } }]);
    expect(fake.state.accessApps[0].allowed_idps).toEqual([id]);
    for (const v of [GOOGLE_ID_2, GOOGLE_SECRET]) expect(r.text).not.toContain(v);
  });

  it('застосунок з іншим allowed_idps (або без нього) → PUT застосунку з id постачальника', async () => {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    const app = fake.state.accessApps[0];
    const idpId = fake.state.identityProviders[0].id;
    app.allowed_idps = ['someone-else'];
    delete app.auto_redirect_to_identity;
    const before = fake.mutations().length;
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations().slice(before)).toEqual([{ method: 'PUT', path: `${APPS_PATH}/${app.id}` }]);
    expect(fake.state.accessApps[0].allowed_idps).toEqual([idpId]);
    expect(fake.state.accessApps[0].auto_redirect_to_identity).toBe(true);
  });

  it('постачальник t2f-google іншого типу (чужий) → plan показує заборону, apply код 2, 0 змін, чужий не змінено', async () => {
    const fake = converged();
    const foreign = { id: 'foreign-1', name: 't2f-google', type: 'onetimepin', config: {} };
    fake.seed({ identityProviders: [{ ...foreign }] });
    const plan = await run(fake, ['plan', '--env', 'rehearsal', '--with-access']);
    expect(plan.code).toBe(0);
    expect(plan.text).toContain('заборонено: update access-idp t2f-google');
    expect(plan.text).toContain('жоден прапорець не дозволяє');
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(2);
    expect(r.text).toContain('жодного запиту на зміну не зроблено');
    expect(fake.mutations()).toEqual([]);
    expect(fake.state.identityProviders).toEqual([foreign]);
    expect(fake.state.accessApps).toEqual([]);
    expect(adminDns(fake)).toBe(false);
  });

  it('403 на списку постачальників → код 3, названо право, жодної зміни (ні застосунку, ні ingress, ні DNS)', async () => {
    const fake = converged();
    fake.refuse('access-idp', 403);
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(3);
    expect(r.text).toContain('Access: Organizations, Identity Providers, and Groups · Edit');
    expect(fake.mutations()).toEqual([]);
    expect(fake.state.accessApps).toEqual([]);
    expect(adminDns(fake)).toBe(false);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('403 на створенні постачальника → код 3, названо право, після відмови — 0 змін', async () => {
    const fake = converged();
    fake.refuse('access-idp', 403, 'POST');
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(3);
    expect(r.text).toContain('needs permission: Account · Access: Organizations, Identity Providers, and Groups · Edit');
    // Єдина спроба зміни — сама відхилена POST постачальника; далі нічого.
    expect(fake.mutations()).toEqual([{ method: 'POST', path: IDP_PATH }]);
    expect(fake.state.identityProviders).toEqual([]);
    expect(fake.state.accessApps).toEqual([]);
    expect(adminDns(fake)).toBe(false);
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    expect(fs.existsSync(marker())).toBe(false);
    expect(r.text).not.toContain(GOOGLE_SECRET);
  });

  it.each([['CF_ACCESS_GOOGLE_CLIENT_ID'], ['CF_ACCESS_GOOGLE_CLIENT_SECRET']])('немає %s → код 1, змінну названо, жодного запиту', async (name) => {
    const fake = converged();
    for (const cmd of ['plan', 'apply']) {
      const r = await run(fake, [cmd, '--env', 'rehearsal', '--with-access'], { ...OWNERS, [name]: undefined });
      expect(r.code).toBe(1);
      expect(r.text).toContain(name);
    }
    expect(fake.log).toEqual([]);
  });

  it('секрет клієнта (і повний client id) ніколи не у виводі й не в .local; значення з --secrets-file теж маскуються', async () => {
    const fake = converged();
    const file = path.join(tmp, 'secrets.env');
    fs.writeFileSync(file, `T2F_OWNER_EMAILS=${OWNER_A}\nCF_ACCESS_GOOGLE_CLIENT_ID=${GOOGLE_ID}\nCF_ACCESS_GOOGLE_CLIENT_SECRET=${GOOGLE_SECRET}\n`);
    /** @type {string[]} */
    const texts = [];
    const env = { CF_ACCESS_GOOGLE_CLIENT_ID: undefined, CF_ACCESS_GOOGLE_CLIENT_SECRET: undefined, T2F_OWNER_EMAILS: undefined };
    for (const cmd of ['plan', 'apply']) {
      const r = await run(fake, [cmd, '--env', 'rehearsal', '--with-access', '--secrets-file', file], env);
      expect(r.code).toBe(0);
      texts.push(r.text);
    }
    expect(fake.state.identityProviders[0].config.client_secret).toBe(GOOGLE_SECRET);
    // Повідомлення про помилку (чужий тип) — теж без секрету.
    fake.state.identityProviders[0].type = 'github';
    texts.push((await run(fake, ['apply', '--env', 'rehearsal', '--with-access', '--secrets-file', file], env)).text);
    const local = path.join(tmp, '.local');
    for (const f of fs.readdirSync(local)) texts.push(fs.readFileSync(path.join(local, f), 'utf8'));
    for (const t of texts) {
      expect(t).not.toContain(GOOGLE_SECRET);
      expect(t).not.toContain(GOOGLE_ID);
    }
    expect(texts[0]).toContain(`…${GOOGLE_ID.slice(-6)}`);
  });

  it('N3: позначка є, але allowed_idps застосунку порожній → адмінку вимкнено, позначку прибрано', async () => {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    expect(fs.existsSync(marker())).toBe(true);
    fake.state.accessApps[0].allowed_idps = [];
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(r.text).toContain('allowed_idps порожній');
    expect(JSON.stringify(fake.state.tunnels)).not.toContain('admin-rehearsal');
    const block = (fake.state.rulesets.http_request_firewall_custom ?? []).find((x) => x.ref === 't2f-block-tunnel-hosts');
    expect(block?.expression).toContain('"admin-rehearsal.time2fest.com"');
    expect(fs.existsSync(marker())).toBe(false);
    expect(fake.mutations().filter((m) => m.path.includes('/access/')).map((m) => m.method)).toEqual(['POST', 'POST']);
  });

  it('запобіжник: постачальник входу лише для rehearsal; видалення — ніколи', () => {
    const base = { kind: 'access-idp', target: 't2f-google', hosts: ['admin-rehearsal.time2fest.com'], category: 'access-idp', summary: 's' };
    expect(guard([{ ...base, op: 'create', data: { env: 'rehearsal' } }]).ok).toBe(true);
    const flags = { allowMainDomain: true, allowZoneSettings: true, allowDelete: true };
    expect(guard([{ ...base, op: 'create', data: { env: 'test' } }], flags).refused.map((x) => x.flag)).toEqual([null]);
    expect(guard([{ ...base, op: 'delete', data: { env: 'rehearsal' } }], flags).refused.map((x) => x.flag)).toEqual([null]);
    expect(guard([{ ...base, op: 'update', data: { env: 'rehearsal', conflict: 'github' } }], flags).refused.map((x) => x.flag)).toEqual([null]);
  });

  it('diffIdp: той самий client id — без змін; інший — update; немає — create', () => {
    const want = { envName: 'rehearsal', host: 'admin-rehearsal.time2fest.com', clientId: GOOGLE_ID };
    expect(diffIdp(want, []).changes.map((c) => c.op)).toEqual(['create']);
    const same = [{ id: 'g1', name: 't2f-google', type: 'google', config: { client_id: GOOGLE_ID } }];
    expect(diffIdp(want, same)).toEqual({ changes: [], id: 'g1' });
    const other = [{ id: 'g1', name: 't2f-google', type: 'google', config: { client_id: GOOGLE_ID_2 } }];
    expect(diffIdp(want, other).changes.map((c) => `${c.op}:${c.data.id}`)).toEqual(['update:g1']);
    // Чужі постачальники з іншими іменами не чіпаються.
    expect(diffIdp(want, [{ id: 'x', name: 'someone', type: 'github' }, ...same]).changes).toEqual([]);
  });
});

describe('N3: позначка Access перевіряється в Cloudflare', () => {
  const ADMIN = 'admin-rehearsal.time2fest.com';
  const marker = () => path.join(tmp, '.local', 'access-rehearsal.ok');
  /** @param {ReturnType<typeof createFakeApi>} fake */
  const blockExpr = (fake) => (fake.state.rulesets.http_request_firewall_custom ?? []).find((x) => x.ref === 't2f-block-tunnel-hosts')?.expression ?? '';
  /** @param {ReturnType<typeof createFakeApi>} fake */
  const adminIngress = (fake) => JSON.stringify(fake.state.tunnels).includes(ADMIN);

  async function withAdmin() {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    expect(fs.existsSync(marker())).toBe(true);
    expect(adminIngress(fake)).toBe(true);
    return fake;
  }

  it('позначка є, застосунку немає → plan пише причину; apply: без ingress адмінки, ім’я в блок-правилі, позначку прибрано', async () => {
    const fake = await withAdmin();
    fake.state.accessApps.length = 0;
    const plan = await run(fake, ['plan', '--env', 'rehearsal'], {});
    expect(plan.code).toBe(0);
    expect(plan.text).toContain(`адмінка ${ADMIN}: позначка Access є, але застосунку Access з цим доменом у Cloudflare немає`);
    expect(plan.text).toContain('apply прибере позначку');
    expect(plan.text).toContain('update rule: правило t2f-block-tunnel-hosts');
    expect(fs.existsSync(marker())).toBe(true);
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(adminIngress(fake)).toBe(false);
    expect(blockExpr(fake)).toContain(`"${ADMIN}"`);
    expect(fs.existsSync(marker())).toBe(false);
    // Жодного запису Access не створено й не змінено.
    expect(fake.mutations().filter((m) => m.path.includes('/access/'))).toEqual([
      { method: 'POST', path: '/accounts/acct-test/access/identity_providers' },
      { method: 'POST', path: '/accounts/acct-test/access/apps' },
    ]);
  });

  it('застосунок з тим доменом, але без жодної політики → вимкнено, позначку прибрано', async () => {
    const fake = await withAdmin();
    fake.state.accessApps[0].policies = [];
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(r.text).toContain('застосунок Access без жодної політики');
    expect(adminIngress(fake)).toBe(false);
    expect(blockExpr(fake)).toContain(`"${ADMIN}"`);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('токену бракує права читання Access (403) → вимкнено з назвою права, запуск не падає', async () => {
    const fake = await withAdmin();
    fake.refuse('access', 403);
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(r.text).toContain('Account · Access: Apps and Policies · Read');
    expect(adminIngress(fake)).toBe(false);
    expect(blockExpr(fake)).toContain(`"${ADMIN}"`);
    // Не доведено, що позначка застаріла: лишається, наступний запуск з правом перевірить знову.
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('застосунок на третій сторінці списку → знайдено (усі сторінки прочитано), адмінка лишається', async () => {
    const fake = await withAdmin();
    const ours = fake.state.accessApps[0];
    const others = Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, name: `other-${i}`, domain: `other-${i}.example.org`, policies: [{ name: 'p' }] }));
    fake.seed({ accessApps: [...others, ours], accessPerPage: 3 });
    const before = fake.log.length;
    const plan = await run(fake, ['plan', '--env', 'rehearsal'], {});
    expect(plan.code).toBe(0);
    expect(plan.text).toContain('без змін');
    expect(fake.log.slice(before).filter((l) => l.path.includes('/access/apps'))).toHaveLength(3);
    // S8: і один список постачальників входу.
    expect(fake.log.slice(before).filter((l) => l.path.includes('/access/identity_providers'))).toHaveLength(1);
    expect(fs.existsSync(marker())).toBe(true);
  });
});

describe('S8: позначка вимагає лише t2f-google і лише пошти', () => {
  const ADMIN = 'admin-rehearsal.time2fest.com';
  const marker = () => path.join(tmp, '.local', 'access-rehearsal.ok');
  /** @param {ReturnType<typeof createFakeApi>} fake */
  const adminIngress = (fake) => JSON.stringify(fake.state.tunnels).includes(ADMIN);

  async function withAdmin() {
    const fake = converged();
    expect((await run(fake, ['apply', '--env', 'rehearsal', '--with-access'])).code).toBe(0);
    expect(adminIngress(fake)).toBe(true);
    return fake;
  }

  /** @param {ReturnType<typeof createFakeApi>} fake */
  async function expectDisabled(fake, /** @type {string} */ why) {
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(r.text).toContain(why);
    expect(adminIngress(fake)).toBe(false);
    expect(fs.existsSync(marker())).toBe(false);
  }

  it('the converged app (allowed_idps = [t2f-google], email-only allow policy) keeps the admin name', async () => {
    const fake = await withAdmin();
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(adminIngress(fake)).toBe(true);
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('allowed_idps naming another provider, or t2f-google plus another, disables the admin name', async () => {
    for (const extra of [false, true]) {
      const fake = await withAdmin();
      fake.state.identityProviders.push({ id: 'other-idp', name: 'other', type: 'onetimepin', config: {} });
      const google = String(fake.state.identityProviders[0].id);
      fake.state.accessApps[0].allowed_idps = extra ? [google, 'other-idp'] : ['other-idp'];
      await expectDisabled(fake, 'не лише t2f-google');
    }
  });

  it('t2f-google of another type disables the admin name', async () => {
    const fake = await withAdmin();
    fake.state.identityProviders[0].type = 'github';
    await expectDisabled(fake, 'не лише t2f-google');
  });

  it.each([
    ['everyone', [{ everyone: {} }]],
    ['email domain', [{ email_domain: { domain: 'example.org' } }]],
    ['email plus everyone', [{ email: { email: OWNER_A } }, { everyone: {} }]],
    ['empty include', []],
  ])('an allow policy with %s disables the admin name', async (_name, include) => {
    const fake = await withAdmin();
    fake.state.accessApps[0].policies[0].include = include;
    await expectDisabled(fake, 'пускає не лише за поштою');
  });

  it('an app with deny policies only disables the admin name', async () => {
    const fake = await withAdmin();
    fake.state.accessApps[0].policies[0].decision = 'deny';
    await expectDisabled(fake, 'без жодної політики allow');
  });

  it('403 on reading identity providers → disabled naming the read right, the run does not fail, the marker stays', async () => {
    const fake = await withAdmin();
    fake.refuse('access-idp', 403);
    const r = await run(fake, ['apply', '--env', 'rehearsal'], {});
    expect(r.code).toBe(0);
    expect(r.text).toContain('Account · Access: Organizations, Identity Providers, and Groups · Read');
    expect(adminIngress(fake)).toBe(false);
    expect(fs.existsSync(marker())).toBe(true);
  });
});

describe('Access: одиниці', () => {
  it('розбір пошт: кома, крапка з комою, пробіли; щось не схоже на адресу → null', () => {
    expect(parseOwnerEmails(` ${OWNER_A};${OWNER_B} ,${OWNER_A}`)).toEqual([OWNER_A, OWNER_B]);
    expect(parseOwnerEmails('')).toBeNull();
    expect(parseOwnerEmails(undefined)).toBeNull();
    expect(parseOwnerEmails(`${OWNER_A}, not-an-email`)).toBeNull();
  });

  it('редактор маскує перелік пошт', () => {
    const list = `${OWNER_A},${OWNER_B}`;
    const masked = createRedactor({ T2F_OWNER_EMAILS: list }).mask(`emails: ${list}`);
    expect(masked).toBe('emails: ***');
  });

  it('застосунок на хості робочого домену → запобіжник відмовляє без --allow-main-domain', () => {
    const app = { ...desiredAccess('rehearsal', [OWNER_A]), domain: 'admin.time2fest.com' };
    const changes = diffAccess(app, []);
    expect(changes.map((c) => `${c.op}:${c.kind}`)).toEqual(['create:access-app']);
    const refused = guard(changes).refused;
    expect(refused.map((x) => x.flag)).toEqual(['--allow-main-domain']);
    expect(guard(changes, { allowMainDomain: true }).ok).toBe(true);
    // адмінка репетиції — не робочий домен
    expect(guard(diffAccess(desiredAccess('rehearsal', [OWNER_A]), [])).ok).toBe(true);
  });

  it('тестові пошти в infra/cloudflare є лише в цьому файлі (бажаний стан у репозиторії їх не містить)', () => {
    for (const e of [OWNER_A, OWNER_B]) {
      const found = execFileSync('git', ['grep', '--untracked', '-l', '-F', '-e', e, '--', 'infra/cloudflare'], { cwd: REPO, encoding: 'utf8' })
        .split('\n')
        .filter(Boolean);
      expect(found).toEqual(['infra/cloudflare/test/access.test.mjs']);
    }
  });
});
