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
}

/** Balance metrics computed over a sliding window */
export interface BalanceMetrics {
  /** RMS of COP distance from center (mm) */
  swayRMS: number;
  /** Total COP path length (mm) */
  pathLength: number;
  /** Mean COP velocity (mm/s) */
  swayVelocity: number;
  /** 95% confidence ellipse area (mm²) */
  stabilityArea: number;
  /** FFT-based frequency features */
  frequencyFeatures: FrequencyFeatures;
  /** RMS jerk of COP velocity (mm/s³) */
  jerkRMS: number;
  /** Fraction of time COP is within stability zone (0-1) */
  timeInZone: number;
  /** Composite balance score (0-100) */
  balanceScore: number;
}

/** Frequency domain analysis results */
export interface FrequencyFeatures {
  /** Dominant frequency in Hz */
  dominantFrequency: number;
  /** Mean frequency in Hz */
  meanFrequency: number;
  /** Power in low band <0.5 Hz (natural sway) */
  lowBandPower: number;
  /** Power in mid band 0.5-1.5 Hz (corrective responses) */
  midBandPower: number;
  /** Power in high band >1.5 Hz (tremor/noise) */
  highBandPower: number;
}

/** Processed frame output from the pipeline */
export interface ProcessedFrame {
  /** Timestamp in ms */
  timestamp: number;
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
  /** Stability zone threshold in mm (COP radius) */
  stabilityThreshold: number;
  /** Metrics computation interval (every N samples) */
  metricsInterval: number;
  /** Sliding window size for metrics (in samples) */
  metricsWindowSize: number;
  /** Balance score weights */
  scoreWeights: ScoreWeights;
  /** Force plate width in mm (distance between left and right cells) */
  plateWidth: number;
  /** Force plate height in mm (distance between front and back cells) */
  plateHeight: number;
  /** Warmup duration in ms — data at start of session is buffered but metrics
   *  are suppressed until warmup completes (removes step-on artifact) */
  warmupMs: number;
}

/** Weights for composite balance score */
export interface ScoreWeights {
  swayRMS: number;
  swayVelocity: number;
  stabilityArea: number;
  timeInZone: number;
  jerkRMS: number;
}

/** Default pipeline configuration */
export const DEFAULT_CONFIG: PipelineConfig = {
  sampleRate: 40,
  lpfCutoff: 5.0,
  stabilityThreshold: 10.0,  // mm from center
  metricsInterval: 4,         // every 4 samples = 10 Hz at 40 Hz sample rate
  metricsWindowSize: 400,     // 10 seconds at 40 Hz
  plateWidth: 500,            // mm
  plateHeight: 500,           // mm
  warmupMs: 2000,             // 2 second warmup to discard step-on artifact
  scoreWeights: {
    swayRMS: 0.25,
    swayVelocity: 0.20,
    stabilityArea: 0.20,
    timeInZone: 0.25,
    jerkRMS: 0.10,
  },
};
