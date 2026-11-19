import net from 'node:net';

export type ProxyMode = 'forward' | 'blackhole';

/**
 * Minimal local TCP forwarder used to simulate real DynamoDB Local outages:
 *
 * - `stop()` refuses connections and drops open sockets (connection refused).
 * - `blackhole()` keeps accepting TCP connections but swallows every byte and
 *   never answers (a hung server). It never reaches DynamoDB Local.
 * - `forward()` restores normal forwarding.
 * - `start()` listens again on the very same port after a `stop()`.
 *
 * Every mode change drops the open sockets so clients cannot keep reusing a
 * connection opened under the previous mode. It forwards bytes only, so the
 * application talks to DynamoDB Local through a real socket.
 */
export class TcpProxy {
  private server: net.Server | undefined;
  private readonly sockets = new Set<net.Socket>();
  private boundPort = 0;
  private currentMode: ProxyMode = 'forward';

  constructor(
    private readonly targetHost: string,
    private readonly targetPort: number,
  ) {}

  get port(): number {
    return this.boundPort;
  }

  get isUp(): boolean {
    return this.server !== undefined;
  }

  get mode(): ProxyMode {
    return this.currentMode;
  }

  /** Listens on 127.0.0.1; reuses the previous port after a stop. */
  async start(): Promise<void> {
    if (this.server !== undefined) {
      return;
    }
    const server = net.createServer((client) => this.accept(client));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.boundPort, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    this.boundPort = typeof address === 'object' && address ? address.port : 0;
    this.server = server;
  }

  /** Accepts connections but never answers them. */
  blackhole(): void {
    this.currentMode = 'blackhole';
    this.dropSockets();
  }

  /** Back to normal forwarding. */
  forward(): void {
    if (this.currentMode === 'forward') {
      return;
    }
    this.currentMode = 'forward';
    this.dropSockets();
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (server === undefined) {
      return;
    }
    this.server = undefined;
    this.dropSockets();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private accept(client: net.Socket): void {
    this.track(client);
    if (this.currentMode === 'blackhole') {
      // Swallow whatever the client sends and never write back.
      client.on('data', () => undefined);
      return;
    }
    const upstream = net.connect(this.targetPort, this.targetHost);
    this.track(upstream);
    client.on('data', (chunk) => upstream.write(chunk));
    upstream.on('data', (chunk) => client.write(chunk));
    client.on('close', () => upstream.destroy());
    upstream.on('close', () => client.destroy());
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => socket.destroy());
  }

  private dropSockets(): void {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
  }
}
