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

## Live verification on test.time2fest.com

Windows + Git Bash, from the worktree root. `<secrets-file>` is a file outside the repo with `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN_INFRA` and `T2F_EDGE_SECRET` (at least 32 random characters), one `NAME=value` per line. `<tag>` is the pinned `cloudflare/cloudflared` image tag. Never print the file and never paste its values into a report. The live suite prints `EVIDENCE <id> {...}` lines (status, selected headers, hashes) that are safe to paste.

1. Infrastructure: plan, apply, apply again (second run must print «без змін»; paste the journal line of the first apply into `docs/services/cloudflare.md`).

   ```
   pnpm infra:cf plan --env test --secrets-file <secrets-file>
   pnpm infra:cf apply --env test --secrets-file <secrets-file>
   pnpm infra:cf apply --env test --secrets-file <secrets-file>
   ```

2. Build the static site and deploy the Worker:

   ```
   pnpm build:edge:test
   pnpm edge:deploy:test -- --secrets-file <secrets-file>
   ```

3. Start the worktree stack (server on `127.0.0.1:4100`, class `test`, test doors on) in a separate terminal with `T2F_EDGE_SECRET` in its environment, then start the tunnel:

   ```
   cd server && node --env-file=<secrets-file> scripts/stack.mjs all
   ```

   ```
   CLOUDFLARED_IMAGE=cloudflare/cloudflared:<tag> pnpm edge:tunnel:up
   ```

   If the server env does not already set `T2F_ENV=test` and `T2F_TEST_DOORS=1`, add them to the same environment (for example in the ignored `server/.env.local`).

4. Normal mode, then check that the tunnel-host probes of AC-49 never reached the server log (expect no match):

   ```
   T2F_LIVE_SITE=https://test.time2fest.com T2F_LIVE_TUNNEL_HOST=https://o-test.time2fest.com T2F_LIVE_MODE=normal pnpm --dir workers/edge live
   ```

   Then grep the server terminal output (or its log file) for `/api/time`, `/api/webhooks/paypro` and `/connection/websocket` requests with `Host: o-test.time2fest.com`; expect none.

5. Failure modes. Stop the server (Ctrl+C in its terminal):

   ```
   T2F_LIVE_SITE=https://test.time2fest.com T2F_LIVE_TUNNEL_HOST=https://o-test.time2fest.com T2F_LIVE_MODE=server-down pnpm --dir workers/edge live
   ```

   Restart the server (step 3), stop the tunnel, run the suite, restart the tunnel:

   ```
   pnpm edge:tunnel:down
   T2F_LIVE_SITE=https://test.time2fest.com T2F_LIVE_TUNNEL_HOST=https://o-test.time2fest.com T2F_LIVE_MODE=tunnel-down pnpm --dir workers/edge live
   CLOUDFLARED_IMAGE=cloudflare/cloudflared:<tag> pnpm edge:tunnel:up
   ```

6. Under attack: switch it on, run the suite, switch it off, confirm no differences remain:

   ```
   pnpm infra:cf apply --env test --under-attack on --secrets-file <secrets-file>
   T2F_LIVE_SITE=https://test.time2fest.com T2F_LIVE_TUNNEL_HOST=https://o-test.time2fest.com T2F_LIVE_MODE=under-attack pnpm --dir workers/edge live
   pnpm infra:cf apply --env test --secrets-file <secrets-file>
   pnpm infra:cf plan --env test --secrets-file <secrets-file>
   ```

   The last `plan` must print «без змін» (AC-51).

7. AC-49, origin port is loopback only: from another device on the LAN (or from this machine using its LAN IP), in PowerShell:

   ```
   Test-NetConnection <lan-ip> -Port 4100
   ```

   `TcpTestSucceeded` must be `False`.

8. NFR-1: after the 200-request warm-up of step 4, read the Worker CPU time p95 in the Cloudflare dashboard (Workers, `test` Worker, Metrics) and record it.

9. Teardown: stop the tunnel, stop the server (Ctrl+C), and remove `T2F_EDGE_SECRET` from the server environment (and from `server/.env.local` if you put it there):

   ```
   pnpm edge:tunnel:down
   ```

If the Worker's same-zone fetch is blocked by the `t2f-block-tunnel-hosts` rule (the suite shows 403 or 5xx on `/api/time` in normal mode), stop: the decision on the tunnel host rule goes back to the owner; do not patch the rule.
