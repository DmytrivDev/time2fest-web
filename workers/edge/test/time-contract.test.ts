// The one /api/time behaviour suite, run against the edge handler (AC-4, AC-10).
import { describeDomain } from '../../../tests/contract/time.suite';
import { handle } from '../src/handler';

const neverCalled = async (): Promise<Response> => {
  throw new Error('origin must not be called for /api/time');
};
const ASSETS = { fetch: async () => new Response('static') };

describeDomain('time (edge)', () =>
  handle(new Request('https://t.test/api/time'), { EDGE_ENV: 'prelaunch', ASSETS }, { fetch: neverCalled, now: Date.now }),
);
