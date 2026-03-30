/**
 * Serial port wrapper for ESP32 communication.
 *
 * Reads JSON Lines from the ESP32 USB serial port and emits
 * parsed force plate data frames. Also supports writing commands
 * ("start\n", "stop\n") back to the ESP32.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from 'serialport';
import { parseSerialLine, isStatusMessage, RawForceData } from '@force-plate/processing';

export interface SerialConfig {
  path: string;
  baudRate: number;
}

export type DataCallback   = (data: RawForceData) => void;
export type StatusCallback = (status: Record<string, unknown>) => void;
export type ErrorCallback  = (error: Error) => void;

export class SerialConnection {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private onData?: DataCallback;
  private onStatus?: StatusCallback;
  private onError?: ErrorCallback;

  constructor(
    private config: SerialConfig = { path: '', baudRate: 115200 },
  ) {}

  setDataHandler(handler: DataCallback):   void { this.onData   = handler; }
  setStatusHandler(handler: StatusCallback): void { this.onStatus = handler; }
  setErrorHandler(handler: ErrorCallback):  void { this.onError  = handler; }

  /** Open serial connection */
  async open(path?: string): Promise<void> {
    if (path) this.config.path = path;

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.config.path,
        baudRate: this.config.baudRate,
      }, (err) => {
        if (err) { reject(err); return; }

        this.parser = this.port!.pipe(new ReadlineParser({ delimiter: '\n' }));

        this.parser.on('data', (line: string) => {
          if (isStatusMessage(line)) {
            try {
              const status = JSON.parse(line.trim());
              this.onStatus?.(status);
            } catch { /* ignore */ }
            return;
          }

          const data = parseSerialLine(line);
          if (data) this.onData?.(data);
        });

        this.port!.on('error', (err: Error) => {
          this.onError?.(err);
        });

        resolve();
      });
    });
  }

  /** Send a command string to the ESP32 (e.g. "start\n" or "stop\n"). */
  write(data: string): void {
    if (this.port && this.port.isOpen) {
      this.port.write(data);
    }
  }

  /** Close serial connection */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.port && this.port.isOpen) {
        this.port.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  isOpen(): boolean {
    return this.port?.isOpen ?? false;
  }

  /** List available serial ports */
  static async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer }));
  }
}

/**
 * Simulated serial connection that generates synthetic force plate data.
 * Useful for development and testing without hardware.
 */
export class SimulatedSerial {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onData?: DataCallback;
  private sampleIndex = 0;
  private startTime = 0;

  constructor(private sampleRate: number = 40) {}

  setDataHandler(handler: DataCallback): void { this.onData = handler; }

  /** Start generating simulated force plate data */
  start(): void {
    this.startTime = Date.now();
    this.sampleIndex = 0;

    this.intervalId = setInterval(() => {
      const t = Date.now() - this.startTime;
      const time = this.sampleIndex / this.sampleRate;

      // Base load: equal weight on all 4 corners (~50kg total → ~12.5kg each)
      const baseLoad = 125000;

      // Simulate gentle sway as COP shift
      const swayFreq = 0.3;   // Hz, natural sway
      const swayAmp  = 0.03;  // fraction of base load

      const copX = swayAmp * Math.sin(2 * Math.PI * swayFreq * time);
      const copY = swayAmp * Math.cos(2 * Math.PI * swayFreq * 0.7 * time);

      // Distribute load based on COP offset
      const noise = () => (Math.random() - 0.5) * baseLoad * 0.005;
      const f0 = baseLoad * (1 - copX + copY) / 4 + noise();   // front-left
      const f1 = baseLoad * (1 + copX + copY) / 4 + noise();   // front-right
      const f2 = baseLoad * (1 - copX - copY) / 4 + noise();   // back-left
      const f3 = baseLoad * (1 + copX - copY) / 4 + noise();   // back-right

      this.onData?.({ t, f0, f1, f2, f3 });
      this.sampleIndex++;
    }, 1000 / this.sampleRate);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
