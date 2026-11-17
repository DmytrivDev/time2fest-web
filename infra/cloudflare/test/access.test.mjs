// @ts-check
// Застосунок Access для адмінки (AC-30): лише з --with-access; пошти — лише зі змінної, ніколи з git і не у виводі.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../cf.mjs';
import { desiredAccess, diffAccess, parseOwnerEmails } from '../lib/access.mjs';
import { guard } from '../lib/guard.mjs';
import { createRedactor } from '../lib/redact.mjs';
import { convergedSeed, createFakeApi } from './support/fakeApi.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Тестові адреси: єдине місце в infra/cloudflare, де вони є (перевіряється нижче).
const OWNER_A = 'owner.fixture@example.org';
const OWNER_B = 'second.fixture@example.org';
const tok = `tok-${'7e'.repeat(8)}`;
const tunnelTok = `tt-${'8f'.repeat(8)}`;

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
async function run(fake, argv, extraEnv = { T2F_OWNER_EMAILS: `${OWNER_A}, ${OWNER_B}` }) {
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, {
    env: {
      CLOUDFLARE_API_TOKEN_INFRA: tok,
      CLOUDFLARE_ACCOUNT_ID: 'acct-test',
      CLOUDFLARE_ZONE_ID: 'zone-test',
      T2F_LOCK_DIR: path.join(tmp, 'locks'),
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

  it('plan: одна зміна create access-app, лише GET, пошти — лише кількістю', async () => {
    const fake = converged();
    const r = await run(fake, ['plan', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([]);
    expect(accessRequests(fake)).toEqual([{ method: 'GET', path: '/accounts/acct-test/access/apps' }]);
    expect(r.text).toContain('create access-app: Access t2f-admin-rehearsal (admin-rehearsal.time2fest.com): створити, політика на 2 адрес');
    expect(r.text).toContain('адрес власника — 2');
    for (const e of [OWNER_A, OWNER_B]) expect(r.text).not.toContain(e);
  });

  it('apply: POST з поштами зі змінної, aud надруковано; повтор — без змін', async () => {
    const fake = converged();
    const r = await run(fake, ['apply', '--env', 'rehearsal', '--with-access']);
    expect(r.code).toBe(0);
    expect(fake.mutations()).toEqual([{ method: 'POST', path: '/accounts/acct-test/access/apps' }]);
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
    expect(fake.mutations()).toHaveLength(1);
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
