/** Raw IMU data frame from the ESP32 serial stream */
export interface RawIMUData {
  /** Timestamp in milliseconds (from ESP32 millis()) */
  t: number;
  /** Accelerometer X (g) */
  ax: number;
  /** Accelerometer Y (g) */
  ay: number;
  /** Accelerometer Z (g) */
  az: number;
  /** Gyroscope X (deg/s) */
  gx: number;
  /** Gyroscope Y (deg/s) */
  gy: number;
  /** Gyroscope Z (deg/s) */
  gz: number;
}

/** Quaternion representation [w, x, y, z] */
export interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** Euler angles derived from sensor fusion */
export interface Orientation {
  /** Roll angle in degrees (rotation about X axis) */
  roll: number;
  /** Pitch angle in degrees (rotation about Y axis) */
  pitch: number;
}

/** Balance metrics computed over a sliding window */
export interface BalanceMetrics {
  /** RMS of combined sway angle (degrees) */
  swayRMS: number;
  /** Total sway path length (degrees) */
  pathLength: number;
  /** Mean sway velocity (degrees/s) */
  swayVelocity: number;
  /** 95% confidence ellipse area (degrees²) */
  stabilityArea: number;
  /** FFT-based frequency features */
  frequencyFeatures: FrequencyFeatures;
  /** RMS jerk of angular velocity (deg/s³) */
  jerkRMS: number;
  /** Fraction of time within stability threshold (0-1) */
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
  /** Power in mid band 0.5-1.5 Hz (corrective) */
  midBandPower: number;
  /** Power in high band >1.5 Hz (tremor/noise) */
  highBandPower: number;
}

/** Processed frame output from the pipeline */
export interface ProcessedFrame {
  /** Timestamp in ms */
  timestamp: number;
  /** Raw orientation (before filtering) */
  roll: number;
  pitch: number;
  /** Filtered orientation */
  rollFiltered: number;
  pitchFiltered: number;
  /** Angular velocities (deg/s) */
  gyroX: number;
  gyroY: number;
  gyroZ: number;
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
  rawData?: RawIMUData[];
  /** Processed time series (optional, for visualization) */
  timeSeries?: ProcessedFrame[];
}

/** Configuration for the processing pipeline */
export interface PipelineConfig {
  /** Sample rate in Hz */
  sampleRate: number;
  /** Madgwick filter beta parameter */
  madgwickBeta: number;
  /** Low-pass filter cutoff frequency in Hz */
  lpfCutoff: number;
  /** Stability zone threshold in degrees */
  stabilityThreshold: number;
  /** Metrics computation interval (every N samples) */
  metricsInterval: number;
  /** Sliding window size for metrics (in samples) */
  metricsWindowSize: number;
  /** Balance score weights */
  scoreWeights: ScoreWeights;
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
  sampleRate: 100,
  madgwickBeta: 0.1,
  lpfCutoff: 5.0,
  stabilityThreshold: 3.0,  // degrees
  metricsInterval: 10,       // every 10 samples = 10Hz
  metricsWindowSize: 1000,   // 10 seconds at 100Hz
  scoreWeights: {
    swayRMS: 0.25,
    swayVelocity: 0.20,
    stabilityArea: 0.20,
    timeInZone: 0.25,
    jerkRMS: 0.10,
  },
};
