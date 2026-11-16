import type { CollectionConfig } from 'payload';
import { envClass } from '../platform/env';

export const admins: CollectionConfig = {
  slug: 'admins',
  auth: {
    cookies: { sameSite: 'Lax', secure: envClass(process.env) === 'production' },
  },
  fields: [],
};
