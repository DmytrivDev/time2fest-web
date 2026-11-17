export function resolveCatalogSource(args: {
  testBuild: boolean;
  apiMode: string;
  env: Record<string, string | undefined>;
  envFile?: string;
}): 'data' | { url: string };
export function fetchCatalogTo(dir: string, url: string): Promise<{ version: string }>;
