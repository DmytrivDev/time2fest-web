/** Port of the readiness check (ring 2, SPEC-13a AC-5/AC-6): technology-neutral, one method. */

/** Whether the server's own dependencies answer. */
export interface ReadinessProbe {
  /** True only when the database AND the fast store answered within `timeoutMs`; never throws. */
  check(timeoutMs: number): Promise<boolean>;
}
