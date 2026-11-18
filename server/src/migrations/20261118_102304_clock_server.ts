import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_scheduler_runs_status" AS ENUM('started', 'done', 'skipped', 'failed');
  CREATE TABLE "run_records" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"consequence_id" varchar NOT NULL,
  	"keys" jsonb,
  	"action" varchar NOT NULL,
  	"run_epoch" numeric NOT NULL,
  	"planned_at" numeric NOT NULL,
  	"started_at" numeric NOT NULL,
  	"at" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "scheduler_leases" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"holder" varchar NOT NULL,
  	"epoch" numeric DEFAULT 0 NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"renewed_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "scheduler_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"run_epoch" numeric NOT NULL,
  	"action" varchar NOT NULL,
  	"moment_key" varchar NOT NULL,
  	"status" "enum_scheduler_runs_status" NOT NULL,
  	"consequence_id" varchar,
  	"lease_epoch" numeric,
  	"planned_at" numeric,
  	"started_at" numeric,
  	"finished_at" numeric,
  	"reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "clock_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"virtual" boolean DEFAULT false,
  	"anchor_virtual" numeric,
  	"anchor_real" numeric,
  	"speed" numeric DEFAULT 1,
  	"frozen" boolean DEFAULT false,
  	"run_epoch" numeric DEFAULT 0,
  	"seq" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "run_records_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "scheduler_leases_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "scheduler_runs_id" integer;
  CREATE UNIQUE INDEX "run_records_consequence_id_idx" ON "run_records" USING btree ("consequence_id");
  CREATE INDEX "run_records_updated_at_idx" ON "run_records" USING btree ("updated_at");
  CREATE INDEX "run_records_created_at_idx" ON "run_records" USING btree ("created_at");
  CREATE UNIQUE INDEX "scheduler_leases_name_idx" ON "scheduler_leases" USING btree ("name");
  CREATE INDEX "scheduler_leases_updated_at_idx" ON "scheduler_leases" USING btree ("updated_at");
  CREATE INDEX "scheduler_leases_created_at_idx" ON "scheduler_leases" USING btree ("created_at");
  CREATE INDEX "scheduler_runs_updated_at_idx" ON "scheduler_runs" USING btree ("updated_at");
  CREATE INDEX "scheduler_runs_created_at_idx" ON "scheduler_runs" USING btree ("created_at");
  CREATE UNIQUE INDEX "runEpoch_action_momentKey_idx" ON "scheduler_runs" USING btree ("run_epoch","action","moment_key");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_run_records_fk" FOREIGN KEY ("run_records_id") REFERENCES "public"."run_records"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_scheduler_leases_fk" FOREIGN KEY ("scheduler_leases_id") REFERENCES "public"."scheduler_leases"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_scheduler_runs_fk" FOREIGN KEY ("scheduler_runs_id") REFERENCES "public"."scheduler_runs"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_run_records_id_idx" ON "payload_locked_documents_rels" USING btree ("run_records_id");
  CREATE INDEX "payload_locked_documents_rels_scheduler_leases_id_idx" ON "payload_locked_documents_rels" USING btree ("scheduler_leases_id");
  CREATE INDEX "payload_locked_documents_rels_scheduler_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("scheduler_runs_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "run_records" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "scheduler_leases" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "scheduler_runs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "clock_state" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "run_records" CASCADE;
  DROP TABLE "scheduler_leases" CASCADE;
  DROP TABLE "scheduler_runs" CASCADE;
  DROP TABLE "clock_state" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_run_records_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_scheduler_leases_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_scheduler_runs_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_run_records_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_scheduler_leases_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_scheduler_runs_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "run_records_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "scheduler_leases_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "scheduler_runs_id";
  DROP TYPE "public"."enum_scheduler_runs_status";`)
}
