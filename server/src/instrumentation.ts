import { loadEnv } from './platform/env';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const r = loadEnv(process.env);
    if (!r.ok) {
      console.error('env: invalid ' + r.failing.join(', '));
      process.exit(1);
    }
  }
}
