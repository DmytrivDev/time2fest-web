import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ToastIssue } from '../../rules/src/text/toast';
import type { ToastIssueWire } from '../src/moderation';
import { ModerationDoorBodySchema, ToastCheckBodySchema, ToastCheckValueSchema } from '../src/moderation.schemas';

describe('moderation wire schemas', () => {
  it('toast check body: text that is not well-formed UTF-16 is rejected (security S6)', () => {
    expect(ToastCheckBodySchema.safeParse({ text: 'a\uD800' }).success).toBe(false);
    expect(ToastCheckBodySchema.safeParse({ text: '\uDC00 b' }).success).toBe(false);
    expect(ToastCheckBodySchema.safeParse({ text: 'з Новим роком 😀' }).success).toBe(true);
  });

  it('ToastCheckBody accepts text and rejects empty, blank, >120, extra keys', () => {
    expect(ToastCheckBodySchema.safeParse({ text: ' a ' }).success).toBe(true);
    expect(ToastCheckBodySchema.safeParse({ text: '' }).success).toBe(false);
    expect(ToastCheckBodySchema.safeParse({ text: '   ' }).success).toBe(false);
    expect(ToastCheckBodySchema.safeParse({ text: 'x'.repeat(121) }).success).toBe(false);
    expect(ToastCheckBodySchema.safeParse({ text: 'x'.repeat(120) }).success).toBe(true);
    expect(ToastCheckBodySchema.safeParse({ text: 'a', extra: 1 }).success).toBe(false);
  });

  it('ToastCheckValue allows a null issue and rejects unknown kinds', () => {
    expect(ToastCheckValueSchema.safeParse({ issue: null }).success).toBe(true);
    expect(ToastCheckValueSchema.safeParse({ issue: { kind: 'link', start: 0, end: 3 } }).success).toBe(true);
    expect(ToastCheckValueSchema.safeParse({ issue: { kind: 'other', start: 0, end: 3 } }).success).toBe(false);
  });

  it('door body is a strict union', () => {
    expect(ModerationDoorBodySchema.safeParse({ op: 'reset' }).success).toBe(true);
    expect(ModerationDoorBodySchema.safeParse({ op: 'status' }).success).toBe(true);
    expect(ModerationDoorBodySchema.safeParse({ op: 'setSpend', period: 'night', usd: 49.99 }).success).toBe(true);
    expect(ModerationDoorBodySchema.safeParse({ op: 'setSpend', period: 'night', usd: -1 }).success).toBe(false);
    expect(ModerationDoorBodySchema.safeParse({ op: 'setSpend', period: 'week', usd: 1 }).success).toBe(false);
    expect(ModerationDoorBodySchema.safeParse({ op: 'verdict', kind: 'toast', text: 'hi' }).success).toBe(true);
    expect(ModerationDoorBodySchema.safeParse({ op: 'verdict', kind: 'toast', text: 'x'.repeat(201) }).success).toBe(false);
    expect(ModerationDoorBodySchema.safeParse({ op: 'reset', extra: 1 }).success).toBe(false);
    expect(ModerationDoorBodySchema.safeParse({ op: 'nope' }).success).toBe(false);
  });

  it('the rules ToastIssue is assignable to ToastIssueWire', () => {
    expectTypeOf<ToastIssue>().toExtend<ToastIssueWire>();
  });
});
