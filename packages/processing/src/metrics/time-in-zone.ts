/**
 * Time-in-stability-zone metric.
 *
 * Measures the percentage of time the user maintains their COP position
 * within a defined stability zone radius. This is a directly interpretable
 * metric — higher values mean better balance maintenance.
 *
 * Criterion: |COP| < threshold
 * where |COP| = √(copX² + copY²) is the COP distance from center.
 *
 * Reference:
 * - Riemann et al. (1999): BESS test development
 */

/**
 * Compute the fraction of time spent within the stability zone.
 *
 * @param copX Array of COP X positions (mm)
 * @param copY Array of COP Y positions (mm)
 * @param threshold Stability zone radius in mm (default: 10mm)
 * @returns Fraction of time in zone (0 to 1)
 */
export function computeTimeInZone(
  copX: number[],
  copY: number[],
  threshold: number = 10.0,
): number {
  const n = copX.length;
  if (n === 0) return 0;

  let inZoneCount = 0;

  for (let i = 0; i < n; i++) {
    const magnitude = Math.sqrt(copX[i] * copX[i] + copY[i] * copY[i]);
    if (magnitude < threshold) {
      inZoneCount++;
    }
  }

  return inZoneCount / n;
}
