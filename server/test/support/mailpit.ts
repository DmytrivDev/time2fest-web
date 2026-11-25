/**
 * Mailpit reader for SPEC-10 tests (W21, AC-36/37): waits for the message to one recipient through the HTTP API.
 * Main Mailpit API: 127.0.0.1:8025 (SMTP 1025); the chaos instance: 127.0.0.1:8026 (SMTP 1026). Read only.
 */
export const MAILPIT_API = 'http://127.0.0.1:8025';
export const MAILPIT_CHAOS_API = 'http://127.0.0.1:8026';

export interface MailpitMessage {
  id: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string[]>;
}

interface SearchHit {
  ID: string;
}

/** Number of messages to `to` in this Mailpit (search API). */
export async function countMessages(api: string, to: string): Promise<number> {
  const r = await fetch(`${api}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=50`);
  if (!r.ok) throw new Error(`mailpit search ${r.status}`);
  const body = (await r.json()) as { messages?: SearchHit[] };
  return body.messages?.length ?? 0;
}

/** The newest message to `to`, polled until `timeoutMs` (default 5 s, AC-36). */
export async function waitForMessage(api: string, to: string, timeoutMs = 5000): Promise<MailpitMessage> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const r = await fetch(`${api}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=1`);
    if (r.ok) {
      const hit = ((await r.json()) as { messages?: SearchHit[] }).messages?.[0];
      if (hit) {
        const m = (await (await fetch(`${api}/api/v1/message/${hit.ID}`)).json()) as { Subject: string; Text: string; HTML: string };
        const headers = (await (await fetch(`${api}/api/v1/message/${hit.ID}/headers`)).json()) as Record<string, string[]>;
        return { id: hit.ID, subject: m.Subject, text: m.Text, html: m.HTML, headers };
      }
    }
    if (Date.now() > until) throw new Error('mailpit: no message within the timeout');
    await new Promise((res) => setTimeout(res, 100));
  }
}
