import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_site_state_payments_pause" AS ENUM('manual', 'auto');
  CREATE TABLE "site_state" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version" numeric DEFAULT 1,
  	"at" timestamp(3) with time zone,
  	"switches" jsonb DEFAULT '{"chat":true,"toasts":true,"pass":true,"passGift":true,"payments":true,"viewersMap":true,"passOffer":true,"chatRooms":{},"toastTiers":{"2":true,"5":true,"10":true}}'::jsonb,
  	"payments_pause" "enum_site_state_payments_pause",
  	"product_selections" jsonb DEFAULT '{}'::jsonb,
  	"rebuild_due_at" timestamp(3) with time zone,
  	"rebuild_deferred" boolean DEFAULT false,
  	"last_fanned_out" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "site_state" CASCADE;
  DROP TYPE "public"."enum_site_state_payments_pause";`)
}
