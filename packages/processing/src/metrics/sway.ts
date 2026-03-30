/**
 * Sway metrics: RMS magnitude, path length, and velocity.
 *
 * These are the standard posturography measures for Center of Pressure (COP)
 * displacement and velocity from force plate data.
 *
 * References:
 * - Prieto et al. (1996): Measures of postural steadiness
 * - Ruhe et al. (2010): COP excursion reliability
 * - Palmieri et al. (2002): COP velocity analysis
 */

/**
 * Compute RMS COP displacement from center.
 *
 * COP_RMS = √(mean(copX² + copY²))
 *
 * Higher values indicate greater overall instability.
 *
 * @param copX Array of COP X positions (mm)
 * @param copY Array of COP Y positions (mm)
 * @returns RMS COP displacement in mm
 */
export function computeSwayRMS(copX: number[], copY: number[]): number {
  const n = copX.length;
  if (n === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sumSq += copX[i] * copX[i] + copY[i] * copY[i];
  }

  return Math.sqrt(sumSq / n);
}

/**
 * Compute COP path length.
 *
 * L = Σ √(ΔcX² + ΔcY²)
 *
 * One of the most sensitive balance metrics.
 *
 * @param copX Array of COP X positions (mm)
 * @param copY Array of COP Y positions (mm)
 * @returns Total path length in mm
 */
export function computePathLength(copX: number[], copY: number[]): number {
  const n = copX.length;
  if (n < 2) return 0;

  let length = 0;
  for (let i = 1; i < n; i++) {
    const dx = copX[i] - copX[i - 1];
    const dy = copY[i] - copY[i - 1];
    length += Math.sqrt(dx * dx + dy * dy);
  }

  return length;
}

/**
 * Compute mean COP velocity.
 *
 * V = L / T
 *
 * Higher velocity indicates more rapid corrections (instability).
 *
 * @param pathLength Total COP path length (mm)
 * @param durationSeconds Window duration in seconds
 * @returns Mean velocity in mm/s
 */
export function computeSwayVelocity(pathLength: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return pathLength / durationSeconds;
}
