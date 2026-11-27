import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// SPEC-14 PERF-2: `publish` reads MAX(version) of one topic under the outbox lock; `(topic, version)` makes that one
// index probe instead of a scan of every row of the topic. Hand-written on purpose: Payload's compound `indexes` cannot
// be named and would get the schema-global name `topic_version_idx`, so the index lives here (not in the collection
// config, and so not in the snapshot) with a table-prefixed name. Expand-only; plain CREATE INDEX because Payload
// runs a migration in a transaction and the table is small before launch.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE INDEX IF NOT EXISTS "internal_events_topic_version_idx" ON "internal_events" USING btree ("topic","version");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "internal_events_topic_version_idx";`)
}
