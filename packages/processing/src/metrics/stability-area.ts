/**
 * Stability area: 95% confidence ellipse of sway distribution.
 *
 * The confidence ellipse represents the spatial spread of postural sway.
 * It is computed from the eigenvalues of the 2x2 covariance matrix of
 * the (roll, pitch) sway signal.
 *
 * Area = π × √(λ1 × λ2) × χ²(0.95, df=2)
 * where χ²(0.95, 2) = 5.991
 *
 * Reference:
 * - Duarte & Freitas (2010): Revision of posturography based on force plate
 */

/** Chi-squared critical value for 95% confidence, 2 degrees of freedom */
const CHI2_95_DF2 = 5.991;

/**
 * Compute the ellipse parameters for visualization and area calculation.
 *
 * All downstream computations (area, visualization) share this single
 * pass through the covariance matrix.
 *
 * @param roll Array of roll angles (degrees)
 * @param pitch Array of pitch angles (degrees)
 * @returns Ellipse center, semi-axes, rotation angle, and eigenvalues
 */
export function computeEllipseParams(roll: number[], pitch: number[]): {
  centerX: number;
  centerY: number;
  semiAxisA: number;
  semiAxisB: number;
  angle: number;
  lambda1: number;
  lambda2: number;
} {
  const n = roll.length;
  if (n < 3) {
    return { centerX: 0, centerY: 0, semiAxisA: 0, semiAxisB: 0, angle: 0, lambda1: 0, lambda2: 0 };
  }

  // Compute means (single pass)
  let meanRoll = 0;
  let meanPitch = 0;
  for (let i = 0; i < n; i++) {
    meanRoll += roll[i];
    meanPitch += pitch[i];
  }
  meanRoll /= n;
  meanPitch /= n;

  // Compute covariance matrix elements (single pass)
  let varRoll = 0;
  let varPitch = 0;
  let covRP = 0;
  for (let i = 0; i < n; i++) {
    const dr = roll[i] - meanRoll;
    const dp = pitch[i] - meanPitch;
    varRoll += dr * dr;
    varPitch += dp * dp;
    covRP += dr * dp;
  }
  varRoll /= (n - 1);
  varPitch /= (n - 1);
  covRP /= (n - 1);

  // Eigenvalues of 2x2 covariance matrix:
  // λ = (trace ± √(trace² - 4·det)) / 2
  const trace = varRoll + varPitch;
  const det = varRoll * varPitch - covRP * covRP;
  const sqrtDisc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const lambda1 = (trace + sqrtDisc) / 2;
  const lambda2 = (trace - sqrtDisc) / 2;

  // Semi-axes scaled by chi-squared critical value
  const semiAxisA = Math.sqrt(Math.max(0, lambda1) * CHI2_95_DF2);
  const semiAxisB = Math.sqrt(Math.max(0, lambda2) * CHI2_95_DF2);

  // Rotation angle of the ellipse (angle of first eigenvector)
  const angle = 0.5 * Math.atan2(2 * covRP, varRoll - varPitch) * (180 / Math.PI);

  return { centerX: meanRoll, centerY: meanPitch, semiAxisA, semiAxisB, angle, lambda1, lambda2 };
}

/**
 * Compute the 95% confidence ellipse area of sway.
 *
 * Delegates to computeEllipseParams to avoid duplicating the covariance computation.
 *
 * @param roll Array of roll angles (degrees)
 * @param pitch Array of pitch angles (degrees)
 * @returns Ellipse area in degrees²
 */
export function computeStabilityArea(roll: number[], pitch: number[]): number {
  const { lambda1, lambda2 } = computeEllipseParams(roll, pitch);
  return Math.PI * CHI2_95_DF2 * Math.sqrt(Math.max(0, lambda1 * lambda2));
}
