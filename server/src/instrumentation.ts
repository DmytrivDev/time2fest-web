import { loadEnv } from './platform/env';
import { envRegistry } from './registries/env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const r = loadEnv(process.env, envRegistry);
    if (!r.ok) {
      console.error('env: invalid ' + r.failing.join(', '));
      process.exit(1);
    }
    // Access settings (AC-7): rehearsal/production refuse a missing or test issuer/JWKS.
    const { parseAccessConfig } = await import('./domain/access/config');
    const access = parseAccessConfig(process.env, r.class);
    if (!access.ok) {
      console.error('env: invalid ' + access.failing.join(', '));
      process.exit(1);
    }
    // Realtime settings (SPEC-06 AC-11, AC-20): a bad channel prefix, or no Centrifugo URL outside test.
    const { parseRealtimeConfig } = await import('./domain/realtime/config');
    const realtime = parseRealtimeConfig(process.env, r.class);
    if (!realtime.ok) {
      console.error('env: invalid ' + realtime.failing.join(', '));
      process.exit(1);
    }
    // Internal-events delivery loop (AC-40); never during `next build`.
    if (process.env.NEXT_PHASE !== 'phase-production-build') (await import('./container')).startProcessBackground();
  }
}
