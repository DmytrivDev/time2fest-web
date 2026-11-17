import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_unattended_state_cause" AS ENUM('schedule', 'manual', 'alarm');
  CREATE TABLE "unattended_windows" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"starts_at_kyiv" varchar NOT NULL,
  	"ends_at_kyiv" varchar NOT NULL,
  	"starts_at" timestamp(3) with time zone NOT NULL,
  	"ends_at" timestamp(3) with time zone NOT NULL,
  	"label" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "unattended_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"on" boolean DEFAULT false,
  	"cause" "enum_unattended_state_cause",
  	"manual_at" timestamp(3) with time zone,
  	"version" numeric DEFAULT 0,
  	"changed_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "unattended_windows_id" integer;
  CREATE INDEX "unattended_windows_starts_at_idx" ON "unattended_windows" USING btree ("starts_at");
  CREATE INDEX "unattended_windows_updated_at_idx" ON "unattended_windows" USING btree ("updated_at");
  CREATE INDEX "unattended_windows_created_at_idx" ON "unattended_windows" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_unattended_windows_fk" FOREIGN KEY ("unattended_windows_id") REFERENCES "public"."unattended_windows"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_unattended_windows_id_idx" ON "payload_locked_documents_rels" USING btree ("unattended_windows_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "unattended_windows" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "unattended_state" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "unattended_windows" CASCADE;
  DROP TABLE "unattended_state" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_unattended_windows_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_unattended_windows_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "unattended_windows_id";
  DROP TYPE "public"."enum_unattended_state_cause";`)
}
