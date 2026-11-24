import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "stream_candidates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"video_id" varchar NOT NULL,
  	"channel_id" varchar,
  	"found_by" jsonb,
  	"live_broadcast_content" varchar,
  	"scheduled_start_time" timestamp(3) with time zone,
  	"embeddable" boolean,
  	"privacy_status" varchar,
  	"yt_fetched_at" timestamp(3) with time zone,
  	"checked_at" timestamp(3) with time zone,
  	"event_id" varchar,
  	"source_id" varchar,
  	"state" varchar DEFAULT 'new' NOT NULL,
  	"reason" varchar,
  	"state_changed_at" timestamp(3) with time zone,
  	"state_changed_by" varchar,
  	"evidence_url" varchar,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "stream_channels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"channel_id" varchar NOT NULL,
  	"uploads_playlist_id" varchar,
  	"uploads_fetched_at" timestamp(3) with time zone,
  	"name" varchar NOT NULL,
  	"kind" varchar NOT NULL,
  	"zones" jsonb,
  	"seasons" jsonb,
  	"priority" numeric DEFAULT 3 NOT NULL,
  	"state" varchar DEFAULT 'watched' NOT NULL,
  	"blacklisted" boolean DEFAULT false,
  	"blacklist_reason" varchar,
  	"blacklist_source" varchar,
  	"proposed_by" varchar,
  	"admin_edited_at" timestamp(3) with time zone,
  	"last_playlist_at" timestamp(3) with time zone,
  	"last_search_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stream_candidates_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "stream_channels_id" integer;
  CREATE UNIQUE INDEX "stream_candidates_video_id_idx" ON "stream_candidates" USING btree ("video_id");
  CREATE INDEX "stream_candidates_channel_id_idx" ON "stream_candidates" USING btree ("channel_id");
  CREATE INDEX "stream_candidates_state_idx" ON "stream_candidates" USING btree ("state");
  CREATE INDEX "stream_candidates_updated_at_idx" ON "stream_candidates" USING btree ("updated_at");
  CREATE INDEX "stream_candidates_created_at_idx" ON "stream_candidates" USING btree ("created_at");
  CREATE UNIQUE INDEX "stream_channels_channel_id_idx" ON "stream_channels" USING btree ("channel_id");
  CREATE INDEX "stream_channels_state_idx" ON "stream_channels" USING btree ("state");
  CREATE INDEX "stream_channels_updated_at_idx" ON "stream_channels" USING btree ("updated_at");
  CREATE INDEX "stream_channels_created_at_idx" ON "stream_channels" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stream_candidates_fk" FOREIGN KEY ("stream_candidates_id") REFERENCES "public"."stream_candidates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stream_channels_fk" FOREIGN KEY ("stream_channels_id") REFERENCES "public"."stream_channels"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_stream_candidates_id_idx" ON "payload_locked_documents_rels" USING btree ("stream_candidates_id");
  CREATE INDEX "payload_locked_documents_rels_stream_channels_id_idx" ON "payload_locked_documents_rels" USING btree ("stream_channels_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "stream_candidates" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "stream_channels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "stream_candidates" CASCADE;
  DROP TABLE "stream_channels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_stream_candidates_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_stream_channels_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_stream_candidates_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_stream_channels_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stream_candidates_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "stream_channels_id";`)
}
