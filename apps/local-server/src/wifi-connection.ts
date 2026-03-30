/**
 * WiFi TCP connection to the ESP32.
 *
 * Connects to the ESP32's TCP server (default port 8888) and reads
 * JSON Lines exactly like the serial connection does, so both feed
 * the same processing pipeline.
 *
 * Usage:
 *   pnpm --filter local-server dev -- --wifi              # auto force-plate.local
 *   pnpm --filter local-server dev -- --wifi 192.168.1.42
 *   pnpm --filter local-server dev -- --wifi force-plate.local
 */

import net from 'net';
import { parseSerialLine, isStatusMessage, RawForceData } from '@force-plate/processing';

export interface WifiConfig {
  host: string;
  port: number;
}

type DataCallback   = (data: RawForceData) => void;
type StatusCallback = (status: Record<string, unknown>) => void;
type ErrorCallback  = (error: Error) => void;

export class WifiConnection {
  private socket: net.Socket | null = null;
  private lineBuffer = '';
  private onData?:   DataCallback;
  private onStatus?: StatusCallback;
  private onError?:  ErrorCallback;
  private reconnectTimeout?: ReturnType<typeof setTimeout>;
  private destroyed = false;

  constructor(private config: WifiConfig = { host: 'force-plate.local', port: 8888 }) {}

  setDataHandler(handler: DataCallback):   void { this.onData   = handler; }
  setStatusHandler(handler: StatusCallback): void { this.onStatus = handler; }
  setErrorHandler(handler: ErrorCallback):  void { this.onError  = handler; }

  /** Open TCP connection; auto-reconnects on disconnect. */
  connect(): void {
    this.destroyed = false;
    this._connect();
  }

  private _connect(): void {
    if (this.destroyed) return;

    const socket = net.createConnection(this.config.port, this.config.host);
    this.socket = socket;
    this.lineBuffer = '';

    socket.on('connect', () => {
      console.log(`[WiFi] Connected to ${this.config.host}:${this.config.port}`);
      this.onStatus?.({ status: 'wifi_tcp_connected', host: this.config.host });
    });

    socket.on('data', (chunk: Buffer) => {
      this.lineBuffer += chunk.toString('utf8');

      let newlineIdx: number;
      while ((newlineIdx = this.lineBuffer.indexOf('\n')) !== -1) {
        const line = this.lineBuffer.slice(0, newlineIdx).trim();
        this.lineBuffer = this.lineBuffer.slice(newlineIdx + 1);

        if (!line) continue;

        if (isStatusMessage(line)) {
          try { this.onStatus?.(JSON.parse(line)); } catch { /* ignore */ }
        } else {
          const parsed = parseSerialLine(line);
          if (parsed) this.onData?.(parsed);
        }
      }
    });

    socket.on('close', () => {
      if (this.destroyed) return;
      console.log('[WiFi] Disconnected. Reconnecting in 3s...');
      this.onStatus?.({ status: 'wifi_tcp_disconnected' });
      this.reconnectTimeout = setTimeout(() => this._connect(), 3000);
    });

    socket.on('error', (err: Error) => {
      const quiet = (err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ||
                    (err as NodeJS.ErrnoException).code === 'ENOTFOUND';
      if (!quiet) this.onError?.(err);
      socket.destroy();
    });
  }

  /** Send a command string to the ESP32 (e.g. "start\n" or "stop\n"). */
  write(data: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(data);
    }
  }

  /** Cleanly close the connection (no reconnect). */
  close(): void {
    this.destroyed = true;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.socket?.destroy();
    this.socket = null;
  }

  isConnected(): boolean {
    return !!(this.socket && !this.socket.destroyed && this.socket.readyState === 'open');
  }
}
