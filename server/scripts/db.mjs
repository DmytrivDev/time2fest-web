// @ts-check
/**
 * Worktree database tool (SPEC-02 W12).
 *   node scripts/db.mjs create            create t2f_<slug> and t2f_<slug>_test if missing
 *   node scripts/db.mjs env               write server/.env.local for this worktree
 *   node scripts/db.mjs migcheck up|drop  create or drop t2f_<slug>_migcheck only
 * Never drops anything except the _migcheck database. Prints names, never the secret.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { resolveWorktree } from './lib/worktree.mjs';
import { lockDir } from './lib/lock.mjs';
import { ensureRealtimeSecrets, realtimeSecretsFile } from './lib/realtimeSecrets.mjs';

const ADMIN_URI = 'postgres://t2f@127.0.0.1:5433/postgres';
const IDENT = /^t2f_[a-z0-9_]{1,46}$/;
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} name */
function ident(name) {
  if (!IDENT.test(name)) throw new Error(`refusing database identifier "${name}"`);
  return `"${name}"`;
}

/**
 * @param {pg.Client} client
 * @param {string} name
 */
async function createIfMissing(client, name) {
  const q = ident(name);
  const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (r.rowCount === 0) {
    await client.query(`CREATE DATABASE ${q}`);
    console.log(`created ${name}`);
  } else {
    console.log(`exists ${name}`);
  }
}

/** @param {(c: pg.Client) => Promise<void>} fn */
async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: ADMIN_URI });
  await client.connect();
  try {
    await fn(client);
  } finally {
    await client.end();
  }
}

/** @param {import('./lib/worktree.mjs').Worktree} wt */
function writeEnv(wt) {
  const file = path.join(serverDir, '.env.local');
  let secret = '';
  if (fs.existsSync(file)) {
    const m = /^PAYLOAD_SECRET=(.+)$/m.exec(fs.readFileSync(file, 'utf8'));
    if (m && m[1]) secret = m[1].trim();
  }
  if (secret === '') secret = crypto.randomBytes(32).toString('hex');
  const web = wt.ports.web;
  // Centrifugo values: process.env (CI) wins, else the shared local secrets file (SPEC-06 W11).
  const tokenEnv = process.env.T2F_CENTRIFUGO_TOKEN_SECRET;
  const apiEnv = process.env.T2F_CENTRIFUGO_API_KEY;
  const shared = tokenEnv && apiEnv ? undefined : ensureRealtimeSecrets(realtimeSecretsFile(serverDir, {}));
  const lines = [
    'T2F_ENV=test',
    'T2F_TEST_DOORS=1',
    `T2F_SLOT=${wt.slot}`,
    `T2F_SLUG=${wt.slug}`,
    `T2F_SERVER_PORT=${wt.ports.server}`,
    `T2F_WEB_PORT=${web}`,
    `DATABASE_URI=postgres://t2f@127.0.0.1:5433/${wt.database}`,
    `REDIS_URL=redis://127.0.0.1:6380/${wt.redisDb}`,
    `T2F_REDIS_PREFIX=${wt.redisPrefix}`,
    `T2F_CENTRIFUGO_PREFIX=${wt.channelPrefix}`,
    'SMTP_HOST=127.0.0.1',
    'SMTP_PORT=1025',
    `T2F_LOCK_DIR=${lockDir(serverDir, {})}`,
    `T2F_ALLOWED_ORIGINS=http://127.0.0.1:${web},http://localhost:${web},http://localhost:3000`,
    `PAYLOAD_SECRET=${secret}`,
    `T2F_ADMIN_HOST=admin.localhost:${wt.ports.server}`,
    'T2F_ACCESS_TEAM_DOMAIN=https://t2f-test.invalid',
    'T2F_ACCESS_AUD=t2f-test-aud',
    'T2F_ACCESS_JWKS_URL=test-signer:',
    `T2F_OWNER_EMAILS=owner+${wt.slug}@example.com,owner2+${wt.slug}@example.com`,
    'T2F_ACCESS_SERVICE_CNS=test-agent.access',
    'T2F_R2_ENDPOINT=http://127.0.0.1:9090',
    'T2F_R2_BUCKET=t2f-catalog',
    `T2F_R2_PREFIX=${wt.slug}/`,
    `T2F_CENTRIFUGO_URL=${process.env.T2F_CENTRIFUGO_URL || 'http://127.0.0.1:8000'}`,
    `T2F_CENTRIFUGO_TOKEN_SECRET=${tokenEnv || shared?.T2F_CENTRIFUGO_TOKEN_SECRET}`,
    `T2F_CENTRIFUGO_API_KEY=${apiEnv || shared?.T2F_CENTRIFUGO_API_KEY}`,
    'T2F_R2_ACCESS_KEY_ID=t2f-local',
    'T2F_R2_SECRET_ACCESS_KEY=t2f-local-secret-0000',
    '',
  ];
  fs.writeFileSync(file, lines.join('\n'));
  console.log(`wrote server/.env.local for slug ${wt.slug} (slot ${wt.slot})`);
}

const wt = resolveWorktree(serverDir, process.env);
const [cmd, arg] = process.argv.slice(2);

if (cmd === 'create') {
  await withAdmin(async (c) => {
    await createIfMissing(c, wt.database);
    await createIfMissing(c, wt.testDatabase);
  });
} else if (cmd === 'env') {
  writeEnv(wt);
} else if (cmd === 'migcheck' && (arg === 'up' || arg === 'drop')) {
  const name = `${wt.database}_migcheck`;
  await withAdmin(async (c) => {
    if (arg === 'up') {
      await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
      await createIfMissing(c, name);
    } else {
      await c.query(`DROP DATABASE IF EXISTS ${ident(name)} WITH (FORCE)`);
      console.log(`dropped ${name}`);
    }
  });
} else {
  console.error('usage: db.mjs create | env | migcheck <up|drop>');
  process.exit(2);
}
