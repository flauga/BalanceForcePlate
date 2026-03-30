import { RawIMUData } from './types.js';

/**
 * Parse a JSON Line from the ESP32 serial stream into RawIMUData.
 *
 * Expected format:
 * {"t":123456,"ax":0.012,"ay":-0.983,"az":0.021,"gx":0.5,"gy":-0.3,"gz":0.1}
 *
 * @param line A single line from the serial stream
 * @returns Parsed data or null if the line is not a valid data frame
 */
export function parseSerialLine(line: string): RawIMUData | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const obj = JSON.parse(trimmed);

    // Validate required fields
    if (
      typeof obj.t !== 'number' ||
      typeof obj.ax !== 'number' ||
      typeof obj.ay !== 'number' ||
      typeof obj.az !== 'number' ||
      typeof obj.gx !== 'number' ||
      typeof obj.gy !== 'number' ||
      typeof obj.gz !== 'number'
    ) {
      return null;
    }

    return {
      t: obj.t,
      ax: obj.ax,
      ay: obj.ay,
      az: obj.az,
      gx: obj.gx,
      gy: obj.gy,
      gz: obj.gz,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a serial line is a status message (not data).
 *
 * Status messages have a "status" field, e.g.:
 * {"status":"ready","sensor":"bmi323","rate":100}
 */
export function isStatusMessage(line: string): boolean {
  try {
    const obj = JSON.parse(line.trim());
    return typeof obj.status === 'string';
  } catch {
    return false;
  }
}
