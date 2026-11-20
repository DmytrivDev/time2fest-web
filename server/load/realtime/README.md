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

Clients connect from a load host with `--ws-url wss://rt.example.test/connection/websocket --prefix '' --network ''` (hostnames come after SPEC-13a) and `--token anon` (the local door is not reachable remotely) or tokens prepared separately. The public `rt.*` host serves only the client port: in rehearsal and production the Centrifugo HTTP API and `/health` listen on the internal port (`http_server.internal_port`, 9000) that the tunnel never exposes. So the `publish` scenario's publishers run inside the server's network, with `--api-url http://centrifugo:9000` and `T2F_CENTRIFUGO_API_KEY` in their environment — never `--api-url` on the public host. Likewise the server's `T2F_CENTRIFUGO_URL` in rehearsal and production points at that internal API port. Target: p95 delivery at most 1 s at 1 000 messages/min (NFR-7).

## Spike П-RT scripts (`spike.js`, `spike-publisher.js`)

Driven by `node infra/ops/spike/spike.mjs run …` (see `infra/ops/spike/README.md`); they also run by hand with `docker run … grafana/k6:2.4.0 run /scripts/spike.js` and an env file. Plan: `docs/backend/spike-rt-plan.md`.

`spike.js` — one VU holds `CONNS_PER_VU` sockets (default 50), so 7 500 sockets need 150 VUs, not 7 500. Anonymous connect, subscribes `CHANNELS` (default `live:spike,site:state`, no prefix), answers the server ping `{}`. Openings are spread evenly over `RAMP` from the common start `START_AT` (epoch ms; `setup()` waits for it, so N generators and the publisher align). Any unexpected close reconnects with centrifuge-js-like backoff (`RECONNECT_MIN_MS` 500 … `RECONNECT_MAX_MS` 20 000, exponential, full jitter) asking recovery (epoch/offset). `STORM_AT` + `STORM_WINDOW`: every socket closes at a random moment in the window and reconnects at once with recovery. Only a `LATENCY_SAMPLE` share (default 0.1) of sockets parses publications for latency; the rest count frames and track offsets with string search. `GEN_INDEX`/`GEN_COUNT` only tag the summary; `handleSummary` writes `SUMMARY_FILE` (default `/out/summary.json`).

| Metric | Meaning |
|---|---|
| `rt_connect_ok`, `rt_ever_subscribed` | sockets subscribed at least once (rate / count) |
| `rt_unexpected_disconnects{code}`, `rt_unexpected_disconnects_hold`, `rt_disconnect_3012_no_pong` | closes we did not ask for (by close code; during the hold) |
| `rt_handshake_errors{cls}` | failed openings by error class (`s<status>` if the text carries one, `timeout`, `reset`, `refused`, `eof`, `tls`, `dns`, `bad_handshake`, `other`) |
| `rt_reconnect_attempts`, `rt_reconnect_ok`, `rt_time_to_reconnect_ms` | reconnect episodes: attempts, share that came back before the end, time from close to subscribed again |
| `rt_recovered_subscriptions`, `rt_recovered_publications`, `rt_offset_gaps` | recovery result; publications returned on recovery; offsets skipped in pushes (lost messages) |
| `rt_delivery_latency_ms`, `rt_messages_received` | publisher `t` to receipt (sampled sockets); all publications received |
| `rt_connected{b}`, `rt_reporters{b}` | every `REPORT_SEC` (10 s) each VU adds its live socket count to bucket `b`: the sum per bucket is "connected sockets over time" |

Note: k6 reports a refused WebSocket upgrade as `websocket: bad handshake` without the HTTP status (checked against Centrifugo's 403 on a wrong `Origin`), so Cloudflare 5xx/52x show up as `bad_handshake`; their codes come from the zone analytics and the cloudflared logs.

`spike-publisher.js` — runs on the realtime node in its Docker network against `http://centrifugo:9000` (`X-API-Key` from `API_KEY` or `CENTRIFUGO_HTTP_API_KEY` of `centrifugo.env`). After `START_AT` + `DELAY` it publishes to `live:spike` a batch of `PAYLOAD_BYTES` (default 1 000) JSON `{t, msgs, reactions, pad}` every `BATCH_MS` (500), switching to `BATCH_MS_2` (250) for the last `FAST_LAST` seconds of `DURATION`, and `site:state` every 30 s. Metrics: `rt_published`, `rt_publish_failed`, `rt_publish_ms`.
