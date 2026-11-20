// Worker entry. The only file that touches `request.cf` and the runtime globals.
import type { EdgeEnv } from './env';
import { handle } from './handler';
import { defaultCache } from './publicCache';

/** The subset of the runtime's `ExecutionContext` the edge uses. */
interface EdgeContext {
  waitUntil(work: Promise<unknown>): void;
}

export default {
  fetch(req: Request, env: EdgeEnv, ctx: EdgeContext): Promise<Response> {
    const cf = (req as { cf?: { country?: string } }).cf;
    return handle(req, env, {
      fetch: (input, init) => fetch(input, init),
      now: Date.now,
      cf,
      cache: defaultCache(),
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};
