/**
 * Main processing pipeline: orchestrates the full signal processing chain.
 *
 * Raw force data → COP calculation → Low-pass filter → Metrics
 *
 * COP (Center of Pressure) is derived from 4 corner load cell readings:
 *   COP_x = ((f1 + f3) - (f0 + f2)) / fz  * (plateWidth  / 2)   [mm, +right]
 *   COP_y = ((f0 + f1) - (f2 + f3)) / fz  * (plateHeight / 2)   [mm, +front]
 *
 * Corner layout (top view):
 *   f0 = front-left   f1 = front-right
 *   f2 = back-left    f3 = back-right
 *
 * Session lifecycle is controlled externally via startSession() / stopSession()
 * (called by the server when the dashboard user clicks Start / Stop).
 *
 * Warmup filtering: the first `warmupMs` of each session is discarded from
 * metrics computation to remove transient artifacts when the user steps on.
 */

import { RawForceData, ProcessedFrame, BalanceMetrics, PipelineConfig, DEFAULT_CONFIG, SessionState, Session } from './types.js';
import { LowPassFilter } from './low-pass-filter.js';
import { computeSwayRMS, computePathLength, computeSwayVelocity } from './metrics/sway.js';
import { computeStabilityArea } from './metrics/stability-area.js';
import { computeFrequencyFeatures } from './metrics/frequency.js';
import { computeJerkRMS } from './metrics/jerk.js';
import { computeTimeInZone } from './metrics/time-in-zone.js';
import { computeBalanceScore } from './metrics/balance-score.js';
import { SessionManager } from './session/session-manager.js';

export class Pipeline {
  private config: PipelineConfig;
  private lpfX: LowPassFilter;
  private lpfY: LowPassFilter;
  private sessionManager: SessionManager;

  // Sliding window buffers for metrics
  private copXBuffer: number[] = [];
  private copYBuffer: number[] = [];
  // COP velocity buffers for jerk computation
  private copXVelBuffer: number[] = [];
  private copYVelBuffer: number[] = [];

  private sampleCount = 0;
  private sessionState: SessionState = 'idle';

  // Warmup tracking
  private warmupSamples: number;
  private warmupCounter = 0;

  // Previous COP for velocity computation
  private prevCopX: number | null = null;
  private prevCopY: number | null = null;
  private prevTimestamp: number | null = null;

  private onSessionEnd?: (session: Session) => void;

  constructor(config: Partial<PipelineConfig> = {}, onSessionEnd?: (session: Session) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lpfX = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
    this.lpfY = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
    this.sessionManager = new SessionManager();
    this.onSessionEnd = onSessionEnd;
    this.warmupSamples = Math.round(this.config.warmupMs / (1000 / this.config.sampleRate));
  }

  /**
   * Start a new session. Called by the server when the dashboard user clicks Start.
   */
  startSession(wallClockMs: number = Date.now()): void {
    if (this.sessionState === 'active') return;
    this.sessionState = 'active';
    this.sessionManager.startSession(wallClockMs);
    this.resetBuffers();
  }

  /**
   * Stop the current session. Called by the server when the dashboard user clicks Stop.
   * Returns the completed Session object (or null if no session was active).
   */
  stopSession(): Session | null {
    if (this.sessionState !== 'active') return null;
    this.sessionState = 'ended';
    const session = this.sessionManager.endSession();
    if (session && this.onSessionEnd) {
      this.onSessionEnd(session);
    }
    // Transition to idle after ending
    this.sessionState = 'idle';
    return session ?? null;
  }

  /**
   * Process a single raw force sample.
   *
   * @param data Raw force data from the serial stream
   * @returns Processed frame with COP, forces, metrics, and session state
   */
  processSample(data: RawForceData): ProcessedFrame {
    const { f0, f1, f2, f3 } = data;
    const fz = f0 + f1 + f2 + f3;

    // Compute COP (avoid divide-by-zero when no load on plate)
    let copX = 0;
    let copY = 0;
    if (fz > 0) {
      copX = ((f1 + f3) - (f0 + f2)) / fz * (this.config.plateWidth  / 2);
      copY = ((f0 + f1) - (f2 + f3)) / fz * (this.config.plateHeight / 2);
    }

    // Low-pass filter
    const copXFiltered = this.lpfX.process(copX);
    const copYFiltered = this.lpfY.process(copY);

    // Compute COP velocity for jerk (only when session active)
    if (this.sessionState === 'active' && this.prevCopX !== null && this.prevTimestamp !== null) {
      const dt = (data.t - this.prevTimestamp) / 1000; // seconds
      if (dt > 0) {
        const vx = (copXFiltered - this.prevCopX) / dt;
        const vy = (copYFiltered - this.prevCopY!) / dt;
        this.copXVelBuffer.push(vx);
        this.copYVelBuffer.push(vy);
        if (this.copXVelBuffer.length > this.config.metricsWindowSize) {
          this.copXVelBuffer.shift();
          this.copYVelBuffer.shift();
        }
      }
    }
    this.prevCopX = copXFiltered;
    this.prevCopY = copYFiltered;
    this.prevTimestamp = data.t;

    // Accumulate session data
    if (this.sessionState === 'active') {
      this.sessionManager.addRawSample(data);
      this.warmupCounter++;

      // Only accumulate metric buffers after warmup
      if (this.warmupCounter > this.warmupSamples) {
        this.copXBuffer.push(copXFiltered);
        this.copYBuffer.push(copYFiltered);
        const maxSize = this.config.metricsWindowSize;
        if (this.copXBuffer.length > maxSize) {
          this.copXBuffer.shift();
          this.copYBuffer.shift();
        }
      }
    }

    // Compute metrics at interval (only when session active and past warmup)
    this.sampleCount++;
    let metrics: BalanceMetrics | null = null;
    if (
      this.sessionState === 'active' &&
      this.warmupCounter > this.warmupSamples &&
      this.sampleCount >= this.config.metricsInterval &&
      this.copXBuffer.length >= 20
    ) {
      this.sampleCount = 0;
      metrics = this.computeMetrics();
    }

    const frame: ProcessedFrame = {
      timestamp: data.t,
      copX,
      copY,
      copXFiltered,
      copYFiltered,
      fz,
      f0,
      f1,
      f2,
      f3,
      metrics,
      sessionState: this.sessionState,
    };

    if (this.sessionState === 'active') {
      this.sessionManager.addProcessedFrame(frame);
    }

    return frame;
  }

  /** Compute all metrics from current window buffers */
  private computeMetrics(): BalanceMetrics {
    const copX = this.copXBuffer;
    const copY = this.copYBuffer;
    const windowDuration = copX.length / this.config.sampleRate;

    const swayRMS     = computeSwayRMS(copX, copY);
    const pathLength  = computePathLength(copX, copY);
    const swayVelocity = computeSwayVelocity(pathLength, windowDuration);
    const stabilityArea = computeStabilityArea(copX, copY);

    const combinedSway = copX.map((x, i) => Math.sqrt(x * x + copY[i] * copY[i]));
    const frequencyFeatures = computeFrequencyFeatures(combinedSway, this.config.sampleRate);

    const jerkRMS   = computeJerkRMS(this.copXVelBuffer, this.copYVelBuffer, this.config.sampleRate);
    const timeInZone = computeTimeInZone(copX, copY, this.config.stabilityThreshold);

    const balanceScore = computeBalanceScore(
      { swayRMS, swayVelocity, stabilityArea, jerkRMS, timeInZone },
      this.config.scoreWeights,
    );

    return { swayRMS, pathLength, swayVelocity, stabilityArea, frequencyFeatures, jerkRMS, timeInZone, balanceScore };
  }

  private resetBuffers(): void {
    this.copXBuffer = [];
    this.copYBuffer = [];
    this.copXVelBuffer = [];
    this.copYVelBuffer = [];
    this.sampleCount = 0;
    this.warmupCounter = 0;
    this.prevCopX = null;
    this.prevCopY = null;
    this.prevTimestamp = null;
    this.lpfX.reset();
    this.lpfY.reset();
  }

  getSessionState(): SessionState {
    return this.sessionState;
  }

  getSessionElapsed(): number {
    return this.sessionManager.getElapsedSeconds();
  }

  reset(): void {
    this.resetBuffers();
    this.sessionManager.reset();
    this.sessionState = 'idle';
  }
}
