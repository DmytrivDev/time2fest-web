# edge-offline e2e (SPEC-07, AC-18)

`server-stopped.spec.ts` runs only in the separate `edge-offline` Playwright project and is skipped unless both
`T2F_EDGE_OFFLINE=1` and `T2F_EDGE_BASE` are set.

Staging (to be confirmed against `workers/edge/README.md` in the integration pass):

1. Static build with the sim time machine (`NEXT_PUBLIC_ENV=test`), as the `out-edge-test` recipe.
2. `wrangler dev` of `workers/edge` in `production` mode serving that output, `ORIGIN_URL` pointing at a port where nothing listens.
3. `T2F_EDGE_OFFLINE=1 T2F_EDGE_BASE=http://127.0.0.1:<wrangler port> npx playwright test -c playwright.http.config.ts --project=edge-offline`

Until step 2 is done on a real machine the spec is reported as not run.
