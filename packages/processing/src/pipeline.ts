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
 */

import { RawForceData, ProcessedFrame, BalanceMetrics, PipelineConfig, DEFAULT_CONFIG, SessionState, Session } from './types.js';
import { LowPassFilter } from './low-pass-filter.js';
import {
  computeSwayRMS, computePathLength, computeSwayVelocity,
  computeSwayRMS_AP, computeSwayRMS_ML,
  computeSwayVelocity_AP, computeSwayVelocity_ML,
  computeCentroidMetrics,
  computeEllipseParams,
  computeFrequencyFeatures,
  computeJerkRMS,
  computeTimeInZone,
  computeBalanceScore,
} from './metrics.js';

// ---------------------------------------------------------------------------
// Session manager (inlined from session/session-manager.ts)
// ---------------------------------------------------------------------------

class SessionManager {
  private currentSessionId: string | null = null;
  private sessionStartTime: number = 0;
  private sessionStartEpoch: number = 0;
  private rawBuffer: RawForceData[] = [];
  private frameBuffer: ProcessedFrame[] = [];
  private lastMetrics: BalanceMetrics | null = null;

  isActive(): boolean { return this.currentSessionId !== null; }
  getSessionId(): string | null { return this.currentSessionId; }

  getElapsedSeconds(): number {
    if (!this.isActive() || this.rawBuffer.length === 0) return 0;
    return (this.rawBuffer[this.rawBuffer.length - 1].t - this.sessionStartTime) / 1000;
  }

  startSession(timestamp: number): void {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    this.currentSessionId = `${ts}-${rand}`;
    this.sessionStartTime = timestamp;
    this.sessionStartEpoch = Date.now();
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;
  }

  addRawSample(data: RawForceData): void {
    if (this.isActive()) this.rawBuffer.push(data);
  }

  addProcessedFrame(frame: ProcessedFrame): void {
    if (this.isActive()) {
      this.frameBuffer.push(frame);
      if (frame.metrics) this.lastMetrics = frame.metrics;
    }
  }

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
    this.currentSessionId = null;
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;
    return session;
  }

  reset(): void {
    this.currentSessionId = null;
    this.sessionStartTime = 0;
    this.sessionStartEpoch = 0;
    this.rawBuffer = [];
    this.frameBuffer = [];
    this.lastMetrics = null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class Pipeline {
  private config: PipelineConfig;
  private lpfX: LowPassFilter;
  private lpfY: LowPassFilter;
  private sessionManager: SessionManager;

  private copXBuffer: number[] = [];
  private copYBuffer: number[] = [];
  private copXVelBuffer: number[] = [];
  private copYVelBuffer: number[] = [];

  private sampleCount = 0;
  private sessionState: SessionState = 'idle';
  private warmupSamples: number;
  private warmupCounter = 0;
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

  startSession(wallClockMs: number = Date.now()): void {
    if (this.sessionState === 'active') return;
    this.sessionState = 'active';
    this.sessionManager.startSession(wallClockMs);
    this.resetBuffers();
  }

  stopSession(): Session | null {
    if (this.sessionState !== 'active') return null;
    this.sessionState = 'ended';
    const session = this.sessionManager.endSession();
    if (session && this.onSessionEnd) this.onSessionEnd(session);
    this.sessionState = 'idle';
    return session ?? null;
  }

  processSample(data: RawForceData): ProcessedFrame {
    const { f0, f1, f2, f3 } = data;
    const fz = f0 + f1 + f2 + f3;

    let copX = 0, copY = 0;
    if (fz > 0) {
      copX = ((f1 + f3) - (f0 + f2)) / fz * (this.config.plateWidth  / 2);
      copY = ((f0 + f1) - (f2 + f3)) / fz * (this.config.plateHeight / 2);
    }

    const copXFiltered = this.lpfX.process(copX);
    const copYFiltered = this.lpfY.process(copY);

    if (this.sessionState === 'active' && this.prevCopX !== null && this.prevTimestamp !== null) {
      const dt = (data.t - this.prevTimestamp) / 1000;
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

    if (this.sessionState === 'active') {
      this.sessionManager.addRawSample(data);
      this.warmupCounter++;
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
      seq: data.seq,
      copX, copY, copXFiltered, copYFiltered,
      fz, f0, f1, f2, f3,
      metrics,
      sessionState: this.sessionState,
    };

    if (this.sessionState === 'active') this.sessionManager.addProcessedFrame(frame);

    return frame;
  }

  private computeMetrics(): BalanceMetrics {
    const copX = this.copXBuffer;
    const copY = this.copYBuffer;
    const windowDuration = copX.length / this.config.sampleRate;

    const swayRMS         = computeSwayRMS(copX, copY);
    const pathLength      = computePathLength(copX, copY);
    const swayVelocity    = computeSwayVelocity(pathLength, windowDuration);
    const swayRMS_AP      = computeSwayRMS_AP(copY);
    const swayRMS_ML      = computeSwayRMS_ML(copX);
    const swayVelocity_AP = computeSwayVelocity_AP(copY, this.config.sampleRate);
    const swayVelocity_ML = computeSwayVelocity_ML(copX, this.config.sampleRate);
    const { meanCopX, meanCopY, mdist, maxdist, rangeAP, rangeML } = computeCentroidMetrics(copX, copY);

    const ellipse = computeEllipseParams(copX, copY);
    const CHI2_95_DF2 = 5.991;
    const stabilityArea = Math.PI * CHI2_95_DF2 * Math.sqrt(Math.max(0, ellipse.lambda1 * ellipse.lambda2));
    const ellipseParams = {
      centerX: ellipse.centerX, centerY: ellipse.centerY,
      semiAxisA: ellipse.semiAxisA, semiAxisB: ellipse.semiAxisB,
      angle: ellipse.angle,
    };

    const combinedSway = copX.map((x, i) => Math.sqrt(x * x + copY[i] * copY[i]));
    const frequencyFeatures = computeFrequencyFeatures(combinedSway, this.config.sampleRate);
    const jerkRMS    = computeJerkRMS(this.copXVelBuffer, this.copYVelBuffer, this.config.sampleRate);
    const timeInZone = computeTimeInZone(copX, copY, this.config.stabilityThreshold);
    const balanceScore = computeBalanceScore(
      { swayRMS, swayVelocity, stabilityArea, jerkRMS, timeInZone },
      this.config.scoreWeights,
    );

    return {
      swayRMS, pathLength, swayVelocity,
      swayRMS_AP, swayRMS_ML,
      swayVelocity_AP, swayVelocity_ML,
      meanCopX, meanCopY,
      rangeAP, rangeML,
      mdist, maxdist,
      stabilityArea, ellipseParams, frequencyFeatures, jerkRMS, timeInZone, balanceScore,
    };
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

  setPlateGeometry({ plateWidthMm, plateHeightMm }: { plateWidthMm: number; plateHeightMm: number }): void {
    this.config.plateWidth  = plateWidthMm;
    this.config.plateHeight = plateHeightMm;
  }

  getSessionState(): SessionState { return this.sessionState; }
  getSessionElapsed(): number { return this.sessionManager.getElapsedSeconds(); }

  reset(): void {
    this.resetBuffers();
    this.sessionManager.reset();
    this.sessionState = 'idle';
  }
}
