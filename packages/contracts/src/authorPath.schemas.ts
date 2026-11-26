/** Zod wire schema of the author path (SPEC-14). Server and tests only. */
import { z } from 'zod';

export const authorPathResponse = z
  .object({
    points: z.array(z.object({ eventId: z.string().min(1).max(128), planned: z.boolean() }).strict()).max(512),
    hidden: z.boolean(),
  })
  .strict();
export type AuthorPathResponseWire = z.infer<typeof authorPathResponse>;
