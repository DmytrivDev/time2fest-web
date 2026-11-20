/**
 * GitHub `workflow_dispatch` of the deploy workflow (SPEC-08 AC-61, AC-66, conductor decision А-1), ring 4:
 * the `RebuildLauncher` port. ONE request per launch:
 * `POST <base>/repos/DmytrivDev/time2fest-web/actions/workflows/deploy.yml/dispatches` with
 * `{ref:'master', inputs:{env:'rehearsal', reason:'catalog-changed', catalogVersion}}` — a fine-grained token
 * with "Actions: write" only. Success = 204; anything else throws an error that names the HTTP status only.
 * The token travels only in the `Authorization` header and is never logged or thrown.
 */
import type { RebuildLauncher } from '../site/rebuild';

export const GITHUB_API_BASE = 'https://api.github.com';
export const DISPATCH_PATH = '/repos/DmytrivDev/time2fest-web/actions/workflows/deploy.yml/dispatches';
const TIMEOUT_MS = 10_000;

export interface GithubDispatchOptions {
  token: string;
  /** Tests point it at a fake on port 0. */
  baseUrl?: string;
  timeoutMs?: number;
}

export class DispatchFailed extends Error {
  constructor(readonly status: number | 'network') {
    super(`dispatch failed: ${status}`);
    this.name = 'DispatchFailed';
  }
}

export function createGithubDispatch(opts: GithubDispatchOptions): RebuildLauncher {
  const url = `${(opts.baseUrl ?? GITHUB_API_BASE).replace(/\/$/, '')}${DISPATCH_PATH}`;
  return {
    async launch(catalogVersion) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${opts.token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 't2f-server',
          },
          body: JSON.stringify({ ref: 'master', inputs: { env: 'rehearsal', reason: 'catalog-changed', catalogVersion } }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        });
      } catch {
        throw new DispatchFailed('network');
      }
      await res.body?.cancel().catch(() => undefined);
      if (res.status !== 204) throw new DispatchFailed(res.status);
    },
  };
}
