/**
 * Main processing pipeline: orchestrates the full signal processing chain.
 *
 * Raw force data → COP calculation → Metrics
 *
 * COP (Center of Pressure) is derived from 4 corner load cell readings:
 *   COP_x = ((f1 + f3) - (f0 + f2)) / fz  * (plateWidth  / 2)   [mm, +right]
 *   COP_y = ((f0 + f1) - (f2 + f3)) / fz  * (plateHeight / 2)   [mm, +front]
 *
 * Corner layout (top view):
 *   f0 = front-left   f1 = front-right
 *   f2 = back-left    f3 = back-right
 *
 * COP is frozen at last valid position when total force < MIN_FORCE_G (100g)
 * to prevent noise when nobody is standing on the plate.
 */

import { RawForceData, ProcessedFrame, BalanceMetrics, PipelineConfig, DEFAULT_CONFIG, SessionState, Session } from './types.js';
import {
  computeSwayRMS, computePathLength, computeSwayVelocity,
  computeCentroidMetrics,
  computeEllipseParams,
  computeBalanceScore,
} from './metrics.js';
import { LowPassFilter } from './low-pass-filter.js';

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

const MIN_FORCE_G = 100;

export class Pipeline {
  private config: PipelineConfig;
  private sessionManager: SessionManager;

  private copXBuffer: number[] = [];
  private copYBuffer: number[] = [];

  private sampleCount = 0;
  private sessionState: SessionState = 'idle';
  private warmupSamples: number;
  private warmupCounter = 0;
  private prevCopX: number | null = null;
  private prevCopY: number | null = null;
  private prevTimestamp: number | null = null;
  private lastValidCopX = 0;
  private lastValidCopY = 0;
  private copXFilter: LowPassFilter;
  private copYFilter: LowPassFilter;

  private onSessionEnd?: (session: Session) => void;

  constructor(config: Partial<PipelineConfig> = {}, onSessionEnd?: (session: Session) => void) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.sessionManager = new SessionManager();
    this.onSessionEnd = onSessionEnd;
    this.warmupSamples = Math.round(this.config.warmupMs / (1000 / this.config.sampleRate));
    this.copXFilter = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
    this.copYFilter = new LowPassFilter(this.config.lpfCutoff, this.config.sampleRate);
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

    let copX: number;
    let copY: number;
    if (fz >= MIN_FORCE_G) {
      copX = ((f1 + f3) - (f0 + f2)) / fz * (this.config.plateWidth  / 2);
      copY = ((f0 + f1) - (f2 + f3)) / fz * (this.config.plateHeight / 2);
      this.lastValidCopX = copX;
      this.lastValidCopY = copY;
    } else {
      copX = this.lastValidCopX;
      copY = this.lastValidCopY;
    }
    const copXFiltered = this.copXFilter.process(copX);
    const copYFiltered = this.copYFilter.process(copY);

    this.prevCopX = copXFiltered;
    this.prevCopY = copYFiltered;
    this.prevTimestamp = data.t;

    // Always accumulate COP buffer so metrics compute live (not just in sessions).
    // During an active session the buffer is unbounded (session-total metrics).
    // When idle/ended, cap to metricsWindowSize for a rolling live preview.
    this.warmupCounter++;
    if (this.warmupCounter > this.warmupSamples) {
      this.copXBuffer.push(copXFiltered);
      this.copYBuffer.push(copYFiltered);
      if (this.sessionState !== 'active') {
        const maxSize = this.config.metricsWindowSize;
        if (this.copXBuffer.length > maxSize) {
          this.copXBuffer.shift();
          this.copYBuffer.shift();
        }
      }
    }

    if (this.sessionState === 'active') {
      this.sessionManager.addRawSample(data);
    }

    this.sampleCount++;
    let metrics: BalanceMetrics | null = null;
    if (
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

    const swayRMS      = computeSwayRMS(copX, copY);
    const pathLength   = computePathLength(copX, copY);
    const swayVelocity = computeSwayVelocity(pathLength, windowDuration);
    const { maxdist, rangeAP, rangeML } = computeCentroidMetrics(copX, copY);

    const ellipse = computeEllipseParams(copX, copY);
    const CHI2_95_DF2 = 5.991;
    const stabilityArea = Math.PI * CHI2_95_DF2 * Math.sqrt(Math.max(0, ellipse.lambda1 * ellipse.lambda2));
    const ellipseParams = {
      centerX: ellipse.centerX, centerY: ellipse.centerY,
      semiAxisA: ellipse.semiAxisA, semiAxisB: ellipse.semiAxisB,
      angle: ellipse.angle,
    };

    const balanceScore = computeBalanceScore({ swayRMS, swayVelocity, stabilityArea });

    return {
      swayRMS, pathLength, swayVelocity,
      rangeAP, rangeML, maxdist,
      stabilityArea, ellipseParams, balanceScore,
    };
  }

  private resetBuffers(): void {
    this.copXBuffer = [];
    this.copYBuffer = [];
    this.sampleCount = 0;
    this.warmupCounter = 0;
    this.prevCopX = null;
    this.prevCopY = null;
    this.prevTimestamp = null;
    this.lastValidCopX = 0;
    this.lastValidCopY = 0;
    this.copXFilter.reset();
    this.copYFilter.reset();
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
