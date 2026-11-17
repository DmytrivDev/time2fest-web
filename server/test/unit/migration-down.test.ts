import { describe, expect, it } from 'vitest';
import { fixMigrationDown } from '../../scripts/lib/migrationDown.mjs';

const MIGRATION = `import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql\`
  ALTER TABLE "a" DROP CONSTRAINT "a_fk";
  DROP INDEX "a_idx";\`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql\`
  DROP TABLE "x" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_x_fk";
  DROP INDEX "payload_locked_documents_rels_x_id_idx";
  DROP INDEX IF EXISTS "already_idx";
  ALTER TABLE "admins" DROP COLUMN "role";\`)
}
`;

describe('fixMigrationDown', () => {
  it('adds IF EXISTS to DROP CONSTRAINT / DROP INDEX inside down only', () => {
    const { text, changed } = fixMigrationDown(MIGRATION);
    expect(changed).toBe(2);
    const [up, down] = text.split('export async function down');
    expect(up).toBe(MIGRATION.split('export async function down')[0]);
    expect(down).toContain('DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_x_fk"');
    expect(down).toContain('DROP INDEX IF EXISTS "payload_locked_documents_rels_x_id_idx"');
    expect(down).toContain('DROP INDEX IF EXISTS "already_idx"');
    expect(down).not.toContain('IF EXISTS IF EXISTS');
    expect(down).toContain('DROP TABLE "x" CASCADE');
    expect(down).toContain('DROP COLUMN "role"');
  });

  it('is idempotent', () => {
    const once = fixMigrationDown(MIGRATION).text;
    const twice = fixMigrationDown(once);
    expect(twice.changed).toBe(0);
    expect(twice.text).toBe(once);
  });

  it('leaves a file without a down function unchanged', () => {
    const src = 'export async function up() { DROP INDEX "x"; }';
    expect(fixMigrationDown(src)).toEqual({ text: src, changed: 0 });
  });
});
