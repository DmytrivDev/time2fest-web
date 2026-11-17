import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_admins_role" AS ENUM('owner', 'content-agent', 'stream-agent');
  CREATE TYPE "public"."enum_agent_test_posts_status" AS ENUM('draft', 'published', 'proposal');
  CREATE TYPE "public"."enum_alarms_level" AS ENUM('page');
  CREATE TYPE "public"."enum_audit_log_actor_kind" AS ENUM('owner', 'agent', 'system');
  CREATE TYPE "public"."enum_countries_gender" AS ENUM('m', 'f', 'n', 'pl');
  CREATE TYPE "public"."enum_events_slot" AS ENUM('midnight', 'fireworks-20', 'dawn', 'jan-1');
  CREATE TYPE "public"."enum_unattended_state_cause" AS ENUM('schedule', 'manual', 'alarm');
  CREATE TABLE "agent_test_posts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"status" "enum_agent_test_posts_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
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
  
  CREATE TABLE "cities" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"city_id" varchar NOT NULL,
  	"country_iso" varchar NOT NULL,
  	"zone_id" varchar NOT NULL,
  	"name_uk" varchar NOT NULL,
  	"name_en" varchar,
  	"name_es" varchar,
  	"name_fr" varchar,
  	"landmark_uk" varchar,
  	"landmark_en" varchar,
  	"landmark_es" varchar,
  	"landmark_fr" varchar,
  	"celebration_type" varchar,
  	"map_point_x" numeric,
  	"map_point_y" numeric,
  	"is_country_main" boolean DEFAULT false,
  	"sort_index" numeric,
  	"imported_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "countries" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"iso" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"name_uk" varchar NOT NULL,
  	"name_en" varchar,
  	"name_es" varchar,
  	"name_fr" varchar,
  	"gender" "enum_countries_gender",
  	"flag_code" varchar,
  	"zone_ids" jsonb,
  	"illustration_id" varchar,
  	"how_to_text_uk" varchar,
  	"how_to_text_en" varchar,
  	"how_to_text_es" varchar,
  	"how_to_text_fr" varchar,
  	"gallery" jsonb,
  	"popularity" numeric,
  	"sort_index" numeric,
  	"imported_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "event_patches" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"moment" numeric,
  	"is_main_celebration" boolean,
  	"restrained" boolean DEFAULT false,
  	"restrained_note" varchar,
  	"hidden" boolean DEFAULT false,
  	"version" numeric DEFAULT 0 NOT NULL,
  	"topic_version" numeric DEFAULT 0 NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"event_id" varchar NOT NULL,
  	"city_id" varchar NOT NULL,
  	"zone_id" varchar NOT NULL,
  	"country_iso" varchar NOT NULL,
  	"midnight_utc" varchar NOT NULL,
  	"is_main_celebration" boolean DEFAULT false,
  	"type" varchar,
  	"popularity" numeric,
  	"restrained_note_uk" varchar,
  	"restrained_note_en" varchar,
  	"restrained_note_es" varchar,
  	"restrained_note_fr" varchar,
  	"slot" "enum_events_slot" DEFAULT 'midnight' NOT NULL,
  	"starts_at" timestamp(3) with time zone,
  	"sort_index" numeric,
  	"imported_hash" varchar,
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
  
  CREATE TABLE "seasons" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"generated_at" varchar NOT NULL,
  	"tzdb_version" varchar NOT NULL,
  	"imported_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "traditions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"tradition_id" varchar NOT NULL,
  	"country_iso" varchar NOT NULL,
  	"title_uk" varchar NOT NULL,
  	"title_en" varchar,
  	"title_es" varchar,
  	"title_fr" varchar,
  	"text_uk" varchar NOT NULL,
  	"text_en" varchar,
  	"text_es" varchar,
  	"text_fr" varchar,
  	"icon_id" varchar,
  	"sort_index" numeric,
  	"imported_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
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
  
  CREATE TABLE "zones" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"zone_id" varchar NOT NULL,
  	"order" numeric NOT NULL,
  	"offset_minutes" numeric NOT NULL,
  	"midnight_utc" varchar NOT NULL,
  	"representative_city_id" varchar,
  	"imported_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "admin_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"agent_publish" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
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
  
  ALTER TABLE "admins" ADD COLUMN "role" "enum_admins_role" DEFAULT 'owner' NOT NULL;
  ALTER TABLE "admins" ADD COLUMN "enable_a_p_i_key" boolean;
  ALTER TABLE "admins" ADD COLUMN "api_key" varchar;
  ALTER TABLE "admins" ADD COLUMN "api_key_index" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "agent_test_posts_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "alarms_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "audit_log_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "cities_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "countries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_patches_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "internal_events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "seasons_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "traditions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "unattended_windows_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "zones_id" integer;
  CREATE INDEX "agent_test_posts_updated_at_idx" ON "agent_test_posts" USING btree ("updated_at");
  CREATE INDEX "agent_test_posts_created_at_idx" ON "agent_test_posts" USING btree ("created_at");
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
  CREATE UNIQUE INDEX "cities_city_id_idx" ON "cities" USING btree ("city_id");
  CREATE INDEX "cities_country_iso_idx" ON "cities" USING btree ("country_iso");
  CREATE INDEX "cities_zone_id_idx" ON "cities" USING btree ("zone_id");
  CREATE INDEX "cities_updated_at_idx" ON "cities" USING btree ("updated_at");
  CREATE INDEX "cities_created_at_idx" ON "cities" USING btree ("created_at");
  CREATE UNIQUE INDEX "countries_iso_idx" ON "countries" USING btree ("iso");
  CREATE UNIQUE INDEX "countries_slug_idx" ON "countries" USING btree ("slug");
  CREATE INDEX "countries_updated_at_idx" ON "countries" USING btree ("updated_at");
  CREATE INDEX "countries_created_at_idx" ON "countries" USING btree ("created_at");
  CREATE UNIQUE INDEX "event_patches_event_id_idx" ON "event_patches" USING btree ("event_id");
  CREATE INDEX "event_patches_topic_version_idx" ON "event_patches" USING btree ("topic_version");
  CREATE INDEX "event_patches_updated_at_idx" ON "event_patches" USING btree ("updated_at");
  CREATE INDEX "event_patches_created_at_idx" ON "event_patches" USING btree ("created_at");
  CREATE UNIQUE INDEX "events_event_id_idx" ON "events" USING btree ("event_id");
  CREATE INDEX "events_city_id_idx" ON "events" USING btree ("city_id");
  CREATE INDEX "events_zone_id_idx" ON "events" USING btree ("zone_id");
  CREATE INDEX "events_country_iso_idx" ON "events" USING btree ("country_iso");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE INDEX "internal_events_topic_idx" ON "internal_events" USING btree ("topic");
  CREATE UNIQUE INDEX "seasons_key_idx" ON "seasons" USING btree ("key");
  CREATE INDEX "seasons_updated_at_idx" ON "seasons" USING btree ("updated_at");
  CREATE INDEX "seasons_created_at_idx" ON "seasons" USING btree ("created_at");
  CREATE UNIQUE INDEX "traditions_tradition_id_idx" ON "traditions" USING btree ("tradition_id");
  CREATE INDEX "traditions_country_iso_idx" ON "traditions" USING btree ("country_iso");
  CREATE INDEX "traditions_updated_at_idx" ON "traditions" USING btree ("updated_at");
  CREATE INDEX "traditions_created_at_idx" ON "traditions" USING btree ("created_at");
  CREATE INDEX "unattended_windows_starts_at_idx" ON "unattended_windows" USING btree ("starts_at");
  CREATE INDEX "unattended_windows_updated_at_idx" ON "unattended_windows" USING btree ("updated_at");
  CREATE INDEX "unattended_windows_created_at_idx" ON "unattended_windows" USING btree ("created_at");
  CREATE UNIQUE INDEX "zones_zone_id_idx" ON "zones" USING btree ("zone_id");
  CREATE INDEX "zones_updated_at_idx" ON "zones" USING btree ("updated_at");
  CREATE INDEX "zones_created_at_idx" ON "zones" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_agent_test_posts_fk" FOREIGN KEY ("agent_test_posts_id") REFERENCES "public"."agent_test_posts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_alarms_fk" FOREIGN KEY ("alarms_id") REFERENCES "public"."alarms"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_audit_log_fk" FOREIGN KEY ("audit_log_id") REFERENCES "public"."audit_log"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cities_fk" FOREIGN KEY ("cities_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_countries_fk" FOREIGN KEY ("countries_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_patches_fk" FOREIGN KEY ("event_patches_id") REFERENCES "public"."event_patches"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_internal_events_fk" FOREIGN KEY ("internal_events_id") REFERENCES "public"."internal_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_seasons_fk" FOREIGN KEY ("seasons_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_traditions_fk" FOREIGN KEY ("traditions_id") REFERENCES "public"."traditions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_unattended_windows_fk" FOREIGN KEY ("unattended_windows_id") REFERENCES "public"."unattended_windows"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_zones_fk" FOREIGN KEY ("zones_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_agent_test_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("agent_test_posts_id");
  CREATE INDEX "payload_locked_documents_rels_alarms_id_idx" ON "payload_locked_documents_rels" USING btree ("alarms_id");
  CREATE INDEX "payload_locked_documents_rels_audit_log_id_idx" ON "payload_locked_documents_rels" USING btree ("audit_log_id");
  CREATE INDEX "payload_locked_documents_rels_cities_id_idx" ON "payload_locked_documents_rels" USING btree ("cities_id");
  CREATE INDEX "payload_locked_documents_rels_countries_id_idx" ON "payload_locked_documents_rels" USING btree ("countries_id");
  CREATE INDEX "payload_locked_documents_rels_event_patches_id_idx" ON "payload_locked_documents_rels" USING btree ("event_patches_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_internal_events_id_idx" ON "payload_locked_documents_rels" USING btree ("internal_events_id");
  CREATE INDEX "payload_locked_documents_rels_seasons_id_idx" ON "payload_locked_documents_rels" USING btree ("seasons_id");
  CREATE INDEX "payload_locked_documents_rels_traditions_id_idx" ON "payload_locked_documents_rels" USING btree ("traditions_id");
  CREATE INDEX "payload_locked_documents_rels_unattended_windows_id_idx" ON "payload_locked_documents_rels" USING btree ("unattended_windows_id");
  CREATE INDEX "payload_locked_documents_rels_zones_id_idx" ON "payload_locked_documents_rels" USING btree ("zones_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "agent_test_posts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "alarms" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "audit_log" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "cities" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "countries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "event_patches" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "internal_events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "seasons" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "traditions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "unattended_windows" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "zones" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "admin_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "unattended_state" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "agent_test_posts" CASCADE;
  DROP TABLE "alarms" CASCADE;
  DROP TABLE "audit_log" CASCADE;
  DROP TABLE "cities" CASCADE;
  DROP TABLE "countries" CASCADE;
  DROP TABLE "event_patches" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "internal_events" CASCADE;
  DROP TABLE "seasons" CASCADE;
  DROP TABLE "traditions" CASCADE;
  DROP TABLE "unattended_windows" CASCADE;
  DROP TABLE "zones" CASCADE;
  DROP TABLE "admin_settings" CASCADE;
  DROP TABLE "unattended_state" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_agent_test_posts_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_alarms_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_audit_log_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_cities_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_countries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_patches_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_internal_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_seasons_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_traditions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_unattended_windows_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_zones_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_agent_test_posts_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_alarms_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_audit_log_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_cities_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_countries_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_patches_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_events_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_internal_events_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_seasons_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_traditions_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_unattended_windows_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_zones_id_idx";
  ALTER TABLE "admins" DROP COLUMN "role";
  ALTER TABLE "admins" DROP COLUMN "enable_a_p_i_key";
  ALTER TABLE "admins" DROP COLUMN "api_key";
  ALTER TABLE "admins" DROP COLUMN "api_key_index";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "agent_test_posts_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "alarms_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "audit_log_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "cities_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "countries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_patches_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "internal_events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "seasons_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "traditions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "unattended_windows_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "zones_id";
  DROP TYPE "public"."enum_admins_role";
  DROP TYPE "public"."enum_agent_test_posts_status";
  DROP TYPE "public"."enum_alarms_level";
  DROP TYPE "public"."enum_audit_log_actor_kind";
  DROP TYPE "public"."enum_countries_gender";
  DROP TYPE "public"."enum_events_slot";
  DROP TYPE "public"."enum_unattended_state_cause";`)
}
