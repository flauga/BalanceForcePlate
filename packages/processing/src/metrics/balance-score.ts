/**
 * Composite balance score: a single 0-100 score summarizing balance quality.
 *
 * The score is computed as a weighted combination of individual metrics,
 * each normalized to a 0-1 range using sigmoid-based normalization.
 *
 * Score = Σ(wi × normalized_metric_i) × 100
 *
 * Lower sway RMS, velocity, stability area, and jerk contribute positively.
 * Higher time-in-zone contributes positively.
 */

import { BalanceMetrics, ScoreWeights } from '../types.js';

/** Default normalization parameters (tuned from typical balance board data) */
const NORM_PARAMS = {
  /** RMS sway: 0° = perfect, ~5° = poor */
  swayRMS: { center: 2.5, scale: 1.5 },
  /** Sway velocity: 0°/s = perfect, ~10°/s = poor */
  swayVelocity: { center: 5.0, scale: 3.0 },
  /** Stability area: 0 = perfect, ~50 deg² = poor */
  stabilityArea: { center: 25.0, scale: 15.0 },
  /** Jerk RMS: 0 = perfect, ~500 = poor */
  jerkRMS: { center: 250, scale: 150 },
};

/**
 * Sigmoid normalization: maps a value to [0, 1] where lower input = higher output.
 * Uses a logistic function: 1 / (1 + exp((x - center) / scale))
 */
function sigmoidNormInverse(value: number, center: number, scale: number): number {
  return 1.0 / (1.0 + Math.exp((value - center) / scale));
}

/**
 * Compute the composite balance score from individual metrics.
 *
 * @param metrics Individual balance metrics
 * @param weights Weights for each metric component
 * @returns Score from 0 (worst) to 100 (best)
 */
export function computeBalanceScore(
  metrics: Pick<BalanceMetrics, 'swayRMS' | 'swayVelocity' | 'stabilityArea' | 'jerkRMS' | 'timeInZone'>,
  weights: ScoreWeights,
): number {
  // Normalize each metric to 0-1 (higher = better)
  const normSwayRMS = sigmoidNormInverse(metrics.swayRMS, NORM_PARAMS.swayRMS.center, NORM_PARAMS.swayRMS.scale);
  const normVelocity = sigmoidNormInverse(metrics.swayVelocity, NORM_PARAMS.swayVelocity.center, NORM_PARAMS.swayVelocity.scale);
  const normArea = sigmoidNormInverse(metrics.stabilityArea, NORM_PARAMS.stabilityArea.center, NORM_PARAMS.stabilityArea.scale);
  const normJerk = sigmoidNormInverse(metrics.jerkRMS, NORM_PARAMS.jerkRMS.center, NORM_PARAMS.jerkRMS.scale);

  // Time-in-zone is already 0-1, higher = better
  const normTimeInZone = metrics.timeInZone;

  // Weighted combination
  const totalWeight = weights.swayRMS + weights.swayVelocity + weights.stabilityArea + weights.timeInZone + weights.jerkRMS;

  const rawScore =
    (weights.swayRMS * normSwayRMS +
     weights.swayVelocity * normVelocity +
     weights.stabilityArea * normArea +
     weights.timeInZone * normTimeInZone +
     weights.jerkRMS * normJerk) / totalWeight;

  // Scale to 0-100 and clamp
  return Math.max(0, Math.min(100, rawScore * 100));
}
