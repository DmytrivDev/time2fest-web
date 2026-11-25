# Fake Google sign-in (OIDC)

For tests of SPEC-10 (Google sign-in, AC-17…AC-22, AC-53). Compose service `oidc`: image `ghcr.io/navikt/mock-oauth2-server:7.0.2`, `127.0.0.1:8091 → 8080`, `JSON_CONFIG={"interactiveLogin":true}`. CI runs the same image as a service.

- Issuer: `http://127.0.0.1:8091/google`; discovery `http://127.0.0.1:8091/google/.well-known/openid-configuration`. The issuer id (`google`) is any path segment — the mock accepts any client id and secret.
- Interactive login: the authorize URL answers with an HTML form; a test POSTs it with the fields `username` and `claims` (a JSON object merged into the id_token, e.g. `{"email":"…","email_verified":true,"name":"…"}`; `sub` is the `username` unless `claims` sets it). Helper: `server/test/support/fakeOidc.ts` (`fakeGoogleLogin`, `fakeGoogleCancel`).
- Field names and claims shape are proven by the spike `server/test/integration/auth-spike.int.test.ts` (outcome S5).

No test or process of this wave ever reaches accounts.google.com.
