/**
 * Session lifecycle manager.
 *
 * Manages the complete lifecycle of a balance session:
 * - Detects session start/end via SessionDetector
 * - Accumulates data during active sessions
 * - Computes final metrics on session end
 * - Generates unique session IDs
 */

import { RawIMUData, ProcessedFrame, Session, BalanceMetrics, SessionState } from '../types.js';

export class SessionManager {
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private sessionStartEpoch: number = 0;
  private rawBuffer: RawIMUData[] = [];
  private frameBuffer: ProcessedFrame[] = [];
  private lastMetrics: BalanceMetrics | null = null;

  /** Check if a session is currently active */
  isActive(): boolean {
    return this.currentSessionId !== null;
  }

  /** Get the current session ID */
  getSessionId(): string | null {
    return this.currentSessionId;
  }

  /** Get elapsed time of current session in seconds */
  getElapsedSeconds(): number {
    if (!this.isActive() || this.rawBuffer.length === 0) return 0;
    const lastTime = this.rawBuffer[this.rawBuffer.length - 1].t;
    return (lastTime - this.sessionStartTime) / 1000;
  }

  /**
   * Called when session state transitions to 'active'.
   */
  startSession(timestamp: number): void {
    this.currentSessionId = generateSessionId();
    this.sessionStartTime = timestamp;
    this.sessionStartEpoch = Date.now();
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;
  }

  /**
   * Record a raw data sample during an active session.
   */
  addRawSample(data: RawIMUData): void {
    if (this.isActive()) {
      this.rawBuffer.push(data);
    }
  }

  /**
   * Record a processed frame during an active session.
   */
  addProcessedFrame(frame: ProcessedFrame): void {
    if (this.isActive()) {
      this.frameBuffer.push(frame);
      if (frame.metrics) {
        this.lastMetrics = frame.metrics;
      }
    }
  }

  /**
   * Called when session state transitions to 'ended'.
   * Returns the completed session data.
   */
  endSession(): Session | null {
    if (!this.currentSessionId || !this.lastMetrics) return null;

    const endTime = this.rawBuffer.length > 0
      ? this.rawBuffer[this.rawBuffer.length - 1].t
      : this.sessionStartTime;

    const session: Session = {
      id: this.currentSessionId,
      startTime: this.sessionStartEpoch,
      endTime: Date.now(),
      duration: (endTime - this.sessionStartTime) / 1000,
      finalMetrics: this.lastMetrics,
      rawData: this.rawBuffer,
      timeSeries: this.frameBuffer,
    };

    // Reset — create new arrays rather than copying; session now owns the old ones
    this.currentSessionId = null;
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;

    return session;
  }

  /** Reset completely */
  reset(): void {
    this.currentSessionId = null;
    this.sessionStartTime = 0;
    this.sessionStartEpoch = 0;
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;
  }
}

/** Generate a unique session ID (timestamp + random suffix) */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}
