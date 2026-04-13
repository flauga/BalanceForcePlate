/**
 * Serial port wrapper for ESP32 communication.
 *
 * Reads the text-based protocol from the ESP32 USB serial port:
 *   Posting:  [<ms>ms] FL:<g>g FR:<g>g BL:<g>g BR:<g>g TOTAL:<g>g
 *   Status:   [STATUS] {json}
 *   Cal:      [CAL:<n>] STEP:1/2/3 ...
 *   Cal done: [CAL:<n>] DONE ...
 *   Info:     [INFO] message
 */

import type { SerialPort as SerialPortType, ReadlineParser as ReadlineParserType } from 'serialport';
import pkg from 'serialport';
const { SerialPort, ReadlineParser } = pkg;

export interface SerialConfig {
  path: string;
  baudRate: number;
}

export interface RawForceData {
  t: number;
  fl: number;
  fr: number;
  bl: number;
  br: number;
  total: number;
}

export type DataCallback   = (data: RawForceData) => void;
export type StatusCallback = (status: Record<string, unknown>) => void;
export type RawLineCallback = (line: string) => void;
export type ErrorCallback  = (error: Error) => void;

/**
 * Parse a posting line:
 * [12345ms] FL:123.45g FR:100.00g BL:80.00g BR:90.00g TOTAL:393.45g
 */
function parsePostingLine(line: string): RawForceData | null {
  const msM = line.match(/^\[(\d+)ms\]/);
  if (!msM) return null;
  const t = parseInt(msM[1]);

  const fl = parseFloat(line.match(/FL:([-\d.]+)g/)?.[1] ?? 'NaN');
  const fr = parseFloat(line.match(/FR:([-\d.]+)g/)?.[1] ?? 'NaN');
  const bl = parseFloat(line.match(/BL:([-\d.]+)g/)?.[1] ?? 'NaN');
  const br = parseFloat(line.match(/BR:([-\d.]+)g/)?.[1] ?? 'NaN');
  const totalM = line.match(/TOTAL:([-\d.]+)g/);
  const total = totalM ? parseFloat(totalM[1]) : fl + fr + bl + br;

  if (isNaN(fl) || isNaN(fr) || isNaN(bl) || isNaN(br)) return null;
  // Reject frames where any cell reads exactly 0 but others have significant force
  // (indicates an HX711 timeout, not a real measurement)
  const hasZero = fl === 0 || fr === 0 || bl === 0 || br === 0;
  if (hasZero && total > 50) return null;
  return { t, fl, fr, bl, br, total };
}

export class SerialConnection {
  private port: SerialPortType | null = null;
  private parser: ReadlineParserType | null = null;
  private onData?: DataCallback;
  private onStatus?: StatusCallback;
  private onRawLine?: RawLineCallback;
  private onError?: ErrorCallback;

  constructor(
    private config: SerialConfig = { path: '', baudRate: 115200 },
  ) {}

  setDataHandler(handler: DataCallback):     void { this.onData    = handler; }
  setStatusHandler(handler: StatusCallback): void { this.onStatus  = handler; }
  setRawLineHandler(handler: RawLineCallback): void { this.onRawLine = handler; }
  setErrorHandler(handler: ErrorCallback):   void { this.onError   = handler; }

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
          const trimmed = line.trim();
          if (!trimmed) return;

          // Forward raw line for cal/info passthrough to dashboard
          this.onRawLine?.(trimmed);

          // [STATUS] {json}
          if (trimmed.startsWith('[STATUS]')) {
            try {
              const json = trimmed.slice(8).trim();
              const status = JSON.parse(json);
              this.onStatus?.(status);
            } catch { /* ignore */ }
            return;
          }

          // Posting line
          const data = parsePostingLine(trimmed);
          if (data) {
            this.onData?.(data);
            return;
          }
        });

        this.port!.on('error', (err: Error) => {
          this.onError?.(err);
        });

        resolve();
      });
    });
  }

  write(data: string): void {
    if (this.port && this.port.isOpen) {
      this.port.write(data);
    }
  }

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

  static async listPorts(): Promise<{ path: string; manufacturer?: string; friendlyName?: string }[]> {
    const ports = await SerialPort.list();
    return ports.map(p => ({ path: p.path, manufacturer: p.manufacturer, friendlyName: (p as any).friendlyName }));
  }
}
