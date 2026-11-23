/** Zod wire schemas of the `site` contract (SPEC-08). Server and tests only: the site bundle uses `siteGuard.ts`. */
import { z } from 'zod';

const isoAt = z.string().refine((v) => v.length > 0 && !Number.isNaN(Date.parse(v)), 'ISO timestamp');

export const SiteProductKeySchema = z.enum(['pass', 'toast:2', 'toast:5', 'toast:10']);

export const SiteSwitchesSchema = z
  .object({
    chat: z.boolean(),
    toasts: z.boolean(),
    pass: z.boolean(),
    passGift: z.boolean(),
    payments: z.boolean(),
    viewersMap: z.boolean(),
    viewersCount: z.boolean().default(true),
    passOffer: z.boolean(),
    chatRooms: z.record(z.string(), z.boolean()),
    toastTiers: z.object({ '2': z.boolean(), '5': z.boolean(), '10': z.boolean() }).strict(),
  })
  .strict();

const MoneySchema = z.object({ amount: z.number().int().nonnegative(), currency: z.literal('USD') }).strict();

export const SiteProductSchema = z
  .object({ key: SiteProductKeySchema, price: MoneySchema, priceVersion: z.number().int().min(1) })
  .strict();

export const SiteEventPatchSchema = z
  .object({
    moment: z.number().finite().optional(),
    isMainCelebration: z.boolean().optional(),
    restrained: z.object({ note: z.string().optional() }).strict().optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export const SiteStateSchema = z
  .object({
    version: z.number().int().min(1),
    at: isoAt,
    switches: SiteSwitchesSchema,
    products: z.array(SiteProductSchema),
    catalogVersion: z.string().min(1),
    eventPatches: z.record(z.string(), SiteEventPatchSchema),
    outage: z.literal('technical').optional(),
  })
  .strict();

/** Event on `site:state`: always a full snapshot. */
export const SiteSnapshotEnvelopeSchema = z
  .object({ type: z.literal('snapshot'), id: z.string().min(1), version: z.number().int().min(1), data: SiteStateSchema })
  .strict();

export const SiteSwitchKeySchema = z.enum([
  'chat',
  'toasts',
  'pass',
  'passGift',
  'payments',
  'viewersMap',
  'viewersCount',
  'passOffer',
  'chatRooms',
  'toastTiers',
]);

/** `POST /cms-api/site/switch` body. */
export const SiteSwitchBodySchema = z
  .object({
    key: SiteSwitchKeySchema,
    value: z.boolean(),
    reason: z.string().min(1).max(200),
    room: z.string().min(1).optional(),
    tier: z.enum(['2', '5', '10']).optional(),
  })
  .strict();
export type SiteSwitchBody = z.infer<typeof SiteSwitchBodySchema>;

/** `POST /cms-api/site/product` body. */
export const SiteProductBodySchema = z
  .object({ key: SiteProductKeySchema, productId: z.string().min(1), reason: z.string().min(1).max(200) })
  .strict();
export type SiteProductBody = z.infer<typeof SiteProductBodySchema>;

/** `POST /api/_test/site` body (test door). */
export const SiteDoorBodySchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('switch'),
      key: SiteSwitchKeySchema,
      value: z.boolean(),
      mode: z.enum(['manual', 'auto']),
      room: z.string().min(1).optional(),
      tier: z.enum(['2', '5', '10']).optional(),
      reason: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal('products'),
      list: z.array(z.object({ key: SiteProductKeySchema, productId: z.string().min(1), price: MoneySchema }).strict()),
    })
    .strict(),
  z.object({ action: z.literal('select'), key: SiteProductKeySchema, productId: z.string().min(1) }).strict(),
  z.object({ action: z.literal('redButton'), op: z.enum(['put', 'delete']) }).strict(),
  z.object({ action: z.literal('reset') }).strict(),
]);
export type SiteDoorBody = z.infer<typeof SiteDoorBodySchema>;
