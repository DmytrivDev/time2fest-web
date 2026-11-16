/**
 * The single catch-all of `/api/*`, so the clock, the doors and the dispatcher live in one
 * module graph. Do not add other `app/api/**` route files. Doors are gated in `container.ts`.
 */
import { getDispatcher } from '../../../container';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function handle(req: Request): Promise<Response> {
  return (await getDispatcher())(req);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
