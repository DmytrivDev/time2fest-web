// A loopback origin that records what the edge forwarded and answers scripted paths.
import { createHash } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type StubCall = {
  method: string;
  /** Path plus query string, as received. */
  url: string;
  headers: IncomingHttpHeaders;
  bodySha256: string;
  bodyBytes: number;
};

export type OriginStub = {
  url: string;
  calls: StubCall[];
  close: () => Promise<void>;
};

export const STUB_COOKIES_BODY = '{"ok":true,"data":{"stub":"cookies"}}';
export const STUB_JSON503_BODY = '{"ok":false,"error":{"code":"unavailable","retryAfterMs":1000}}';

export function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export async function startOriginStub(): Promise<OriginStub> {
  const calls: StubCall[] = [];
  const server: Server = createServer((req, res) => {
    const hash = createHash('sha256');
    let bytes = 0;
    req.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      bytes += chunk.length;
    });
    req.on('end', () => {
      const call: StubCall = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        bodySha256: hash.digest('hex'),
        bodyBytes: bytes,
      };
      calls.push(call);
      const path = call.url.split('?')[0];
      switch (path) {
        case '/api/stub/cookies':
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'set-cookie': ['a=1; Path=/; HttpOnly', 'b=2; Path=/; Secure'],
            'x-custom': 'custom-value',
          });
          res.end(STUB_COOKIES_BODY);
          return;
        case '/api/stub/json503':
          res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' });
          res.end(STUB_JSON503_BODY);
          return;
        case '/api/stub/html530':
          res.writeHead(530, { 'content-type': 'text/html' });
          res.end('<html><body>error 1033</body></html>');
          return;
        case '/api/stub/html502':
          res.writeHead(502, { 'content-type': 'text/html' });
          res.end('<html><body>Bad gateway</body></html>');
          return;
        default:
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ echo: { method: call.method, url: call.url, sha256: call.bodySha256 } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
