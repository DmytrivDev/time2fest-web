/**
 * Connection-token times (SPEC-06 AC-14). Ring 1: the clock value and the random value come in as
 * parameters; nothing here reads time or randomness itself.
 */

/** Shortest default lifetime of a connection token, in seconds. */
export const TOKEN_TTL_MIN_SECONDS = 2_700;
/** Longest default lifetime of a connection token, in seconds. */
export const TOKEN_TTL_MAX_SECONDS = 4_500;

export interface TokenTimes {
  /** Issued at, epoch seconds. */
  iat: number;
  /** Expires at, epoch seconds; always set. */
  exp: number;
}

/**
 * `iat` = the clock in whole seconds; `exp` = `iat` + `ttlSeconds`, or by default a uniform whole number
 * of seconds in [2 700; 4 500] picked by `rand` ∈ [0, 1), so that tokens issued together expire apart.
 */
export function tokenTimes(nowMs: number, rand: number, ttlSeconds?: number): TokenTimes {
  const iat = Math.floor(nowMs / 1000);
  const span = TOKEN_TTL_MAX_SECONDS - TOKEN_TTL_MIN_SECONDS + 1;
  const spread = Math.min(span - 1, Math.max(0, Math.floor(rand * span)));
  return { iat, exp: iat + (ttlSeconds ?? TOKEN_TTL_MIN_SECONDS + spread) };
}

/** The wire `expiresAt` of a token: ISO-8601 UTC of `exp`. */
export function expiresAtIso(exp: number): string {
  return new Date(exp * 1000).toISOString();
}
