/**
 * Stability area: 95% confidence ellipse of COP distribution.
 *
 * The confidence ellipse represents the spatial spread of postural sway.
 * It is computed from the eigenvalues of the 2x2 covariance matrix of
 * the (copX, copY) COP signal.
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
 * @param copX Array of COP X positions (mm)
 * @param copY Array of COP Y positions (mm)
 * @returns Ellipse center, semi-axes, rotation angle, and eigenvalues
 */
export function computeEllipseParams(copX: number[], copY: number[]): {
  centerX: number;
  centerY: number;
  semiAxisA: number;
  semiAxisB: number;
  angle: number;
  lambda1: number;
  lambda2: number;
} {
  const n = copX.length;
  if (n < 3) {
    return { centerX: 0, centerY: 0, semiAxisA: 0, semiAxisB: 0, angle: 0, lambda1: 0, lambda2: 0 };
  }

  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += copX[i];
    meanY += copY[i];
  }
  meanX /= n;
  meanY /= n;

  let varX = 0;
  let varY = 0;
  let covXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = copX[i] - meanX;
    const dy = copY[i] - meanY;
    varX  += dx * dx;
    varY  += dy * dy;
    covXY += dx * dy;
  }
  varX  /= (n - 1);
  varY  /= (n - 1);
  covXY /= (n - 1);

  // Eigenvalues of 2x2 covariance matrix
  const trace = varX + varY;
  const det = varX * varY - covXY * covXY;
  const sqrtDisc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const lambda1 = (trace + sqrtDisc) / 2;
  const lambda2 = (trace - sqrtDisc) / 2;

  const semiAxisA = Math.sqrt(Math.max(0, lambda1) * CHI2_95_DF2);
  const semiAxisB = Math.sqrt(Math.max(0, lambda2) * CHI2_95_DF2);
  const angle = 0.5 * Math.atan2(2 * covXY, varX - varY) * (180 / Math.PI);

  return { centerX: meanX, centerY: meanY, semiAxisA, semiAxisB, angle, lambda1, lambda2 };
}

/**
 * Compute the 95% confidence ellipse area of COP sway.
 *
 * @param copX Array of COP X positions (mm)
 * @param copY Array of COP Y positions (mm)
 * @returns Ellipse area in mm²
 */
export function computeStabilityArea(copX: number[], copY: number[]): number {
  const { lambda1, lambda2 } = computeEllipseParams(copX, copY);
  return Math.PI * CHI2_95_DF2 * Math.sqrt(Math.max(0, lambda1 * lambda2));
}
