/**
 * The int run's `.env` points Google at the loopback fake OIDC, which only the `test` class accepts (SPEC-10 AC-47).
 * Fixtures that start a rehearsal/production-class deps or process from `process.env` spread this to stay valid.
 */
export const NON_TEST_GOOGLE = { T2F_GOOGLE_DISCOVERY_URL: 'https://oidc.invalid/.well-known/openid-configuration' } as const;
