/** Zod wire schemas of text moderation (SPEC-09). Server and tests only. */
import { z } from 'zod';
import type { ModerationDoorBody, ModerationDoorValue, ToastCheckBody, ToastCheckValue } from './moderation';

export const ToastCheckBodySchema = z
  .object({ text: z.string().refine((t) => t.trim().length >= 1 && t.trim().length <= 120, 'text must be 1-120 chars after trim') })
  .strict() satisfies z.ZodType<ToastCheckBody>;

export const ToastIssueWireSchema = z
  .object({
    kind: z.enum(['link', 'contact', 'word']),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();

export const ToastCheckValueSchema = z.object({ issue: ToastIssueWireSchema.nullable() }).strict() satisfies z.ZodType<ToastCheckValue>;

export const AiTaskSchema = z.enum(['moderation', 'translation']);
export const AiStateSchema = z.enum(['available', 'degraded', 'fallback']);
export const AiStateReasonSchema = z.enum(['unavailable', 'slow', 'ceiling', 'not-configured']);
export const AiStatusSchema = z
  .object({ task: AiTaskSchema, state: AiStateSchema, reason: AiStateReasonSchema.optional() })
  .strict();

const PeriodSchema = z.enum(['night', 'month']);

export const ModerationDoorBodySchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reset') }).strict(),
  z.object({ op: z.literal('setSpend'), period: PeriodSchema, usd: z.number().min(0) }).strict(),
  z.object({ op: z.literal('status') }).strict(),
  z.object({ op: z.literal('verdict'), kind: z.enum(['message', 'nick', 'toast']), text: z.string().max(200) }).strict(),
]) satisfies z.ZodType<ModerationDoorBody>;

export const ModerationDoorValueSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('reset') }).strict(),
  z.object({ op: z.literal('setSpend'), period: PeriodSchema, usd: z.number().min(0) }).strict(),
  z.object({ op: z.literal('status'), statuses: z.array(AiStatusSchema) }).strict(),
  z
    .object({
      op: z.literal('verdict'),
      outcome: z.enum(['allow', 'review', 'block']),
      source: z.enum(['rules', 'primary', 'backup', 'fallback']),
      reason: z.string().optional(),
    })
    .strict(),
]) satisfies z.ZodType<ModerationDoorValue>;
