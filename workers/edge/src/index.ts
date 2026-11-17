// Worker entry. The only file that touches `request.cf` and the runtime globals.
import type { EdgeEnv } from './env';
import { handle } from './handler';

export default {
  fetch(req: Request, env: EdgeEnv): Promise<Response> {
    const cf = (req as { cf?: { country?: string } }).cf;
    return handle(req, env, { fetch: (input, init) => fetch(input, init), now: Date.now, cf });
  },
};
