# Fake YouTube Data API

For tests of SPEC-12 and SPEC-21a. `node:http`, no dependencies, listens on `127.0.0.1`. Never in `docker-compose.yml`.

Start: `node fakes/youtube/server.mjs --port 0` (prints the URL), or `startFakeYoutube({ port: 0 })` from a test and pass the URL as `T2F_YOUTUBE_BASE_URL`.

- `GET /youtube/v3/videos?id=a,b&part=…&fields=…` — more than 50 ids: 400.
- `GET /youtube/v3/channels?id=a,b&part=contentDetails&fields=…` — `items[].contentDetails.relatedPlaylists.uploads`; an unknown or deleted channel is absent.
- `GET /youtube/v3/playlistItems?playlistId=…&maxResults≤50` — `items[].contentDetails.videoId`, newest first (the order given in `videos`); unknown playlist: 404 `playlistNotFound`.
- `GET /youtube/v3/search?channelId=…&eventType=upcoming&type=video` — `items[].id.videoId` of the controlled ids, else `{items:[]}`.
- `videos` items carry `snippet.channelId` when a controlled channel lists the video.
- `POST /_control/videos {videos:[{id,state,scheduledStartTime?,embeddable?}]}` — state: `live`, `upcoming`, `ended`, `none`, `private`, `deleted` (an unknown id is `deleted`).
- `POST /_control/channels {channels:[{id,uploads?,videos?,deleted?}]}` — `uploads` defaults to `UU` + id without its first two letters; `videos` newest first.
- `POST /_control/search {channelId, ids}` — the ids the search returns for that channel.
- `POST /_control/quota {bucket:'queries'|'search'|'candidates'|'playlists', exceeded}` — 403 `quotaExceeded`: `queries` stops videos, channels and playlistItems; `search` or `candidates` stops search; `playlists` stops playlistItems.
- `POST /_control/down {on}` — 503 everywhere.
- `GET /_control/calls` — `{counts, calls}` (per path; every call records `ids`, `part`, `fields` and all `params`); `POST /_control/reset`.

Use only video ids from `data/streams.json`. No titles, descriptions, thumbnails or statistics are ever served.
