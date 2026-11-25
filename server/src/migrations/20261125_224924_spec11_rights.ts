import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// SPEC-11 [П-1]: raw SQL tables next to the Better Auth tables (precedent: spec10_auth). Hand-written DDL —
// Payload collections cannot declare partial unique indexes; named in plan item W8. Expand-only: new tables
// plus one unique index on `user_accounts`; no existing column is altered or dropped. No IP/fingerprint column.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
  CREATE TABLE "passes" (
    "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
    "season" text NOT NULL CHECK ("season" ~ '^[0-9]{4}-[0-9]{2}$'),
    "source" text NOT NULL CHECK ("source" IN ('purchase', 'gift', 'admin')),
    "grant_ref" text NOT NULL,
    "payment_email" text,
    "device_id" text,
    "attached_user_id" uuid,
    "issued_at" timestamptz NOT NULL,
    "attached_at" timestamptz,
    "revoked_at" timestamptz,
    "erased_at" timestamptz
  );
  CREATE UNIQUE INDEX "passes_grant_ref_uq" ON "passes" ("grant_ref");
  CREATE UNIQUE INDEX "passes_one_active_per_account" ON "passes" ("attached_user_id", "season")
    WHERE "attached_user_id" IS NOT NULL AND "revoked_at" IS NULL AND "erased_at" IS NULL;
  CREATE INDEX "passes_device_unattached" ON "passes" ("device_id")
    WHERE "attached_user_id" IS NULL AND "revoked_at" IS NULL AND "erased_at" IS NULL;
  CREATE INDEX "passes_email_unattached" ON "passes" ("payment_email", "issued_at")
    WHERE "attached_user_id" IS NULL AND "revoked_at" IS NULL AND "erased_at" IS NULL;
  CREATE INDEX "passes_attached_user_id_idx" ON "passes" ("attached_user_id");

  CREATE TABLE "bans" (
    "id" uuid DEFAULT pg_catalog.gen_random_uuid() NOT NULL PRIMARY KEY,
    "kind" text NOT NULL CHECK ("kind" IN ('account', 'guest', 'device')),
    "subject_id" text NOT NULL,
    "source_ban_id" uuid REFERENCES "bans" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL,
    "created_by" text NOT NULL,
    "reason_code" text CHECK (length("reason_code") <= 64)
  );
  CREATE UNIQUE INDEX "bans_kind_subject_uq" ON "bans" ("kind", "subject_id");
  CREATE INDEX "bans_source_ban_id_idx" ON "bans" ("source_ban_id");

  CREATE TABLE "profiles" (
    "subject_id" text NOT NULL PRIMARY KEY,
    "nick" text,
    "nick_key" text,
    "flag_code" text,
    "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "schedule" text[] DEFAULT '{}'::text[] NOT NULL,
    "updated_at" timestamptz NOT NULL
  );
  CREATE UNIQUE INDEX "profiles_nick_key_uq" ON "profiles" ("nick_key") WHERE "nick_key" IS NOT NULL;

  CREATE UNIQUE INDEX "user_accounts_provider_account_uq" ON "user_accounts" ("provider_id", "account_id");`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
  DROP INDEX IF EXISTS "user_accounts_provider_account_uq";
  DROP TABLE IF EXISTS "profiles";
  DROP TABLE IF EXISTS "bans";
  DROP TABLE IF EXISTS "passes";`),
  )
}
