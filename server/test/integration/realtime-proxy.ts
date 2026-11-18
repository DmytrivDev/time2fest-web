/**
 * A loopback TCP proxy in front of Centrifugo for network-fault tests (SPEC-06 AC-41 … AC-43):
 * `drop()` destroys every open connection, `pause(ms)` refuses new ones for `ms`. It forwards bytes
 * only and never reads or logs them, so a connection token passing through is never printed.
 */
import net from 'node:net';

export interface RealtimeProxy {
  /** The port the proxy listens on (loopback). */
  readonly port: number;
  /** Destroys every open client and upstream socket. */
  drop(): void;
  /** Refuses (destroys on accept) every new connection for `ms`. */
  pause(ms: number): void;
  close(): Promise<void>;
}

/** Starts a proxy on an ephemeral loopback port that forwards to `target` (`http://host:port`). */
export async function startRealtimeProxy(target: string): Promise<RealtimeProxy> {
  const upstream = new URL(target);
  const host = upstream.hostname;
  const port = Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80));
  const sockets = new Set<net.Socket>();
  let pausedUntil = 0;

  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    // A reset while dropping is expected; an unhandled 'error' would crash the worker.
    socket.on('error', () => socket.destroy());
  };

  const server = net.createServer((client) => {
    track(client);
    if (Date.now() < pausedUntil) {
      client.destroy();
      return;
    }
    const remote = net.connect({ host, port });
    track(remote);
    client.pipe(remote);
    remote.pipe(client);
    client.on('close', () => remote.destroy());
    remote.on('close', () => client.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('realtime proxy: no TCP address');

  return {
    port: address.port,
    drop() {
      for (const socket of [...sockets]) socket.destroy();
    },
    pause(ms) {
      pausedUntil = Date.now() + ms;
    },
    close() {
      for (const socket of [...sockets]) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
