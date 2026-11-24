# Server image (SPEC-13a AC-1). Build context = the repository root as produced by `git archive <sha>`
# (no `.git`, no ignored files):
#   git archive <sha> | docker build -f server/Dockerfile --build-arg T2F_COMMIT=<sha> -t t2f-server:<sha> -
# Runtime env comes only from the node's env files; nothing secret is in any layer or build argument.
# Plain Dockerfile syntax only (no BuildKit-only mounts), so the classic builder can build it too.

# node:22-bookworm-slim, linux/amd64 + arm64 index, resolved 2026-11-17
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Same pnpm as CI (`.github/workflows/verify.yml`).
RUN npm install -g pnpm@12.4.2 && npm cache clean --force \
 && mkdir -p /app && chown node:node /app
WORKDIR /app
USER node

FROM base AS build
ARG T2F_COMMIT
RUN echo "$T2F_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || { echo 'T2F_COMMIT must be 40 hex' >&2; exit 1; }
# Workspace manifests first, so the dependency layer is reused while they do not change.
COPY --chown=node:node package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY --chown=node:node server/package.json server/
COPY --chown=node:node packages/contracts/package.json packages/contracts/
COPY --chown=node:node packages/rules/package.json packages/rules/
COPY --chown=node:node workers/edge/package.json workers/edge/
# devDependencies stay: `pnpm migrate` (Payload CLI over tsx) runs in a one-shot container of this image.
RUN pnpm install --frozen-lockfile --filter @time2fest/server... && pnpm store prune
COPY --chown=node:node packages/contracts/ packages/contracts/
COPY --chown=node:node packages/rules/ packages/rules/
COPY --chown=node:node server/ server/
# The seed reads the catalog sources from the repository's `data/` (server/src/seed/registry.ts).
COPY --chown=node:node data/ data/
# `next build` evaluates the Payload config, which validates the environment. These build-only
# placeholders (class `test`, loopback, nothing listens there) exist for this one RUN and are
# never set in the runtime stage; no connection is opened during the build.
# `server/test` is dropped first: the image never runs tests, and since SPEC-06 the integration tests import the
# web transport (`../lib/api/http/realtime`, `centrifuge`) that is not in this context, so `next build`'s type
# check failed on them (deploy of 2026-11-18, TS7006 in realtime-transport.int.test.ts).
RUN rm -rf server/test \
 && T2F_ENV=test \
    DATABASE_URI=postgres://127.0.0.1:5432/t2f_build \
    REDIS_URL=redis://127.0.0.1:6379/0 \
    T2F_REDIS_PREFIX=t2f:build: \
    PAYLOAD_SECRET=build-only-placeholder-not-a-secret \
    pnpm --dir server build \
 && rm -rf server/.next/cache

FROM base AS runtime
ARG T2F_COMMIT
# PostgreSQL 17 client (SPEC-13b AC-47, [П-1]): `pg_dump` of the hourly backup and `pg_restore` of
# `ops restore-pull`. The client major must equal the node's server major (postgres:17.12-alpine);
# Debian bookworm ships only 15, so it comes from the PGDG apt repository (apt.postgresql.org,
# `bookworm-pgdg`), resolved 2026-11-24. Only the major is pinned (`postgresql-client-17`): PGDG keeps
# one current minor. The signing key is fetched over TLS from postgresql.org into the keyring path the
# `postgresql-common` setup script uses, then its primary fingerprint is checked against the pinned
# literal `PGDG_KEY_FPR` (not a build arg; security S-1: TLS alone is not the trust root), so a different
# key fails the build before apt trusts it. curl and gpg are removed again and the apt lists are dropped,
# so the layer holds the client only (~15 MB). The final `grep` fails the build if the client is not 17.
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gpg; \
    PGDG_KEY_FPR=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8; \
    install -d -m 0755 /usr/share/postgresql-common/pgdg; \
    curl -fsSL --proto '=https' --tlsv1.2 -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      https://www.postgresql.org/media/keys/ACCC4CF8.asc; \
    fpr="$(GNUPGHOME="$(mktemp -d)" gpg --batch --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
      | awk -F: '$1 == "fpr" { print $10; exit }')"; \
    if [ "$fpr" != "$PGDG_KEY_FPR" ]; then echo "PGDG signing key fingerprint mismatch: got '$fpr'" >&2; exit 1; fi; \
    echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main' \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-17; \
    apt-get purge -y --auto-remove curl gpg; \
    rm -rf /var/lib/apt/lists/*; \
    pg_dump --version | grep -q ' 17\.'; \
    pg_restore --version | grep -q ' 17\.'
COPY --from=build --chown=node:node /app /app
ENV NODE_ENV=production \
    T2F_COMMIT=$T2F_COMMIT
LABEL org.opencontainers.image.revision=$T2F_COMMIT
USER node
WORKDIR /app/server
CMD ["node", "scripts/image-start.mjs"]
