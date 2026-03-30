/**
 * Sway metrics: RMS magnitude, path length, and velocity.
 *
 * These are the most fundamental posturography measures, analogous to
 * Center of Pressure (COP) displacement and velocity from force plates.
 *
 * References:
 * - Prieto et al. (1996): Measures of postural steadiness
 * - Ruhe et al. (2010): COP excursion reliability
 * - Palmieri et al. (2002): COP velocity analysis
 */

/**
 * Compute RMS sway magnitude from roll and pitch arrays.
 *
 * θ_RMS = √(mean(θx² + θy²))
 *
 * Higher values indicate greater overall instability.
 *
 * @param roll Array of roll angles (degrees)
 * @param pitch Array of pitch angles (degrees)
 * @returns RMS sway magnitude in degrees
 */
export function computeSwayRMS(roll: number[], pitch: number[]): number {
  const n = roll.length;
  if (n === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += roll[i] * roll[i] + pitch[i] * pitch[i];
  }

  return Math.sqrt(sumSq / n);
}

/**
 * Compute sway path length from roll and pitch arrays.
 *
 * L = Σ √(Δθx² + Δθy²)
 *
 * Equivalent to COP path length. One of the most sensitive balance metrics.
 *
 * @param roll Array of roll angles (degrees)
 * @param pitch Array of pitch angles (degrees)
 * @returns Total path length in degrees
 */
export function computePathLength(roll: number[], pitch: number[]): number {
  const n = roll.length;
  if (n < 2) return 0;

  let length = 0;
  for (let i = 1; i < n; i++) {
    const dx = roll[i] - roll[i - 1];
    const dy = pitch[i] - pitch[i - 1];
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return length;
}

/**
 * Compute mean sway velocity.
 *
 * V = L / T
 *
 * Higher velocity indicates more rapid corrections (instability).
 *
 * @param pathLength Total sway path length
 * @param durationSeconds Window duration in seconds
 * @returns Mean velocity in degrees/second
 */
export function computeSwayVelocity(pathLength: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return pathLength / durationSeconds;
}
