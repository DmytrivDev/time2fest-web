import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// SPEC-14 [П-1]: raw SQL tables on the rights pool (precedent: spec10_auth, spec11_rights). Hand-written DDL —
// composite keys are the invariants (one proof per subject x event x moment, one stamp per subject x season x event);
// named in plan item W8. Expand-only: nine new tables, no existing table changed. All times are server-clock ms (bigint).
// `presence_samples` has no subject column (NFR-5).
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(
    sql.raw(`
  CREATE TABLE "presence_proofs" (
    "subject_id" text NOT NULL,
    "season" text NOT NULL,
    "event_id" text NOT NULL,
    "moment_ms" bigint NOT NULL,
    "first_received_at" bigint NOT NULL,
    "last_received_at" bigint,
    "source" text NOT NULL,
    PRIMARY KEY ("subject_id", "season", "event_id", "moment_ms")
  );
  CREATE INDEX "presence_proofs_season_idx" ON "presence_proofs" ("season");

  CREATE TABLE "presence_event_moments" (
    "season" text NOT NULL,
    "event_id" text NOT NULL,
    "moment_ms" bigint NOT NULL,
    "first_seen_at" bigint NOT NULL,
    PRIMARY KEY ("season", "event_id", "moment_ms")
  );

  CREATE TABLE "presence_samples" (
    "node_id" text NOT NULL,
    "at" bigint NOT NULL,
    "fast_reachable" boolean NOT NULL,
    "fast_run_id" text,
    "fast_uptime_s" bigint,
    "accepted" integer NOT NULL,
    "failed" integer NOT NULL,
    PRIMARY KEY ("node_id", "at")
  );
  CREATE INDEX "presence_samples_at_idx" ON "presence_samples" ("at");

  CREATE TABLE "presence_window_health" (
    "season" text NOT NULL,
    "event_id" text NOT NULL,
    "moment_ms" bigint NOT NULL,
    "state" text NOT NULL CHECK ("state" IN ('healthy', 'downtime')),
    "signs" text[] DEFAULT '{}'::text[] NOT NULL,
    "recorded_by" text NOT NULL DEFAULT 'system' CHECK ("recorded_by" = 'system'),
    "recorded_at" bigint NOT NULL,
    "alarmed_at" bigint,
    CONSTRAINT "presence_window_health_uq" UNIQUE ("season", "event_id", "moment_ms")
  );

  CREATE TABLE "presence_downtimes" (
    "id" bigserial PRIMARY KEY,
    "season" text NOT NULL,
    "kind" text NOT NULL CHECK ("kind" IN ('manual', 'edge-region')),
    "event_id" text,
    "from_ms" bigint NOT NULL,
    "to_ms" bigint NOT NULL,
    "region" text,
    "reason" text CHECK (length("reason") <= 200),
    "recorded_by" text NOT NULL CHECK ("recorded_by" IN ('owner', 'system')),
    "created_at" bigint NOT NULL,
    "alarmed_at" bigint
  );
  CREATE INDEX "presence_downtimes_season_idx" ON "presence_downtimes" ("season");

  CREATE TABLE "stamps" (
    "subject_id" text NOT NULL,
    "season" text NOT NULL,
    "event_id" text NOT NULL,
    "granted_at" bigint NOT NULL,
    "presence_source" text NOT NULL,
    "grant_kind" text NOT NULL CHECK ("grant_kind" IN ('presence', 'downtime', 'old-moment')),
    "issued_at" bigint NOT NULL,
    PRIMARY KEY ("subject_id", "season", "event_id")
  );

  CREATE TABLE "passport_achievements" (
    "subject_id" text NOT NULL,
    "season" text NOT NULL,
    "key" text NOT NULL,
    "achieved_at" bigint NOT NULL,
    PRIMARY KEY ("subject_id", "key")
  );

  CREATE TABLE "stamp_old_moment_log" (
    "id" bigserial PRIMARY KEY,
    "subject_id" text NOT NULL,
    "season" text NOT NULL,
    "event_id" text NOT NULL,
    "old_moment_ms" bigint NOT NULL,
    "new_moment_ms" bigint NOT NULL,
    "at" bigint NOT NULL
  );

  CREATE TABLE "author_ids" (
    "subject_id" text NOT NULL PRIMARY KEY,
    "author_id" text NOT NULL UNIQUE,
    "created_at" bigint NOT NULL
  );`),
  )
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(
    sql.raw(`
  DROP TABLE IF EXISTS "author_ids";
  DROP TABLE IF EXISTS "stamp_old_moment_log";
  DROP TABLE IF EXISTS "passport_achievements";
  DROP TABLE IF EXISTS "stamps";
  DROP TABLE IF EXISTS "presence_downtimes";
  DROP TABLE IF EXISTS "presence_window_health";
  DROP TABLE IF EXISTS "presence_samples";
  DROP TABLE IF EXISTS "presence_event_moments";
  DROP TABLE IF EXISTS "presence_proofs";`),
  )
}
