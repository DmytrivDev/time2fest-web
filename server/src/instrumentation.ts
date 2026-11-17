import { loadEnv } from './platform/env';
import { envRegistry } from './registries/env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const r = loadEnv(process.env, envRegistry);
    if (!r.ok) {
      console.error('env: invalid ' + r.failing.join(', '));
      process.exit(1);
    }
  }
}
