/**
 * Balance session detection: detects when a user steps on/off the board.
 *
 * Detection is based on accelerometer variance:
 * - Step-on: sustained increase in acceleration variance (dynamic loading)
 * - Step-off: return to low variance (static/unloaded state)
 *
 * The detector uses hysteresis and debouncing to avoid false triggers.
 */

import { RawIMUData, SessionState } from '../types.js';

export interface DetectorConfig {
  /** Variance threshold to detect board loaded (g²). Default: 0.01 */
  onThreshold: number;
  /** Variance threshold to detect board unloaded (g²). Default: 0.005 */
  offThreshold: number;
  /** Duration (ms) above threshold to confirm step-on. Default: 500 */
  onDebounceMs: number;
  /** Duration (ms) below threshold to confirm step-off. Default: 1000 */
  offDebounceMs: number;
  /** Window size for variance calculation (samples). Default: 50 */
  windowSize: number;
}

const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  onThreshold: 0.01,
  offThreshold: 0.005,
  onDebounceMs: 500,
  offDebounceMs: 1000,
  windowSize: 50,
};

export class SessionDetector {
  private config: DetectorConfig;
  private state: SessionState = 'idle';

  // Circular buffer for acceleration magnitude
  private buffer: number[] = [];
  private bufferIndex = 0;

  // Debounce tracking
  private candidateState: SessionState | null = null;
  private candidateStartTime = 0;

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  /** Get the current session state */
  getState(): SessionState {
    return this.state;
  }

  /** Reset detector to idle state */
  reset(): void {
    this.state = 'idle';
    this.buffer = [];
    this.bufferIndex = 0;
    this.candidateState = null;
    this.candidateStartTime = 0;
  }

  /**
   * Process a new IMU sample and return the updated session state.
   *
   * @param data Raw IMU data
   * @returns Current session state after processing
   */
  update(data: RawIMUData): SessionState {
    // After a session ends, stay in 'ended' until reset
    if (this.state === 'ended') return this.state;

    // Compute acceleration magnitude deviation from 1g
    const accMag = Math.sqrt(data.ax * data.ax + data.ay * data.ay + data.az * data.az);
    const deviation = accMag - 1.0;

    // Add to circular buffer
    if (this.buffer.length < this.config.windowSize) {
      this.buffer.push(deviation);
    } else {
      this.buffer[this.bufferIndex % this.config.windowSize] = deviation;
    }
    this.bufferIndex++;

    // Need a full window before making decisions
    if (this.buffer.length < this.config.windowSize) return this.state;

    // Compute variance of deviation
    const variance = computeVariance(this.buffer);

    if (this.state === 'idle') {
      // Looking for step-on
      if (variance > this.config.onThreshold) {
        if (this.candidateState !== 'active') {
          this.candidateState = 'active';
          this.candidateStartTime = data.t;
        } else if (data.t - this.candidateStartTime >= this.config.onDebounceMs) {
          this.state = 'active';
          this.candidateState = null;
        }
      } else {
        this.candidateState = null;
      }
    } else if (this.state === 'active') {
      // Looking for step-off
      if (variance < this.config.offThreshold) {
        if (this.candidateState !== 'ended') {
          this.candidateState = 'ended';
          this.candidateStartTime = data.t;
        } else if (data.t - this.candidateStartTime >= this.config.offDebounceMs) {
          this.state = 'ended';
          this.candidateState = null;
        }
      } else {
        this.candidateState = null;
      }
    }

    return this.state;
  }
}

function computeVariance(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const d = values[i] - mean;
    sumSq += d * d;
  }

  return sumSq / (n - 1);
}
