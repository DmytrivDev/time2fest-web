/**
 * `export catalog` (AC-82, AC-83, W33): the imported catalog goes back to the data files byte for byte;
 * a `dawn` event does not appear; without `--write` nothing changes; `--write` over a modified target is
 * refused. Everything is written to a temp directory, never to `data/`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportCatalog, type ExportFile, type ExportPorts } from '../../src/catalog/export';
import { readCatalog } from '../../src/catalog/service';
import { catalogStoreOf, payloadOf } from '../../src/container';
import { gitDirty } from '../../src/cli/export';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { IMPORT_CONTEXT, KINDS } from './catalog-helpers';
import { testDeps } from './helpers';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(serverDir, '../data');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const FILES: readonly ExportFile[] = ['schedule.json', 'countries.json'];
const tmpDirs: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-export-'));
  tmpDirs.push(dir);
  return dir;
}

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });

describe('export catalog', { timeout: 600_000 }, () => {
  let deps: Deps;
  let payload: Payload;

  const portsFor = (dir: string, dirty: ExportPorts['dirtyTargets'] = (files) => gitDirty(dir, files)): ExportPorts => ({
    source: () => readCatalog(catalogStoreOf(deps)),
    readTarget: (file) => (fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : undefined),
    writeTarget: (file, text) => fs.writeFileSync(path.join(dir, file), text),
    dirtyTargets: dirty,
  });
  const wipe = async () => {
    for (const kind of [...KINDS].reverse()) {
      await payload.delete({ collection: kind, where: { id: { exists: true } }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    }
  };
  const sameAsData = (dir: string) =>
    FILES.every((f) => Buffer.from(fs.readFileSync(path.join(dir, f))).equals(fs.readFileSync(path.join(dataDir, f))));
  /** Stale targets with the line ending of `data/`, so the export has an existing EOL to follow. */
  const staleTargets = (dir: string) => {
    const crlf = fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8').includes(String.fromCharCode(13, 10));
    const eol = crlf ? String.fromCharCode(13, 10) : String.fromCharCode(10);
    for (const f of FILES) fs.writeFileSync(path.join(dir, f), `{}${eol}`);
  };
  const copyData = (dir: string) => FILES.forEach((f) => fs.copyFileSync(path.join(dataDir, f), path.join(dir, f)));

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await wipe();
    const row = importRegistry.find((r) => r.key === 'catalog');
    if (!row) throw new Error('registry: no catalog row');
    const result = await row.run({
      apply: true,
      deps,
      readSource: (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')),
    });
    if (result.code !== 0) throw new Error(`import failed: ${result.lines.slice(0, 3).join(' | ')}`);
  }, 600_000);

  afterAll(async () => {
    await wipe();
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  }, 300_000);

  it('AC-82: import then export gives both data files byte for byte', async () => {
    const out = tmp();
    staleTargets(out);
    const result = await exportCatalog(portsFor(out), { write: true });
    expect(result.code).toBe(0);
    expect(result.changed).toEqual(['schedule.json', 'countries.json']);
    expect(sameAsData(out)).toBe(true);
  });

  it('AC-82: an event of another slot (dawn) leaves the files unchanged', async () => {
    const city = (await payload.find({ collection: 'cities', where: { cityId: { equals: 'auckland' } }, overrideAccess: true, depth: 0 })).docs[0] as unknown as
      | { cityId: string; zoneId: string; countryIso: string }
      | undefined;
    if (!city) throw new Error('fixture: auckland');
    const created = await payload.create({
      collection: 'events',
      data: {
        eventId: 'auckland-dawn-export-test',
        cityId: city.cityId,
        zoneId: city.zoneId,
        countryIso: city.countryIso,
        midnightUtc: '2026-12-31T11:00:00Z',
        slot: 'dawn',
        startsAt: '2027-01-01T05:00:00Z',
      } as never,
      overrideAccess: true,
      context: IMPORT_CONTEXT,
    });
    try {
      const out = tmp();
      staleTargets(out);
      expect((await exportCatalog(portsFor(out), { write: true })).code).toBe(0);
      expect(sameAsData(out)).toBe(true);
    } finally {
      await payload.delete({ collection: 'events', id: created.id, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    }
  });

  it('AC-83: without --write the changed files are listed and nothing is written', async () => {
    const out = tmp();
    copyData(out);
    const countries = JSON.parse(fs.readFileSync(path.join(out, 'countries.json'), 'utf8'));
    countries.countries[0].popularity = 999;
    fs.writeFileSync(path.join(out, 'countries.json'), JSON.stringify(countries, null, 2));
    const before = FILES.map((f) => fs.readFileSync(path.join(out, f), 'utf8'));
    const result = await exportCatalog(portsFor(out), { write: false });
    expect(result.code).toBe(0);
    expect(result.written).toBe(false);
    expect(result.changed).toEqual(['countries.json']);
    expect(result.lines.join('\n')).toContain('countries.json');
    expect(FILES.map((f) => fs.readFileSync(path.join(out, f), 'utf8'))).toEqual(before);
  });

  it('AC-83: --write over a git repo with a modified target is refused (exit 3) and the file stays', async () => {
    const repo = tmp();
    copyData(repo);
    expect(git(repo, 'init').status).toBe(0);
    expect(git(repo, 'add', '.').status).toBe(0);
    expect(git(repo, 'commit', '-m', 'base').status).toBe(0);
    // An uncommitted edit of a target the export would change.
    const countries = JSON.parse(fs.readFileSync(path.join(repo, 'countries.json'), 'utf8'));
    countries.countries[0].popularity = 999;
    const edited = JSON.stringify(countries, null, 2);
    fs.writeFileSync(path.join(repo, 'countries.json'), edited);
    const refused = await exportCatalog(portsFor(repo), { write: true });
    expect(refused.code).toBe(3);
    expect(refused.lines.join('\n')).toContain('countries.json');
    expect(fs.readFileSync(path.join(repo, 'countries.json'), 'utf8')).toBe(edited);

    // The same refusal through the command line: exit status 3 and the reason on stderr.
    const env: NodeJS.ProcessEnv = { ...process.env };
    const cli = spawnSync(process.execPath, [tsx, 'src/cli/export.ts', 'catalog', '--from', 'db', '--out', repo, '--write'], {
      cwd: serverDir,
      env,
      encoding: 'utf8',
      timeout: 180_000,
    });
    expect(cli.status, `${cli.stderr}`.slice(0, 400)).toBe(3);
    expect(cli.stderr).toContain('uncommitted');

    // A clean tree is written, byte for byte.
    fs.copyFileSync(path.join(dataDir, 'countries.json'), path.join(repo, 'countries.json'));
    staleTargets(repo);
    git(repo, 'commit', '-am', 'stale');
    const written = await exportCatalog(portsFor(repo), { write: true });
    expect(written.code).toBe(0);
    expect(written.written).toBe(true);
    expect(sameAsData(repo)).toBe(true);
  });
});
