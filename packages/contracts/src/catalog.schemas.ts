/** Zod wire schemas of the catalog and of its internal events (SPEC-04). Server and tests only. */
import { z } from 'zod';

const ISO_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CELEBRATION = z.enum(['main', 'webcam', 'tv', 'countdown-only']);
// `data/schedule.schema.json` does not close these objects, so they stay open here too.
const text = z.looseObject({ uk: z.string().min(1) });

const EventSchema = z
  .object({
    id: z.string().regex(/^evt_[a-z0-9-]+_2027$/),
    midnightUtc: z.string().regex(ISO_SECONDS),
    isMainCelebration: z.boolean(),
    type: CELEBRATION,
    popularity: z.number().int().min(0).max(100),
    restrained: z.looseObject({ note: text }).optional(),
  })
  .strict();

const CitySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: text,
    landmark: text.optional(),
    celebrationType: CELEBRATION,
    isCountryMain: z.boolean(),
    mapPoint: z.looseObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
    events: z.array(EventSchema).length(1),
  })
  .strict();

const ZoneSchema = z
  .object({
    id: z.string().regex(/^utc[+-]\d{4}$/),
    order: z.number().int().min(0).max(37),
    offsetMinutes: z.number().int().min(-720).max(840),
    midnightUtc: z.string().regex(ISO_SECONDS),
    representativeCityId: z.string(),
    countries: z
      .array(z.object({ iso: z.string().regex(/^[A-Z]{2}$/), cities: z.array(CitySchema).min(1) }).strict())
      .min(1),
  })
  .strict();

/** `data/schedule.json`, mirroring `data/schedule.schema.json`. */
export const ScheduleFileSchema = z
  .object({
    $schema: z.string().optional(),
    version: z.literal(1),
    season: z.literal('2026-27'),
    generatedAt: z.string().regex(ISO_SECONDS),
    tzdbVersion: z.literal('2026f'),
    zones: z.array(ZoneSchema).length(38),
  })
  .strict();

const TraditionSchema = z.object({ id: z.string().min(1), title: z.string(), text: z.string(), iconId: z.string() }).strict();

const CountrySchema = z
  .object({
    iso: z.string().regex(/^[A-Z]{2}$/),
    slug: z.string().min(1),
    name: text,
    gender: z.string(),
    flagCode: z.string(),
    zoneIds: z.array(z.string().min(1)),
    illustrationId: z.string(),
    howTo: z.object({ traditions: z.array(TraditionSchema), text: z.string(), gallery: z.array(z.any()) }).strict(),
    popularity: z.number().int().min(0).max(100),
  })
  .strict();

/** `data/countries.json`. */
export const CountriesFileSchema = z.object({ version: z.literal(1), countries: z.array(CountrySchema) }).strict();

/**
 * The value of `GET /api/catalog` (AC-63). `CatalogResponseSchema` (this value inside `ApiResult`) is
 * built in `schemas.ts`, which owns `apiResultSchema`: importing it here would make a cycle.
 */
export const CatalogPayloadSchema = z
  .object({ version: z.string().min(1), schedule: ScheduleFileSchema, countries: CountriesFileSchema })
  .strict();

const SiteEventPatchSchema = z
  .object({
    moment: z.number().optional(),
    isMainCelebration: z.boolean().optional(),
    restrained: z.object({ note: z.string().optional() }).strict().optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

/** Internal event: an event patch changed. */
export const EventPatchChangedSchema = z
  .object({
    eventId: z.string().min(1),
    before: SiteEventPatchSchema.nullable(),
    after: SiteEventPatchSchema.nullable(),
    version: z.number().int().nonnegative(),
    at: z.string().min(1),
    actor: z.object({ kind: z.enum(['owner', 'system']), label: z.string() }).strict(),
  })
  .strict();

/** Internal event: the catalog changed. */
export const CatalogChangedSchema = z.object({ version: z.string().min(1), at: z.string().min(1) }).strict();
export type CatalogChanged = z.infer<typeof CatalogChangedSchema>;

/** Internal event: unattended mode changed. */
export const UnattendedChangedSchema = z
  .object({
    on: z.boolean(),
    cause: z.enum(['schedule', 'manual', 'alarm']),
    at: z.string().min(1),
    version: z.number().int().nonnegative(),
  })
  .strict();
