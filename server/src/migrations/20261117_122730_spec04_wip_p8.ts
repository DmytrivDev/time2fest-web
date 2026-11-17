import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
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
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "event_patches_id" integer;
  CREATE UNIQUE INDEX "event_patches_event_id_idx" ON "event_patches" USING btree ("event_id");
  CREATE INDEX "event_patches_topic_version_idx" ON "event_patches" USING btree ("topic_version");
  CREATE INDEX "event_patches_updated_at_idx" ON "event_patches" USING btree ("updated_at");
  CREATE INDEX "event_patches_created_at_idx" ON "event_patches" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_event_patches_fk" FOREIGN KEY ("event_patches_id") REFERENCES "public"."event_patches"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_event_patches_id_idx" ON "payload_locked_documents_rels" USING btree ("event_patches_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "event_patches" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "event_patches" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_event_patches_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_event_patches_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "event_patches_id";`)
}
