# Fake YouTube Data API

For tests of SPEC-12 only. `node:http`, no dependencies, listens on `127.0.0.1`. Never in `docker-compose.yml`.

Start: `node fakes/youtube/server.mjs --port 0` (prints the URL), or `startFakeYoutube({ port: 0 })` from a test and pass the URL as `T2F_YOUTUBE_BASE_URL`.

- `GET /youtube/v3/videos?id=a,b&part=…&fields=…` — more than 50 ids: 400.
- `GET /youtube/v3/search` — only counted or refused.
- `POST /_control/videos {videos:[{id,state,scheduledStartTime?,embeddable?}]}` — state: `live`, `upcoming`, `ended`, `none`, `private`, `deleted` (an unknown id is `deleted`).
- `POST /_control/quota {bucket:'queries'|'search', exceeded}` — 403 `quotaExceeded` for that bucket.
- `POST /_control/down {on}` — 503 everywhere.
- `GET /_control/calls` — `{counts, calls}`; `POST /_control/reset`.

Use only video ids from `data/streams.json`. No titles and no statistics are ever served.
