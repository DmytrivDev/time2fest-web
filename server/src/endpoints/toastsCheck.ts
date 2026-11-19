/**
 * `POST /api/toasts/check` (SPEC-09 AC-35 … AC-39, С11). Transport only: the strict body schema and the
 * 2 KiB limit are the pipeline's (`invalid-input`, AC-35), the rate limit is the `toasts-check` row
 * (20 a minute per daily fingerprint, AC-39). A shared-rule issue is `200 {issue}`, exactly
 * `checkToastText` of the package and with no AI call (AC-36); otherwise the verdict service decides:
 * `allow` → `{issue: null}`, `review` / `block` from any source → `400 validation` `moderation`
 * (AC-37, AC-38). Not public (no edge cache). Never logs the text.
 */
import type { ToastCheckBody, ToastCheckValue } from '@time2fest/contracts';
import { ToastCheckBodySchema } from '@time2fest/contracts/schemas';
import { checkToastText } from '@time2fest/rules/text';
import { moderationOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

/** Body limit of the route: 2 KiB (AC-35). */
export const TOAST_CHECK_MAX_BODY_BYTES = 2_048;

export const toastsCheckRoute: RouteRow = {
  key: 'toasts-check',
  method: 'POST',
  path: '/api/toasts/check',
  body: ToastCheckBodySchema,
  maxBodyBytes: TOAST_CHECK_MAX_BODY_BYTES,
  rateLimit: 'toasts-check',
  async handler(ctx) {
    const { text } = ctx.body as ToastCheckBody;
    const issue = checkToastText(text);
    if (issue) {
      const value: ToastCheckValue = { issue: { kind: issue.kind, start: issue.start, end: issue.end } };
      return { ok: true, value };
    }
    const verdict = await moderationOf(ctx.deps).verdict.verdict({ kind: 'toast', text });
    if (verdict.outcome !== 'allow') return failure('validation', { reason: 'moderation' });
    const value: ToastCheckValue = { issue: null };
    return { ok: true, value };
  },
};
