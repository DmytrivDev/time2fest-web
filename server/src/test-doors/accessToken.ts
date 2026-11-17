/**
 * `POST /api/_test/access-token` (AC-8): a person or service-token JWT signed by the test signer,
 * which the server trusts only in the `test` class. Issuer and audience default to the config;
 * the optional fields build invalid tokens for AC-2. Part of the doors module, so it is loaded
 * only through the dynamic doors `import()`.
 */
import { z } from 'zod';
import { getTestSigner } from '../adapters/testSigner';
import { failure } from '../endpoints/pipeline';
import type { DoorRow } from './registry';

export const AccessTokenBodySchema = z
  .object({
    kind: z.enum(['person', 'service']),
    email: z.string().max(320).optional(),
    commonName: z.string().max(200).optional(),
    aud: z.string().max(200).optional(),
    iss: z.string().max(300).optional(),
    expiresInSec: z.number().int().min(-86_400).max(86_400).optional(),
    kid: z.string().max(200).optional(),
  })
  .strict();

export const accessTokenDoor: DoorRow = {
  key: 'access-token',
  method: 'POST',
  path: '/api/_test/access-token',
  body: AccessTokenBodySchema,
  async handler(ctx) {
    const team = ctx.env.vars.T2F_ACCESS_TEAM_DOMAIN;
    const aud = ctx.env.vars.T2F_ACCESS_AUD;
    if (typeof team !== 'string' || typeof aud !== 'string') return failure('unavailable');
    const signer = await getTestSigner();
    const input = ctx.body as z.infer<typeof AccessTokenBodySchema>;
    const token = await signer.sign(input, { iss: new URL(team).origin, aud });
    return { ok: true, value: { token } };
  },
};
