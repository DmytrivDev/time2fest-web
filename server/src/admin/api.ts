/** One call of the owner interface (`/cms-api`) from an admin slice: same-origin, session cookie. */
export interface ApiAnswer {
  status: number;
  body: unknown;
}

export async function callApi(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<ApiAnswer> {
  const res = await fetch(`/cms-api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed: unknown = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}
