/**
 * Serial port wrapper for ESP32 communication.
 *
 * Reads JSON Lines from the ESP32 USB serial port and emits
 * parsed IMU data frames.
 */

import { SerialPort } from 'serialport';
import { ReadlineParser } from 'serialport';
import { parseSerialLine, isStatusMessage, RawIMUData } from '@imu-balance/processing';

export interface SerialConfig {
  path: string;
  baudRate: number;
}

export type DataCallback = (data: RawIMUData) => void;
export type StatusCallback = (status: Record<string, unknown>) => void;
export type ErrorCallback = (error: Error) => void;

export class SerialConnection {
  private port: SerialPort | null = null;
  private parser: ReadlineParser | null = null;
  private onData?: DataCallback;
  private onStatus?: StatusCallback;
  private onError?: ErrorCallback;

  constructor(
    private config: SerialConfig = { path: '', baudRate: 460800 },
  ) {}

  /** Set callback for IMU data frames */
  setDataHandler(handler: DataCallback): void {
    this.onData = handler;
  }

  /** Set callback for status messages */
  setStatusHandler(handler: StatusCallback): void {
    this.onStatus = handler;
  }

  /** Set callback for errors */
  setErrorHandler(handler: ErrorCallback): void {
    this.onError = handler;
  }

  /** Open serial connection */
  async open(path?: string): Promise<void> {
    if (path) this.config.path = path;

    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.config.path,
        baudRate: this.config.baudRate,
      }, (err) => {
        if (err) {
          reject(err);
          return;
        }

        this.parser = this.port!.pipe(new ReadlineParser({ delimiter: '\n' }));

        this.parser.on('data', (line: string) => {
          if (isStatusMessage(line)) {
            try {
              const status = JSON.parse(line.trim());
              this.onStatus?.(status);
            } catch { /* ignore parse errors for status */ }
            return;
          }

          const data = parseSerialLine(line);
          if (data) {
            this.onData?.(data);
          }
        });

        this.port!.on('error', (err: Error) => {
          this.onError?.(err);
        });

        resolve();
      });
    });
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

  /** Check if port is open */
  isOpen(): boolean {
    return this.port?.isOpen ?? false;
  }

  /** List available serial ports */
  static async listPorts(): Promise<{ path: string; manufacturer?: string }[]> {
    const ports = await SerialPort.list();
    return ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer,
    }));
  }
}

/**
 * Simulated serial connection that replays recorded data.
 * Useful for development and testing without hardware.
 */
export class SimulatedSerial {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private onData?: DataCallback;
  private sampleIndex = 0;
  private startTime = 0;

  constructor(private sampleRate: number = 100) {}

  setDataHandler(handler: DataCallback): void {
    this.onData = handler;
  }

  /** Start generating simulated IMU data */
  start(): void {
    this.startTime = Date.now();
    this.sampleIndex = 0;

    this.intervalId = setInterval(() => {
      const t = Date.now() - this.startTime;
      const time = this.sampleIndex / this.sampleRate;

      // Simulate gentle sway with some noise
      const swayFreq = 0.3;  // Hz, natural sway
      const swayAmp = 0.02;  // g

      const ax = swayAmp * Math.sin(2 * Math.PI * swayFreq * time) + (Math.random() - 0.5) * 0.005;
      const ay = swayAmp * Math.cos(2 * Math.PI * swayFreq * 0.7 * time) + (Math.random() - 0.5) * 0.005;
      const az = 0.98 + (Math.random() - 0.5) * 0.01;
      const gx = swayAmp * 50 * Math.cos(2 * Math.PI * swayFreq * time) + (Math.random() - 0.5) * 0.5;
      const gy = -swayAmp * 50 * Math.sin(2 * Math.PI * swayFreq * 0.7 * time) + (Math.random() - 0.5) * 0.5;
      const gz = (Math.random() - 0.5) * 0.2;

      this.onData?.({ t, ax, ay, az, gx, gy, gz });
      this.sampleIndex++;
    }, 1000 / this.sampleRate);
  }

  /** Stop simulated data generation */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
