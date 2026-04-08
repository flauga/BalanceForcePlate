import { RawForceData } from './types.js';

/**
 * Parse a JSON Line from the ESP32 serial stream into RawForceData.
 *
 * Expected format:
 * {"t":123456,"f0":50000,"f1":51200,"f2":49800,"f3":50500}
 *
 * Where f0-f3 are raw HX711 ADC counts from the four load cell corners:
 *   f0 = front-left, f1 = front-right, f2 = back-left, f3 = back-right
 *
 * @param line A single line from the serial stream
 * @returns Parsed data or null if the line is not a valid data frame
 */
export function parseSerialLine(line: string): RawForceData | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null;
  }

  try {
    const obj = JSON.parse(trimmed);

    // Validate required fields
    if (
      typeof obj.t !== 'number' ||
      typeof obj.f0 !== 'number' ||
      typeof obj.f1 !== 'number' ||
      typeof obj.f2 !== 'number' ||
      typeof obj.f3 !== 'number'
    ) {
      return null;
    }

    const result: RawForceData = {
      t: obj.t,
      f0: obj.f0,
      f1: obj.f1,
      f2: obj.f2,
      f3: obj.f3,
    };

    // Optional packet sequence number (for drop detection)
    if (typeof obj.seq === 'number') {
      result.seq = obj.seq;
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * Check if a serial line is a status message (not data).
 *
 * Status messages have a "status" field, e.g.:
 * {"status":"ready","sensor":"hx711","rate":40}
 */
export function isStatusMessage(line: string): boolean {
  try {
    const obj = JSON.parse(line.trim());
    return typeof obj.status === 'string';
  } catch {
    return false;
  }
}
