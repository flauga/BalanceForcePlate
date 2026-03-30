/**
 * Main processing pipeline: orchestrates the full signal processing chain.
 *
 * Raw IMU data → Madgwick AHRS → Euler angles → Low-pass filter → Metrics
 *
 * Processes one sample at a time (streaming design) and emits ProcessedFrames.
 */

import { RawIMUData, ProcessedFrame, BalanceMetrics, PipelineConfig, DEFAULT_CONFIG, SessionState, Session } from './types.js';
import { MadgwickFilter } from './madgwick.js';
import { quaternionToEuler, degToRad } from './orientation.js';
import { LowPassFilter } from './low-pass-filter.js';
import { computeSwayRMS, computePathLength, computeSwayVelocity } from './metrics/sway.js';
import { computeStabilityArea } from './metrics/stability-area.js';
import { computeFrequencyFeatures } from './metrics/frequency.js';
import { computeJerkRMS } from './metrics/jerk.js';
import { computeTimeInZone } from './metrics/time-in-zone.js';
import { computeBalanceScore } from './metrics/balance-score.js';
import { SessionDetector } from './session/detector.js';
import { SessionManager } from './session/session-manager.js';

export class Pipeline {
  private config: PipelineConfig;
  private madgwick: MadgwickFilter;
  private lpfRoll: LowPassFilter;
  private lpfPitch: LowPassFilter;
  private detector: SessionDetector;
  private sessionManager: SessionManager;

  // Sliding window buffers for metrics
  private rollBuffer: number[] = [];
  private pitchBuffer: number[] = [];
  private gyroXBuffer: number[] = [];
  private gyroYBuffer: number[] = [];

  // Sample counter for metrics interval
  private sampleCount = 0;
  private previousState: SessionState = 'idle';

  // Callback for completed sessions
  private onSessionEnd?: (session: Session) => void;

  constructor(config: Partial<PipelineConfig> = {}, onSessionEnd?: (session: Session) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.madgwick = new MadgwickFilter(this.config.sampleRate, this.config.madgwickBeta);
    this.lpfRoll = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
    this.lpfPitch = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
    this.detector = new SessionDetector();
    this.sessionManager = new SessionManager();
    this.onSessionEnd = onSessionEnd;
  }

  /**
   * Process a single raw IMU sample.
   *
   * @param data Raw IMU data from the serial stream
   * @returns Processed frame with orientation, metrics, and session state
   */
  processSample(data: RawIMUData): ProcessedFrame {
    // Step 1: Session detection
    const sessionState = this.detector.update(data);

    // Handle session transitions
    if (sessionState === 'active' && this.previousState === 'idle') {
      this.sessionManager.startSession(data.t);
      this.resetBuffers();
    } else if (sessionState === 'ended' && this.previousState === 'active') {
      const session = this.sessionManager.endSession();
      if (session && this.onSessionEnd) {
        this.onSessionEnd(session);
      }
    }
    this.previousState = sessionState;

    // Record raw data if session is active
    this.sessionManager.addRawSample(data);

    // Step 2: Madgwick AHRS update
    // Convert gyroscope from deg/s to rad/s
    const gxRad = degToRad(data.gx);
    const gyRad = degToRad(data.gy);
    const gzRad = degToRad(data.gz);
    this.madgwick.update(data.ax, data.ay, data.az, gxRad, gyRad, gzRad);

    // Step 3: Quaternion → Euler
    const q = this.madgwick.getQuaternion();
    const euler = quaternionToEuler(q);

    // Step 4: Low-pass filter
    const rollFiltered = this.lpfRoll.process(euler.roll);
    const pitchFiltered = this.lpfPitch.process(euler.pitch);

    // Step 5: Accumulate in sliding window
    this.rollBuffer.push(rollFiltered);
    this.pitchBuffer.push(pitchFiltered);
    this.gyroXBuffer.push(data.gx);
    this.gyroYBuffer.push(data.gy);

    // Trim to window size
    const maxSize = this.config.metricsWindowSize;
    if (this.rollBuffer.length > maxSize) {
      this.rollBuffer.shift();
      this.pitchBuffer.shift();
      this.gyroXBuffer.shift();
      this.gyroYBuffer.shift();
    }

    // Step 6: Compute metrics at interval
    this.sampleCount++;
    let metrics: BalanceMetrics | null = null;

    if (this.sampleCount >= this.config.metricsInterval && this.rollBuffer.length >= 20) {
      this.sampleCount = 0;
      metrics = this.computeMetrics();
    }

    const frame: ProcessedFrame = {
      timestamp: data.t,
      roll: euler.roll,
      pitch: euler.pitch,
      rollFiltered,
      pitchFiltered,
      gyroX: data.gx,
      gyroY: data.gy,
      gyroZ: data.gz,
      metrics,
      sessionState,
    };

    // Record processed frame if session is active
    this.sessionManager.addProcessedFrame(frame);

    return frame;
  }

  /** Compute all metrics from current window buffers */
  private computeMetrics(): BalanceMetrics {
    const roll = this.rollBuffer;
    const pitch = this.pitchBuffer;
    const windowDuration = roll.length / this.config.sampleRate;

    const swayRMS = computeSwayRMS(roll, pitch);
    const pathLength = computePathLength(roll, pitch);
    const swayVelocity = computeSwayVelocity(pathLength, windowDuration);
    const stabilityArea = computeStabilityArea(roll, pitch);

    // Combine roll and pitch for frequency analysis
    const combinedSway = roll.map((r, i) => Math.sqrt(r * r + pitch[i] * pitch[i]));
    const frequencyFeatures = computeFrequencyFeatures(combinedSway, this.config.sampleRate);

    const jerkRMS = computeJerkRMS(this.gyroXBuffer, this.gyroYBuffer, this.config.sampleRate);
    const timeInZone = computeTimeInZone(roll, pitch, this.config.stabilityThreshold);

    const balanceScore = computeBalanceScore(
      { swayRMS, swayVelocity, stabilityArea, jerkRMS, timeInZone },
      this.config.scoreWeights,
    );

    return {
      swayRMS,
      pathLength,
      swayVelocity,
      stabilityArea,
      frequencyFeatures,
      jerkRMS,
      timeInZone,
      balanceScore,
    };
  }

  /** Reset all internal buffers (e.g., on new session start) */
  private resetBuffers(): void {
    this.rollBuffer = [];
    this.pitchBuffer = [];
    this.gyroXBuffer = [];
    this.gyroYBuffer = [];
    this.sampleCount = 0;
    this.madgwick.reset();
    this.lpfRoll.reset();
    this.lpfPitch.reset();
  }

  /** Get current session elapsed time in seconds */
  getSessionElapsed(): number {
    return this.sessionManager.getElapsedSeconds();
  }

  /** Get current session state */
  getSessionState(): SessionState {
    return this.detector.getState();
  }

  /** Full reset of pipeline */
  reset(): void {
    this.resetBuffers();
    this.detector.reset();
    this.sessionManager.reset();
    this.previousState = 'idle';
  }
}
