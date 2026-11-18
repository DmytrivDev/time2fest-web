# Realtime load scripts (k6)

k6 scripts for Centrifugo v6 (JSON protocol), run through the pinned image `grafana/k6:2.4.0`.
They answer the server ping `{}` with `{}`, send `connect` and `subscribe` frames and need no secret in a file or argv.

## Scenarios

| Scenario | What it does |
|---|---|
| `steady` | N connections with subscriptions, held for the duration. |
| `publish` | The subscribers plus a publisher calling `POST /api/publish` (`X-API-Key`) at `--rate`; reports `rt_delivery_latency_ms` (publisher `t` to receipt). |
| `storm` | All sockets close inside `[storm-at, storm-at + storm-window]`, reconnect at once asking to recover; reports `rt_reconnect_ok`, `rt_recovered_subscriptions`, `rt_token_requests`. |

## Runner

`pnpm --dir server k6 --scenario <steady|publish|storm> --vus N [options]`

| Option | Default | Meaning |
|---|---|---|
| `--vus` | 10 | Connections. |
| `--ramp` | 0s | Connections are opened evenly over this time. |
| `--duration` | 60s | Hold time after the ramp (publish: publishing time). |
| `--token` | anon | `anon`, or `door:<share 0-1>`: that share of the VUs connect with a token from the local test door `POST /api/_test/realtime-token`, the rest anonymously. |
| `--channels` | required | Comma list, e.g. `site:state,rttest:batch`. The worktree prefix is added (test class rule `<ns>:<slug>_<rest>`). |
| `--rate` | 60/min | Publisher rate (`N/s`, `N/min`, `N/h`). |
| `--origin` | none | `Origin` header, if Centrifugo refuses the default. |
| `--storm-at`, `--storm-window` | ramp+5s, 5s | Storm moment and spread (seconds from start). |
| `--ws-url`, `--api-url` | compose network | Remote Centrifugo (placeholders: `wss://rt.example.test/connection/websocket`, `https://rt.example.test`). |
| `--network` | `t2f_default` locally, none with `--ws-url` | Docker network of the k6 container. |
| `--prefix` | worktree prefix locally, empty with `--ws-url` | Channel prefix. |

Under the hood the scripts read the env variables `WS_URL`, `API_URL`, `VUS`, `RAMP`, `DURATION`, `TOKEN_SOURCE`, `TOKENS_FILE`, `CHANNELS`, `PUBLISH_RATE`, `ORIGIN`, `STORM_AT`, `STORM_WINDOW`, `API_KEY`.
The runner writes them to a temporary `--env-file` (deleted afterwards); the API key comes from `T2F_CENTRIFUGO_API_KEY` or the shared realtime secrets file and is never on a command line.
Door tokens are fetched on the host and mounted read-only (the door answers loopback only), so `door:` needs a local server on this worktree's port.
`rt_token_requests` counts connects refused as "token expired" (the point where a client would ask for a new token); the scripts reuse static tokens, so it stays 0 unless tokens expire mid-run.

## Examples (local, shared lock, at most 100 connections)

```
node scripts/lock.mjs --mode shared -- node scripts/k6.mjs --scenario steady --vus 50 --ramp 10s --duration 60s --token door:0.1 --channels site:state,rttest:batch
node scripts/lock.mjs --mode shared -- node scripts/k6.mjs --scenario publish --vus 50 --duration 60s --rate 600/min --token door:0.1 --channels site:state,rttest:batch
node scripts/lock.mjs --mode shared -- node scripts/k6.mjs --scenario storm --vus 50 --ramp 5s --duration 30s --storm-at 12s --token anon --channels site:state,rttest:batch
```

## NFR-1 (wave lead only: 2 000 connections, exclusive lock)

Run from the repository root, with the server serving on this worktree's port and the stack up:

```
node server/scripts/lock.mjs --mode exclusive -- pnpm --dir server k6 --scenario publish --vus 2000 --ramp 2m --duration 10m --token door:0.1 --channels site:state,rttest:batch --rate 1000/min
```

Alongside it, every 60 s: `docker stats --no-stream t2f-centrifugo-1 t2f-redis-1`.
Pass: `rt_unexpected_disconnects` 0, `rt_failed_checks` 0, `rt_delivery_latency_ms` p(95) below 1000 ms, Centrifugo and Redis each at most 256 MB.

## Position П-RT (30 000 connections through Cloudflare)

Run the same scripts from a load host with `--ws-url wss://rt.example.test/connection/websocket --api-url https://rt.example.test --prefix '' --network ''` (hostnames come after SPEC-13a), `T2F_CENTRIFUGO_API_KEY` in the environment, and `--token anon` (the local door is not reachable remotely) or tokens prepared separately. Target: p95 delivery at most 1 s at 1 000 messages/min (NFR-7).
