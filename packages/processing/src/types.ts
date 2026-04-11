/** Raw force data frame from the ESP32 serial stream (4 HX711 load cells) */
export interface RawForceData {
  /** Timestamp in milliseconds (from ESP32 millis()) */
  t: number;
  /** Front-left load cell (raw ADC counts) */
  f0: number;
  /** Front-right load cell (raw ADC counts) */
  f1: number;
  /** Back-left load cell (raw ADC counts) */
  f2: number;
  /** Back-right load cell (raw ADC counts) */
  f3: number;
  /** Optional packet sequence number (for drop detection) */
  seq?: number;
}

/** 95% confidence ellipse parameters for COP visualization */
export interface EllipseParams {
  /** Ellipse center X (mm) */
  centerX: number;
  /** Ellipse center Y (mm) */
  centerY: number;
  /** Semi-axis A length (mm) */
  semiAxisA: number;
  /** Semi-axis B length (mm) */
  semiAxisB: number;
  /** Rotation angle (degrees) */
  angle: number;
}

/** Balance metrics computed over a sliding window */
export interface BalanceMetrics {
  /** RMS of COP distance from center (mm) */
  swayRMS: number;
  /** Total COP path length (mm) */
  pathLength: number;
  /** Mean COP velocity (mm/s) */
  swayVelocity: number;
  /** COP range in AP axis: max(copY) − min(copY) (mm) */
  rangeAP: number;
  /** COP range in ML axis: max(copX) − min(copX) (mm) */
  rangeML: number;
  /** Maximum distance of COP from centroid (mm) */
  maxdist: number;
  /** 95% confidence ellipse area (mm²) */
  stabilityArea: number;
  /** 95% confidence ellipse parameters for visualization */
  ellipseParams?: EllipseParams;
  /** Composite balance score (0-100) */
  balanceScore: number;
}

/** Processed frame output from the pipeline */
export interface ProcessedFrame {
  /** Timestamp in ms */
  timestamp: number;
  /** Packet sequence number from firmware (undefined if firmware doesn't send it) */
  seq?: number;
  /** Raw COP X position (mm from center, positive = right) */
  copX: number;
  /** Raw COP Y position (mm from center, positive = front) */
  copY: number;
  /** Low-pass filtered COP X (mm) */
  copXFiltered: number;
  /** Low-pass filtered COP Y (mm) */
  copYFiltered: number;
  /** Total vertical force (sum of 4 cells, raw counts) */
  fz: number;
  /** Raw corner forces */
  f0: number;
  f1: number;
  f2: number;
  f3: number;
  /** Metrics (null if not computed this frame) */
  metrics: BalanceMetrics | null;
  /** Current session state */
  sessionState: SessionState;
}

export type SessionState = 'idle' | 'active' | 'ended';

/** A complete balance session */
export interface Session {
  /** Unique session ID */
  id: string;
  /** Session start timestamp (ms since epoch) */
  startTime: number;
  /** Session end timestamp (ms since epoch) */
  endTime: number;
  /** Duration in seconds */
  duration: number;
  /** Final aggregated metrics */
  finalMetrics: BalanceMetrics;
  /** Raw data (optional, for replay) */
  rawData?: RawForceData[];
  /** Processed time series (optional, for visualization) */
  timeSeries?: ProcessedFrame[];
}

/** Configuration for the processing pipeline */
export interface PipelineConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Low-pass filter cutoff frequency in Hz */
  lpfCutoff: number;
  /** Metrics computation interval (every N samples) */
  metricsInterval: number;
  /** Sliding window size for metrics (in samples) */
  metricsWindowSize: number;
  /** Force plate width in mm (distance between left and right cells) */
  plateWidth: number;
  /** Force plate height in mm (distance between front and back cells) */
  plateHeight: number;
  /** Warmup duration in ms — data at start of session is buffered but metrics
   *  are suppressed until warmup completes (removes step-on artifact) */
  warmupMs: number;
}

/** Default pipeline configuration */
export const DEFAULT_CONFIG: PipelineConfig = {
  sampleRate: 80,
  lpfCutoff: 10.0,
  metricsInterval: 8,         // every 8 samples = 10 Hz at 80 Hz sample rate
  metricsWindowSize: 800,     // 10 seconds at 80 Hz
  plateWidth: 339.411,        // mm — RSL301 corner spacing
  plateHeight: 339.411,       // mm — RSL301 corner spacing
  warmupMs: 500,              // 0.5 second warmup to discard step-on artifact
};
