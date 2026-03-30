/**
 * Composite balance score: a single 0-100 score summarizing balance quality.
 *
 * The score is computed as a weighted combination of individual metrics,
 * each normalized to a 0-1 range using sigmoid-based normalization.
 *
 * Score = Σ(wi × normalized_metric_i) × 100
 *
 * Lower COP RMS, velocity, stability area, and jerk contribute positively.
 * Higher time-in-zone contributes positively.
 *
 * Normalization centers are tuned for typical standing balance on a force plate:
 *   - COP RMS ~5-15 mm for normal adults
 *   - COP velocity ~10-30 mm/s
 *   - Stability area ~200-800 mm²
 */

import { BalanceMetrics, ScoreWeights } from '../types.js';

/** Normalization parameters tuned for force plate COP data */
const NORM_PARAMS = {
  /** COP RMS: 0 mm = perfect, ~20 mm = poor */
  swayRMS: { center: 10.0, scale: 6.0 },
  /** COP velocity: 0 mm/s = perfect, ~40 mm/s = poor */
  swayVelocity: { center: 20.0, scale: 12.0 },
  /** Stability area: 0 mm² = perfect, ~1000 mm² = poor */
  stabilityArea: { center: 500.0, scale: 300.0 },
  /** Jerk RMS: 0 = perfect, ~2000 mm/s³ = poor */
  jerkRMS: { center: 1000, scale: 600 },
};

/**
 * Sigmoid normalization: maps a value to [0, 1] where lower input = higher output.
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
  const normSwayRMS  = sigmoidNormInverse(metrics.swayRMS,       NORM_PARAMS.swayRMS.center,      NORM_PARAMS.swayRMS.scale);
  const normVelocity = sigmoidNormInverse(metrics.swayVelocity,  NORM_PARAMS.swayVelocity.center, NORM_PARAMS.swayVelocity.scale);
  const normArea     = sigmoidNormInverse(metrics.stabilityArea, NORM_PARAMS.stabilityArea.center, NORM_PARAMS.stabilityArea.scale);
  const normJerk     = sigmoidNormInverse(metrics.jerkRMS,       NORM_PARAMS.jerkRMS.center,      NORM_PARAMS.jerkRMS.scale);

  // Time-in-zone is already 0-1, higher = better
  const normTimeInZone = metrics.timeInZone;

  const totalWeight = weights.swayRMS + weights.swayVelocity + weights.stabilityArea + weights.timeInZone + weights.jerkRMS;

  const rawScore =
    (weights.swayRMS      * normSwayRMS  +
     weights.swayVelocity * normVelocity +
     weights.stabilityArea * normArea    +
     weights.timeInZone   * normTimeInZone +
     weights.jerkRMS      * normJerk) / totalWeight;

  return Math.max(0, Math.min(100, rawScore * 100));
}
