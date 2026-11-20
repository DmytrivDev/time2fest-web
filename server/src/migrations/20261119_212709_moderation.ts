import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "ai_spend" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"period" varchar NOT NULL,
  	"amount_micros" numeric DEFAULT 0 NOT NULL,
  	"alarm50_at" timestamp(3) with time zone,
  	"alarm80_at" timestamp(3) with time zone,
  	"alarm100_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "moderation_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"review_threshold" numeric DEFAULT 0.5,
  	"block_threshold" numeric DEFAULT 0.8,
  	"night_ceiling_usd" numeric DEFAULT 50,
  	"month_ceiling_usd" numeric DEFAULT 100,
  	"version" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "ai_spend_id" integer;
  CREATE UNIQUE INDEX "ai_spend_period_idx" ON "ai_spend" USING btree ("period");
  CREATE INDEX "ai_spend_updated_at_idx" ON "ai_spend" USING btree ("updated_at");
  CREATE INDEX "ai_spend_created_at_idx" ON "ai_spend" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_ai_spend_fk" FOREIGN KEY ("ai_spend_id") REFERENCES "public"."ai_spend"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_ai_spend_id_idx" ON "payload_locked_documents_rels" USING btree ("ai_spend_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "ai_spend" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "moderation_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "ai_spend" CASCADE;
  DROP TABLE "moderation_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_ai_spend_fk";
  
  DROP INDEX IF EXISTS "payload_locked_documents_rels_ai_spend_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "ai_spend_id";`)
}
