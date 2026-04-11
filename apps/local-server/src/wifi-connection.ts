/**
 * TCP + UDP client that connects to the ESP32's WiFiStream server.
 *
 * - TCP (port 8888): commands (outbound to ESP) + status/cal messages (inbound)
 * - UDP (port 8889): high-frequency data frames (inbound from ESP)
 *
 * TCP alone suffers from delayed-ACK stalls (~200ms) that cap throughput at
 * ~10 Hz. UDP is fire-and-forget with no ACK overhead, giving true 40 Hz.
 *
 * Presents the same callback interface as SerialConnection so index.ts
 * can treat both identically.
 */

import net from 'net';
import dgram from 'dgram';
import dns from 'dns';

export interface WifiConfig {
  host: string;
  port: number;
  udpPort?: number;
}

export interface RawForceData {
  t: number; fl: number; fr: number; bl: number; br: number; total: number;
}

export type DataCallback    = (data: RawForceData) => void;
export type StatusCallback  = (status: Record<string, unknown>) => void;
export type RawLineCallback = (line: string) => void;
export type ErrorCallback   = (error: Error) => void;

// Cache of last successfully resolved .local -> IP mappings
const resolvedCache = new Map<string, string>();

/**
 * Resolve a hostname, with special handling for .local mDNS names on Windows.
 */
function resolveHost(hostname: string, timeoutMs = 4000): Promise<string> {
  const name = hostname.replace(/\.$/, '').toLowerCase();

  if (!name.endsWith('.local')) {
    return new Promise((resolve, reject) => {
      dns.lookup(name, { family: 4 }, (err, addr) => {
        if (err) reject(err); else resolve(addr);
      });
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let pending = 0;
    const errors: string[] = [];

    const win = (ip: string, method: string) => {
      if (settled) return;
      settled = true;
      resolvedCache.set(name, ip);
      console.log(`[WiFi] Resolved ${hostname} -> ${ip} (via ${method})`);
      resolve(ip);
    };

    const lose = (reason: string) => {
      errors.push(reason);
      if (--pending === 0 && !settled) {
        reject(new Error(`Could not resolve ${hostname}: ${errors.join('; ')}`));
      }
    };

    // Method 1: cached IP
    const cached = resolvedCache.get(name);
    if (cached) {
      pending++;
      win(cached, 'cache');
    }

    if (settled) return;

    // Method 2: OS resolver
    pending++;
    dns.lookup(name, { family: 4 }, (err, addr) => {
      if (!settled) {
        if (err) lose(`dns.lookup: ${err.code}`);
        else win(addr, 'OS resolver');
      }
    });

    // Method 3: raw multicast DNS query
    pending++;
    (() => {
      const MDNS_ADDR = '224.0.0.251';
      const MDNS_PORT = 5353;
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      let sockClosed = false;

      const closeSock = () => {
        if (!sockClosed) { sockClosed = true; try { sock.close(); } catch { /**/ } }
      };

      const query = buildMdnsQuery(name);

      sock.on('message', (msg: Buffer) => {
        if (settled) { closeSock(); return; }
        try {
          const ip = parseMdnsARecord(msg);
          if (ip) { closeSock(); win(ip, 'mDNS multicast'); }
        } catch { /**/ }
      });

      sock.on('error', () => { closeSock(); lose('mDNS socket error'); });

      sock.bind(0, () => {
        try { sock.addMembership(MDNS_ADDR); } catch { /**/ }
        const send = () => {
          if (settled || sockClosed) return;
          sock.send(query, MDNS_PORT, MDNS_ADDR, () => {
            if (!settled) setTimeout(send, 500);
          });
        };
        send();
      });

      setTimeout(() => {
        closeSock();
        if (!settled) lose('mDNS timeout');
      }, timeoutMs);
    })();
  });
}

function buildMdnsQuery(name: string): Buffer {
  const labels = name.split('.');
  const questionName = Buffer.concat([
    ...labels.map(l => {
      const lb = Buffer.from(l, 'ascii');
      return Buffer.concat([Buffer.from([lb.length]), lb]);
    }),
    Buffer.from([0]),
  ]);
  const header = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, questionName, Buffer.from([0, 1, 0, 1])]);
}

function parseMdnsARecord(msg: Buffer): string | null {
  if (msg.length < 12) return null;
  const ancount = (msg[6] << 8) | msg[7];
  if (ancount === 0) return null;

  let pos = 12;
  const qdcount = (msg[4] << 8) | msg[5];
  for (let q = 0; q < qdcount && pos < msg.length; q++) {
    pos = skipDnsName(msg, pos);
    pos += 4;
  }
  for (let a = 0; a < ancount && pos < msg.length; a++) {
    pos = skipDnsName(msg, pos);
    if (pos + 10 > msg.length) break;
    const type  = (msg[pos] << 8) | msg[pos + 1];
    const rdlen = (msg[pos + 8] << 8) | msg[pos + 9];
    pos += 10;
    if (type === 1 && rdlen === 4 && pos + 4 <= msg.length) {
      return `${msg[pos]}.${msg[pos + 1]}.${msg[pos + 2]}.${msg[pos + 3]}`;
    }
    pos += rdlen;
  }
  return null;
}

function skipDnsName(buf: Buffer, pos: number): number {
  while (pos < buf.length) {
    const len = buf[pos];
    if (len === 0) { pos++; break; }
    if ((len & 0xc0) === 0xc0) { pos += 2; break; }
    pos += 1 + len;
  }
  return pos;
}

function parsePostingLine(line: string): RawForceData | null {
  const msM = line.match(/^\[(\d+)ms\]/);
  if (!msM) return null;
  const t  = parseInt(msM[1]);
  const fl = parseFloat(line.match(/FL:([-\d.]+)g/)?.[1] ?? 'NaN');
  const fr = parseFloat(line.match(/FR:([-\d.]+)g/)?.[1] ?? 'NaN');
  const bl = parseFloat(line.match(/BL:([-\d.]+)g/)?.[1] ?? 'NaN');
  const br = parseFloat(line.match(/BR:([-\d.]+)g/)?.[1] ?? 'NaN');
  const totalM = line.match(/TOTAL:([-\d.]+)g/);
  const total  = totalM ? parseFloat(totalM[1]) : fl + fr + bl + br;
  if (isNaN(fl) || isNaN(fr) || isNaN(bl) || isNaN(br)) return null;
  const hasZero = fl === 0 || fr === 0 || bl === 0 || br === 0;
  if (hasZero && total > 50) return null;
  return { t, fl, fr, bl, br, total };
}

export class WifiConnection {
  private socket: net.Socket | null = null;
  private udpSocket: dgram.Socket | null = null;
  private buf = '';
  private onData?: DataCallback;
  private onStatus?: StatusCallback;
  private onRawLine?: RawLineCallback;
  private onError?: ErrorCallback;
  private udpPort: number;
  private closing = false;

  constructor(private config: WifiConfig) {
    this.udpPort = config.udpPort ?? 8889;
  }

  setDataHandler(h: DataCallback):     void { this.onData    = h; }
  setStatusHandler(h: StatusCallback): void { this.onStatus  = h; }
  setRawLineHandler(h: RawLineCallback): void { this.onRawLine = h; }
  setErrorHandler(h: ErrorCallback):   void { this.onError   = h; }

  async open(): Promise<void> {
    this.closing = false;

    // Resolve hostname
    let host = this.config.host;
    try {
      host = await resolveHost(this.config.host);
    } catch (err) {
      console.warn(`[WiFi] Resolution failed (${(err as Error).message}), trying hostname directly`);
    }

    // Start UDP listener for data frames BEFORE TCP connect
    await this.startUdpListener();

    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      let settled = false;

      // Timeout: reject if TCP connect takes > 5 seconds
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          sock.destroy();
          this.closeUdp();
          reject(new Error(`TCP connect to ${host}:${this.config.port} timed out (5s)`));
        }
      }, 5000);

      sock.connect(this.config.port, host, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.socket = sock;
        resolve();
      });

      // TCP: status, cal, info messages
      sock.on('data', (chunk: Buffer) => {
        if (this.closing) return;
        this.buf += chunk.toString();
        const lines = this.buf.split('\n');
        this.buf = lines.pop() ?? '';
        for (const raw of lines) {
          const line = raw.trim();
          if (!line) continue;
          this.onRawLine?.(line);
          if (line.startsWith('[STATUS]')) {
            try { this.onStatus?.(JSON.parse(line.slice(8).trim())); } catch { /* */ }
            continue;
          }
          // Data lines may still arrive via TCP (fallback / status messages)
          const data = parsePostingLine(line);
          if (data) { this.onData?.(data); }
        }
      });

      sock.on('error', (err: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          this.closeUdp();
          reject(err);
        } else if (this.socket && !this.closing) {
          this.onError?.(err);
        }
      });

      sock.on('close', () => {
        if (this.socket && !this.closing) {
          this.socket = null;
          this.onError?.(new Error('WiFi connection closed'));
        }
      });
    });
  }

  private startUdpListener(): Promise<void> {
    // Close any lingering UDP socket from a previous connection
    this.closeUdp();

    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      sock.on('message', (msg: Buffer) => {
        if (this.closing) return;
        const text = msg.toString().trim();
        if (!text) return;
        // Each UDP packet is one data line
        const data = parsePostingLine(text);
        if (data) {
          this.onData?.(data);
        } else {
          // Not a posting line — could be status JSON or info
          this.onRawLine?.(text);
          if (text.startsWith('[STATUS]')) {
            try { this.onStatus?.(JSON.parse(text.slice(8).trim())); } catch { /* */ }
          }
        }
      });

      sock.on('error', (err: Error) => {
        console.error('[WiFi UDP] Error:', err.message);
        // UDP errors are non-fatal — TCP still works
      });

      sock.bind(this.udpPort, () => {
        console.log(`[WiFi UDP] Listening on port ${this.udpPort}`);
        this.udpSocket = sock;
        resolve();
      });
    });
  }

  private closeUdp(): void {
    if (this.udpSocket) {
      try { this.udpSocket.close(); } catch { /* */ }
      this.udpSocket = null;
    }
  }

  write(data: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    }
  }

  close(): void {
    this.closing = true;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.closeUdp();
  }

  isOpen(): boolean { return this.socket !== null && !this.socket.destroyed; }
}
