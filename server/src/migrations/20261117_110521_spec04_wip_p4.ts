import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_alarms_level" AS ENUM('page');
  CREATE TYPE "public"."enum_audit_log_actor_kind" AS ENUM('owner', 'agent', 'system');
  CREATE TABLE "alarms" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source" varchar NOT NULL,
  	"code" varchar NOT NULL,
  	"level" "enum_alarms_level" DEFAULT 'page' NOT NULL,
  	"raised_at" timestamp(3) with time zone NOT NULL,
  	"acknowledged_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "audit_log" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"actor_kind" "enum_audit_log_actor_kind" NOT NULL,
  	"actor_ref" varchar NOT NULL,
  	"actor_label" varchar NOT NULL,
  	"action" varchar NOT NULL,
  	"target_collection" varchar NOT NULL,
  	"target_ref" varchar NOT NULL,
  	"at" timestamp(3) with time zone NOT NULL,
  	"before" jsonb,
  	"after" jsonb,
  	"revert_of" varchar,
  	"revertible" boolean DEFAULT false NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "internal_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"topic" varchar NOT NULL,
  	"version" numeric NOT NULL,
  	"payload" jsonb,
  	"committed_at" timestamp(3) with time zone NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "alarms_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_log_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "internal_events_id" integer;
  CREATE INDEX "alarms_raised_at_idx" ON "alarms" USING btree ("raised_at");
  CREATE INDEX "alarms_acknowledged_at_idx" ON "alarms" USING btree ("acknowledged_at");
  CREATE INDEX "alarms_updated_at_idx" ON "alarms" USING btree ("updated_at");
  CREATE INDEX "alarms_created_at_idx" ON "alarms" USING btree ("created_at");
  CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");
  CREATE INDEX "audit_log_target_target_collection_idx" ON "audit_log" USING btree ("target_collection");
  CREATE INDEX "audit_log_target_target_ref_idx" ON "audit_log" USING btree ("target_ref");
  CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");
  CREATE INDEX "audit_log_revert_of_idx" ON "audit_log" USING btree ("revert_of");
  CREATE INDEX "audit_log_updated_at_idx" ON "audit_log" USING btree ("updated_at");
  CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("created_at");
  CREATE INDEX "internal_events_topic_idx" ON "internal_events" USING btree ("topic");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_alarms_fk" FOREIGN KEY ("alarms_id") REFERENCES "public"."alarms"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_internal_events_fk" FOREIGN KEY ("internal_events_id") REFERENCES "public"."internal_events"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_alarms_id_idx" ON "payload_locked_documents_rels" USING btree ("alarms_id");
  CREATE INDEX "payload_locked_documents_rels_audit_log_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_log_id");
  CREATE INDEX "payload_locked_documents_rels_internal_events_id_idx" ON "payload_locked_documents_rels" USING btree ("internal_events_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "alarms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "internal_events" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "alarms" CASCADE;
  DROP TABLE "audit_log" CASCADE;
  DROP TABLE "internal_events" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_alarms_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_audit_log_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_internal_events_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_alarms_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_audit_log_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_internal_events_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "alarms_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "audit_log_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "internal_events_id";
  DROP TYPE "public"."enum_alarms_level";
  DROP TYPE "public"."enum_audit_log_actor_kind";`)
}
