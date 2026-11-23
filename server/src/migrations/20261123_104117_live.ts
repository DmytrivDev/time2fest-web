import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_stream_sources_platform" AS ENUM('youtube', 'iframe-official', 'hls', 'none');
  CREATE TYPE "public"."enum_stream_sources_override" AS ENUM('live', 'ended', 'hidden');
  CREATE TABLE "live_quota" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"day" varchar NOT NULL,
  	"bucket" varchar NOT NULL,
  	"used" numeric DEFAULT 0 NOT NULL,
  	"alarm80_at" timestamp(3) with time zone,
  	"exceeded_until" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "stream_sources" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"source_id" varchar NOT NULL,
  	"event_id" varchar NOT NULL,
  	"platform" "enum_stream_sources_platform" DEFAULT 'youtube' NOT NULL,
  	"kind" varchar,
  	"label" varchar,
  	"name" varchar,
  	"order" numeric DEFAULT 0 NOT NULL,
  	"starts_at" timestamp(3) with time zone,
  	"status" varchar,
  	"embeddable" boolean,
  	"privacy_status" varchar,
  	"live_broadcast_content" varchar,
  	"scheduled_start_time" timestamp(3) with time zone,
  	"actual_start_time" timestamp(3) with time zone,
  	"actual_end_time" timestamp(3) with time zone,
  	"yt_fetched_at" timestamp(3) with time zone,
  	"last_checked" timestamp(3) with time zone,
  	"next_off_window_check_at" timestamp(3) with time zone,
  	"override" "enum_stream_sources_override",
  	"hidden" boolean DEFAULT false,
  	"hidden_reason" varchar,
  	"dead" boolean DEFAULT false,
  	"dead_reason" varchar,
  	"long_news" boolean DEFAULT false,
  	"rights" varchar,
  	"evidence" varchar,
  	"geo" jsonb,
  	"admin_edited_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "live_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version" numeric DEFAULT 1 NOT NULL,
  	"at" timestamp(3) with time zone,
  	"last_fanned_out" numeric DEFAULT 0,
  	"zone_live" jsonb,
  	"pending_checks" jsonb,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "site_state" ALTER COLUMN "switches" SET DEFAULT '{"chat":true,"toasts":true,"pass":true,"passGift":true,"payments":true,"viewersMap":true,"viewersCount":true,"passOffer":true,"chatRooms":{},"toastTiers":{"2":true,"5":true,"10":true}}'::jsonb;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "live_quota_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stream_sources_id" integer;
  CREATE INDEX "live_quota_day_idx" ON "live_quota" USING btree ("day");
  CREATE INDEX "live_quota_updated_at_idx" ON "live_quota" USING btree ("updated_at");
  CREATE INDEX "live_quota_created_at_idx" ON "live_quota" USING btree ("created_at");
  CREATE UNIQUE INDEX "day_bucket_idx" ON "live_quota" USING btree ("day","bucket");
  CREATE UNIQUE INDEX "stream_sources_source_id_idx" ON "stream_sources" USING btree ("source_id");
  CREATE INDEX "stream_sources_event_id_idx" ON "stream_sources" USING btree ("event_id");
  CREATE INDEX "stream_sources_updated_at_idx" ON "stream_sources" USING btree ("updated_at");
  CREATE INDEX "stream_sources_created_at_idx" ON "stream_sources" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_live_quota_fk" FOREIGN KEY ("live_quota_id") REFERENCES "public"."live_quota"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stream_sources_fk" FOREIGN KEY ("stream_sources_id") REFERENCES "public"."stream_sources"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_live_quota_id_idx" ON "payload_locked_documents_rels" USING btree ("live_quota_id");
  CREATE INDEX "payload_locked_documents_rels_stream_sources_id_idx" ON "payload_locked_documents_rels" USING btree ("stream_sources_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "live_quota" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "stream_sources" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "live_state" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "live_quota" CASCADE;
  DROP TABLE "stream_sources" CASCADE;
  DROP TABLE "live_state" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_live_quota_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_stream_sources_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_live_quota_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_stream_sources_id_idx";
  ALTER TABLE "site_state" ALTER COLUMN "switches" SET DEFAULT '{"chat":true,"toasts":true,"pass":true,"passGift":true,"payments":true,"viewersMap":true,"passOffer":true,"chatRooms":{},"toastTiers":{"2":true,"5":true,"10":true}}'::jsonb;
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "live_quota_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stream_sources_id";
  DROP TYPE "public"."enum_stream_sources_platform";
  DROP TYPE "public"."enum_stream_sources_override";`)
}
