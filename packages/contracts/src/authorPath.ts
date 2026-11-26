/** Author-path wire type (SPEC-14, `GET /api/chat/authors/:authorId/path`). Zod-free. */

export interface AuthorPathPointWire {
  eventId: string;
  /** `true`: a scheduled event whose midnight is still ahead and that has no stamp yet. */
  planned: boolean;
}

export interface AuthorPathResponse {
  points: AuthorPathPointWire[];
  /** The author hides the path (no pass or `showPath` off): `points` is empty. */
  hidden: boolean;
}
