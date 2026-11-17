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
