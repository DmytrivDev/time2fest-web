import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_countries_gender" AS ENUM('m', 'f', 'n', 'pl');
  CREATE TYPE "public"."enum_events_slot" AS ENUM('midnight', 'fireworks-20', 'dawn', 'jan-1');
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
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "cities_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "countries_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "events_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "seasons_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "traditions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "zones_id" integer;
  CREATE UNIQUE INDEX "cities_city_id_idx" ON "cities" USING btree ("city_id");
  CREATE INDEX "cities_country_iso_idx" ON "cities" USING btree ("country_iso");
  CREATE INDEX "cities_zone_id_idx" ON "cities" USING btree ("zone_id");
  CREATE INDEX "cities_updated_at_idx" ON "cities" USING btree ("updated_at");
  CREATE INDEX "cities_created_at_idx" ON "cities" USING btree ("created_at");
  CREATE UNIQUE INDEX "countries_iso_idx" ON "countries" USING btree ("iso");
  CREATE UNIQUE INDEX "countries_slug_idx" ON "countries" USING btree ("slug");
  CREATE INDEX "countries_updated_at_idx" ON "countries" USING btree ("updated_at");
  CREATE INDEX "countries_created_at_idx" ON "countries" USING btree ("created_at");
  CREATE UNIQUE INDEX "events_event_id_idx" ON "events" USING btree ("event_id");
  CREATE INDEX "events_city_id_idx" ON "events" USING btree ("city_id");
  CREATE INDEX "events_zone_id_idx" ON "events" USING btree ("zone_id");
  CREATE INDEX "events_country_iso_idx" ON "events" USING btree ("country_iso");
  CREATE INDEX "events_updated_at_idx" ON "events" USING btree ("updated_at");
  CREATE INDEX "events_created_at_idx" ON "events" USING btree ("created_at");
  CREATE UNIQUE INDEX "seasons_key_idx" ON "seasons" USING btree ("key");
  CREATE INDEX "seasons_updated_at_idx" ON "seasons" USING btree ("updated_at");
  CREATE INDEX "seasons_created_at_idx" ON "seasons" USING btree ("created_at");
  CREATE UNIQUE INDEX "traditions_tradition_id_idx" ON "traditions" USING btree ("tradition_id");
  CREATE INDEX "traditions_country_iso_idx" ON "traditions" USING btree ("country_iso");
  CREATE INDEX "traditions_updated_at_idx" ON "traditions" USING btree ("updated_at");
  CREATE INDEX "traditions_created_at_idx" ON "traditions" USING btree ("created_at");
  CREATE UNIQUE INDEX "zones_zone_id_idx" ON "zones" USING btree ("zone_id");
  CREATE INDEX "zones_updated_at_idx" ON "zones" USING btree ("updated_at");
  CREATE INDEX "zones_created_at_idx" ON "zones" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_cities_fk" FOREIGN KEY ("cities_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_countries_fk" FOREIGN KEY ("countries_id") REFERENCES "public"."countries"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_events_fk" FOREIGN KEY ("events_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_seasons_fk" FOREIGN KEY ("seasons_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_traditions_fk" FOREIGN KEY ("traditions_id") REFERENCES "public"."traditions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_zones_fk" FOREIGN KEY ("zones_id") REFERENCES "public"."zones"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_cities_id_idx" ON "payload_locked_documents_rels" USING btree ("cities_id");
  CREATE INDEX "payload_locked_documents_rels_countries_id_idx" ON "payload_locked_documents_rels" USING btree ("countries_id");
  CREATE INDEX "payload_locked_documents_rels_events_id_idx" ON "payload_locked_documents_rels" USING btree ("events_id");
  CREATE INDEX "payload_locked_documents_rels_seasons_id_idx" ON "payload_locked_documents_rels" USING btree ("seasons_id");
  CREATE INDEX "payload_locked_documents_rels_traditions_id_idx" ON "payload_locked_documents_rels" USING btree ("traditions_id");
  CREATE INDEX "payload_locked_documents_rels_zones_id_idx" ON "payload_locked_documents_rels" USING btree ("zones_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "cities" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "countries" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "events" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "seasons" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "traditions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "zones" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "cities" CASCADE;
  DROP TABLE "countries" CASCADE;
  DROP TABLE "events" CASCADE;
  DROP TABLE "seasons" CASCADE;
  DROP TABLE "traditions" CASCADE;
  DROP TABLE "zones" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_cities_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_countries_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_events_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_seasons_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_traditions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_zones_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_cities_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_countries_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_events_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_seasons_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_traditions_id_idx";
  DROP INDEX IF EXISTS "payload_locked_documents_rels_zones_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "cities_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "countries_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "events_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "seasons_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "traditions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "zones_id";
  DROP TYPE "public"."enum_countries_gender";
  DROP TYPE "public"."enum_events_slot";`)
}
