import type { CatalogResponseSchema } from '@time2fest/contracts/schemas';

export interface CatalogIssue {
  code?: string;
  path: ReadonlyArray<PropertyKey>;
  message: string;
  errors?: ReadonlyArray<ReadonlyArray<CatalogIssue>>;
}

export function checkCatalogUrl(raw: string, testBuild: boolean): void;
export function resolveCatalogSource(args: {
  testBuild: boolean;
  apiMode: string;
  env: Record<string, string | undefined>;
  envFile?: string;
}): 'data' | { url: string };
export function firstIssue(issues: ReadonlyArray<CatalogIssue>, base?: PropertyKey[]): { path: string; message: string };
/** `schema` is `CatalogResponseSchema`, passed in by `next.config.ts` (zod stays out of this Node-only module). */
export function fetchCatalogTo(dir: string, url: string, schema: typeof CatalogResponseSchema): Promise<{ version: string }>;
