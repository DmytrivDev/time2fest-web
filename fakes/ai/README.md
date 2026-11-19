# Fake AI (SPEC-09 AC-49)

Stands in for Anthropic and DeepSeek in tests and the load run. `node:http` only, no dependencies.
It is **not** in `docker-compose.yml` (SPEC-02 AC-4): the test or the load runner starts it.

- In tests: `const { url, close } = await startFakeAi({ port: 0 })` from `fakes/ai/server.mjs`.
- By hand: `node fakes/ai/server.mjs --port 4010`.

Endpoints: `POST /v1/messages` (Anthropic Messages, with `usage`), `POST /chat/completions` (DeepSeek, with `usage`).

Control API (per provider `anthropic` | `deepseek`), `POST /_control/<provider>` with any of:
`score` (number, or `{marker, score}` / a list of them, matched in the text between `<<<T2F_TEXT` and `T2F_TEXT>>>`),
`translation`, `delayMs`, `errorRate` (0..1, answers 500), `down` (429 | 529 | 503), `usage` (wire fields, or `null` to omit),
`corrupt` (`prose` | `empty` | `out-of-range`).
`GET /_control/requests` returns the last 100 requests `{provider, path, headers, body, at}`; `POST /_control/reset` clears knobs and the ring.
A request whose system text mentions "translat" gets the translation answer; any other gets `{"score": n}`.
