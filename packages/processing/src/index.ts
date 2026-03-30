// Main entry point for @imu-balance/processing

// Pipeline
export { Pipeline } from './pipeline.js';

// Core filters
export { MadgwickFilter } from './madgwick.js';
export { LowPassFilter } from './low-pass-filter.js';

// Orientation
export { quaternionToEuler, degToRad, radToDeg } from './orientation.js';

// Serial parsing
export { parseSerialLine, isStatusMessage } from './serial-parser.js';

// Metrics
export { computeSwayRMS, computePathLength, computeSwayVelocity } from './metrics/sway.js';
export { computeStabilityArea, computeEllipseParams } from './metrics/stability-area.js';
export { computeFrequencyFeatures } from './metrics/frequency.js';
export { computeJerkRMS } from './metrics/jerk.js';
export { computeTimeInZone } from './metrics/time-in-zone.js';
export { computeBalanceScore } from './metrics/balance-score.js';

// Session
export { SessionDetector } from './session/detector.js';
export { SessionManager } from './session/session-manager.js';

// CSV export
export { sessionToRawCSV, sessionToProcessedCSV } from './csv-export.js';

// Types
export type {
  RawIMUData,
  Quaternion,
  Orientation,
  BalanceMetrics,
  FrequencyFeatures,
  ProcessedFrame,
  SessionState,
  Session,
  PipelineConfig,
  ScoreWeights,
} from './types.js';

export { DEFAULT_CONFIG } from './types.js';
