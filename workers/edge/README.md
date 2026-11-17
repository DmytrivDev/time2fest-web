# @time2fest/edge

Cloudflare Worker in front of the static site: serves `/api/time` itself, proxies the rest of `/api/*` to the origin with trusted headers, and answers one unified response when the origin fails. Configuration: `wrangler.json`.

## Environments

| Env | Host | Origin | Deployed in this wave |
|---|---|---|---|
| `test` | `test.time2fest.com` | `o-test.time2fest.com` | yes (only this one) |
| `rehearsal` | `rehearsal.time2fest.com` | `o-rehearsal.time2fest.com` | no |
| `prelaunch` | `time2fest.com` | none (static only) | no |
| `production` | `time2fest.com` | `o.time2fest.com` | no |

## Deploy

```
pnpm build:edge:test            # root: static build into out-edge-test
pnpm edge:deploy:test           # root: runs `deploy:test` of this package
pnpm --dir workers/edge deploy:rehearsal -- --confirm rehearsal
```

`scripts/deploy.mjs --env <env> [--secrets-file <path>] [--confirm <env>]`. Any env other than `test` needs `--confirm <same env>`, otherwise it exits 2 (`not deployed in this wave`). It checks the variables and the non-empty assets directory, runs `wrangler deploy`, then `wrangler secret put T2F_EDGE_SECRET` for envs with an origin.

## Secrets

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and (envs with an origin) `T2F_EDGE_SECRET` (at least 32 characters) come from the environment or from a file passed with `--secrets-file`. The secret reaches wrangler on stdin only, never argv; the script prints only wrangler's output and `deployed <env>`; a missing variable is reported by name.

## Reserved: `build:prelaunch`

The root script `build:prelaunch` will build the pre-launch static site into `out-prelaunch` and belongs to the pre-launch wave. It is not implemented here.
