import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_admins_role" AS ENUM('owner', 'content-agent', 'stream-agent');
  CREATE TYPE "public"."enum_agent_test_posts_status" AS ENUM('draft', 'published', 'proposal');
  CREATE TABLE "agent_test_posts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"status" "enum_agent_test_posts_status" DEFAULT 'draft' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "admin_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"agent_publish" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "admins" ADD COLUMN "role" "enum_admins_role" DEFAULT 'owner' NOT NULL;
  ALTER TABLE "admins" ADD COLUMN "enable_a_p_i_key" boolean;
  ALTER TABLE "admins" ADD COLUMN "api_key" varchar;
  ALTER TABLE "admins" ADD COLUMN "api_key_index" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "agent_test_posts_id" integer;
  CREATE INDEX "agent_test_posts_updated_at_idx" ON "agent_test_posts" USING btree ("updated_at");
  CREATE INDEX "agent_test_posts_created_at_idx" ON "agent_test_posts" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_agent_test_posts_fk" FOREIGN KEY ("agent_test_posts_id") REFERENCES "public"."agent_test_posts"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_agent_test_posts_id_idx" ON "payload_locked_documents_rels" USING btree ("agent_test_posts_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "agent_test_posts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "admin_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "agent_test_posts" CASCADE;
  DROP TABLE "admin_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_agent_test_posts_fk";
  
  DROP INDEX "payload_locked_documents_rels_agent_test_posts_id_idx";
  ALTER TABLE "admins" DROP COLUMN "role";
  ALTER TABLE "admins" DROP COLUMN "enable_a_p_i_key";
  ALTER TABLE "admins" DROP COLUMN "api_key";
  ALTER TABLE "admins" DROP COLUMN "api_key_index";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "agent_test_posts_id";
  DROP TYPE "public"."enum_admins_role";
  DROP TYPE "public"."enum_agent_test_posts_status";`)
}
