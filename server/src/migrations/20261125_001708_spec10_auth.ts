import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "auth_link_retries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"user_id" varchar NOT NULL,
  	"from_subject" varchar NOT NULL,
  	"handler" varchar NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_at" timestamp(3) with time zone NOT NULL,
  	"last_error_code" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "auth_link_retries_id" integer;
  CREATE INDEX "auth_link_retries_user_id_idx" ON "auth_link_retries" USING btree ("user_id");
  CREATE INDEX "auth_link_retries_updated_at_idx" ON "auth_link_retries" USING btree ("updated_at");
  CREATE INDEX "auth_link_retries_created_at_idx" ON "auth_link_retries" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_auth_link_retries_fk" FOREIGN KEY ("auth_link_retries_id") REFERENCES "public"."auth_link_retries"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_auth_link_retries_id_idx" ON "payload_locked_documents_rels" USING btree ("auth_link_retries_id");

  -- Better Auth tables: verbatim output of npx auth@1.7.28 generate --config src/auth/cli.config.ts (SPEC-10 [П-4])
  create table "users" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "email_verified" boolean not null, "image" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null, "is_anonymous" boolean, "device_id" text);

  create table "user_sessions" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expires_at" timestamptz not null, "token" text not null unique, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null, "ip_address" text, "user_agent" text, "user_id" uuid not null references "users" ("id") on delete cascade, "device_id" text);

  create table "user_accounts" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "account_id" text not null, "provider_id" text not null, "user_id" uuid not null references "users" ("id") on delete cascade, "access_token" text, "refresh_token" text, "id_token" text, "access_token_expires_at" timestamptz, "refresh_token_expires_at" timestamptz, "scope" text, "password" text, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz not null);

  create table "auth_verifications" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expires_at" timestamptz not null, "created_at" timestamptz default CURRENT_TIMESTAMP not null, "updated_at" timestamptz default CURRENT_TIMESTAMP not null);

  create index "user_sessions_user_id_idx" on "user_sessions" ("user_id");

  create index "user_accounts_user_id_idx" on "user_accounts" ("user_id");

  create index "auth_verifications_identifier_idx" on "auth_verifications" ("identifier");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE IF EXISTS "user_sessions", "user_accounts", "auth_verifications", "users";
  ALTER TABLE "auth_link_retries" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "auth_link_retries" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_auth_link_retries_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_auth_link_retries_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "auth_link_retries_id";`)
}
