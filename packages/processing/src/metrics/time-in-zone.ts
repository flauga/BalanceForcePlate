/**
 * Time-in-stability-zone metric.
 *
 * Measures the percentage of time the user maintains their sway angle
 * within a defined stability threshold. This is a directly interpretable
 * metric — higher values mean better balance maintenance.
 *
 * Criterion: |θ| < θ_threshold
 * where |θ| = √(θx² + θy²) is the combined sway magnitude.
 *
 * Reference:
 * - Riemann et al. (1999): BESS test development
 */

/**
 * Compute the fraction of time spent within the stability zone.
 *
 * @param roll Array of roll angles (degrees)
 * @param pitch Array of pitch angles (degrees)
 * @param threshold Stability threshold in degrees (default: 3.0)
 * @returns Fraction of time in zone (0 to 1)
 */
export function computeTimeInZone(
  roll: number[],
  pitch: number[],
  threshold: number = 3.0,
): number {
  const n = roll.length;
  if (n === 0) return 0;

  let inZoneCount = 0;

  for (let i = 0; i < n; i++) {
    const magnitude = Math.sqrt(roll[i] * roll[i] + pitch[i] * pitch[i]);
    if (magnitude < threshold) {
      inZoneCount++;
    }
  }

  return inZoneCount / n;
}
