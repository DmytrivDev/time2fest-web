# Fake Telegram Bot API

For tests of SPEC-13b only. `node:http`, no dependencies, listens on `127.0.0.1`. Never in `docker-compose.yml`. No test and no process of this wave ever reaches `api.telegram.org` (the network guard `server/test/support/noTelegramNetwork.ts` refuses it).

Start: `node fakes/telegram/server.mjs --port 0` (prints the URL), or `startFakeTelegram({ port: 0, token? })` from a test and pass the URL as `T2F_TELEGRAM_API_BASE`. With `token` set, any other token gets 401.

- `POST /bot<token>/sendMessage {chat_id, text, disable_web_page_preview}` — answer by mode:
  - `ok` — 200 `{ok:true, result:{message_id, …}}`;
  - `chat-not-found` — 400 `Bad Request: chat not found`;
  - `forbidden` — 403;
  - `rate-limit` — 429 `{parameters:{retry_after:N}}`;
  - `error` — 502;
  - `down` — the socket is destroyed (a network error for the client).
- `POST /_control/mode {mode, retryAfter?, times?}` — `retryAfter` (default 5) for `rate-limit`; `times` — that many requests, then back to `ok`.
- `POST /_control/down {on}` — `down` mode on / back to `ok`.
- `GET /_control/calls` — `{calls:[{path:'/bot<token>/sendMessage', chat_id, text, disable_web_page_preview, parse_mode?, tokenMatches, at}]}`; every request is recorded, `down` too. The token itself is never recorded, logged or returned.
- `POST /_control/reset` — mode `ok`, calls and message ids cleared.

Use only the test token literal of the plan (`test-telegram-token-not-real`) and made-up chat ids.
