import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_alarm_deliveries_kind" AS ENUM('alarm', 'heartbeat', 'digest', 'storm-summary');
  CREATE TYPE "public"."enum_alarm_deliveries_status" AS ENUM('pending', 'delivered', 'failed');
  CREATE TYPE "public"."enum_backup_runs_kind" AS ENUM('daily', 'hourly', 'manual');
  CREATE TYPE "public"."enum_backup_runs_result" AS ENUM('ok', 'failed');
  CREATE TYPE "public"."enum_restore_runs_result" AS ENUM('ok', 'failed');
  CREATE TABLE "alarm_deliveries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"kind" "enum_alarm_deliveries_kind" DEFAULT 'alarm' NOT NULL,
  	"slot_key" varchar,
  	"source" varchar,
  	"code" varchar,
  	"level" varchar,
  	"domain" varchar,
  	"text" varchar NOT NULL,
  	"details" jsonb,
  	"status" "enum_alarm_deliveries_status" DEFAULT 'pending' NOT NULL,
  	"attempts" numeric DEFAULT 0 NOT NULL,
  	"next_attempt_at" timestamp(3) with time zone,
  	"delivered_at" timestamp(3) with time zone,
  	"failed_at" timestamp(3) with time zone,
  	"last_status" numeric,
  	"repeat_count" numeric DEFAULT 0 NOT NULL,
  	"raised_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "backup_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"kind" "enum_backup_runs_kind" NOT NULL,
  	"result" "enum_backup_runs_result" NOT NULL,
  	"stage" varchar,
  	"size" numeric,
  	"sha256" varchar,
  	"duration_ms" numeric,
  	"snapshot_at" timestamp(3) with time zone,
  	"key_id" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "log_alarms" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"domain" varchar,
  	"details" jsonb,
  	"raised_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "restore_runs" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"at" timestamp(3) with time zone NOT NULL,
  	"key" varchar NOT NULL,
  	"duration_ms" numeric,
  	"loss_window_ms" numeric,
  	"result" "enum_restore_runs_result" NOT NULL,
  	"target" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "spend_counters" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"row" varchar NOT NULL,
  	"period" varchar NOT NULL,
  	"amount_micros" numeric DEFAULT 0 NOT NULL,
  	"class_a" numeric DEFAULT 0,
  	"class_b" numeric DEFAULT 0,
  	"storage_bytes" numeric DEFAULT 0,
  	"alarm50_at" timestamp(3) with time zone,
  	"alarm80_at" timestamp(3) with time zone,
  	"meta" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "ops_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"server_base_usd" numeric DEFAULT 12,
  	"server_ceiling_usd" numeric DEFAULT 40,
  	"cloudflare_ceiling_usd" numeric DEFAULT 10,
  	"mail_ceiling_usd" numeric DEFAULT 10,
  	"price_storage_per_gb_usd" numeric DEFAULT 0.015,
  	"price_class_a_per_million_usd" numeric DEFAULT 4.5,
  	"price_class_b_per_million_usd" numeric DEFAULT 0.36,
  	"free_class_a" numeric DEFAULT 1000000,
  	"free_class_b" numeric DEFAULT 10000000,
  	"free_storage_gb" numeric DEFAULT 10,
  	"heartbeat_minute" numeric DEFAULT 0,
  	"digest_time" varchar DEFAULT '09:00',
  	"version" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "alarms" ADD COLUMN "details" jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "alarm_deliveries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "backup_runs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "log_alarms_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "restore_runs_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "spend_counters_id" integer;
  CREATE UNIQUE INDEX "alarm_deliveries_slot_key_idx" ON "alarm_deliveries" USING btree ("slot_key");
  CREATE INDEX "alarm_deliveries_next_attempt_at_idx" ON "alarm_deliveries" USING btree ("next_attempt_at");
  CREATE INDEX "alarm_deliveries_updated_at_idx" ON "alarm_deliveries" USING btree ("updated_at");
  CREATE INDEX "alarm_deliveries_created_at_idx" ON "alarm_deliveries" USING btree ("created_at");
  CREATE INDEX "backup_runs_snapshot_at_idx" ON "backup_runs" USING btree ("snapshot_at");
  CREATE INDEX "backup_runs_updated_at_idx" ON "backup_runs" USING btree ("updated_at");
  CREATE INDEX "backup_runs_created_at_idx" ON "backup_runs" USING btree ("created_at");
  CREATE INDEX "log_alarms_raised_at_idx" ON "log_alarms" USING btree ("raised_at");
  CREATE INDEX "log_alarms_updated_at_idx" ON "log_alarms" USING btree ("updated_at");
  CREATE INDEX "log_alarms_created_at_idx" ON "log_alarms" USING btree ("created_at");
  CREATE INDEX "restore_runs_at_idx" ON "restore_runs" USING btree ("at");
  CREATE INDEX "restore_runs_updated_at_idx" ON "restore_runs" USING btree ("updated_at");
  CREATE INDEX "restore_runs_created_at_idx" ON "restore_runs" USING btree ("created_at");
  CREATE INDEX "spend_counters_updated_at_idx" ON "spend_counters" USING btree ("updated_at");
  CREATE INDEX "spend_counters_created_at_idx" ON "spend_counters" USING btree ("created_at");
  CREATE UNIQUE INDEX "row_period_idx" ON "spend_counters" USING btree ("row","period");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_alarm_deliveries_fk" FOREIGN KEY ("alarm_deliveries_id") REFERENCES "public"."alarm_deliveries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_backup_runs_fk" FOREIGN KEY ("backup_runs_id") REFERENCES "public"."backup_runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_log_alarms_fk" FOREIGN KEY ("log_alarms_id") REFERENCES "public"."log_alarms"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_restore_runs_fk" FOREIGN KEY ("restore_runs_id") REFERENCES "public"."restore_runs"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_spend_counters_fk" FOREIGN KEY ("spend_counters_id") REFERENCES "public"."spend_counters"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_alarm_deliveries_id_idx" ON "payload_locked_documents_rels" USING btree ("alarm_deliveries_id");
  CREATE INDEX "payload_locked_documents_rels_backup_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("backup_runs_id");
  CREATE INDEX "payload_locked_documents_rels_log_alarms_id_idx" ON "payload_locked_documents_rels" USING btree ("log_alarms_id");
  CREATE INDEX "payload_locked_documents_rels_restore_runs_id_idx" ON "payload_locked_documents_rels" USING btree ("restore_runs_id");
  CREATE INDEX "payload_locked_documents_rels_spend_counters_id_idx" ON "payload_locked_documents_rels" USING btree ("spend_counters_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "alarm_deliveries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "backup_runs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "log_alarms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "restore_runs" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "spend_counters" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "ops_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "alarm_deliveries" CASCADE;
  DROP TABLE "backup_runs" CASCADE;
  DROP TABLE "log_alarms" CASCADE;
  DROP TABLE "restore_runs" CASCADE;
  DROP TABLE "spend_counters" CASCADE;
  DROP TABLE "ops_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_alarm_deliveries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_backup_runs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_log_alarms_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_restore_runs_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_spend_counters_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_alarm_deliveries_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_backup_runs_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_log_alarms_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_restore_runs_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_spend_counters_id_idx";
  ALTER TABLE "alarms" DROP COLUMN "details";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "alarm_deliveries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "backup_runs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "log_alarms_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "restore_runs_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "spend_counters_id";
  DROP TYPE "public"."enum_alarm_deliveries_kind";
  DROP TYPE "public"."enum_alarm_deliveries_status";
  DROP TYPE "public"."enum_backup_runs_kind";
  DROP TYPE "public"."enum_backup_runs_result";
  DROP TYPE "public"."enum_restore_runs_result";`)
}
