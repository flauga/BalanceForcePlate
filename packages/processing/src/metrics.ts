/**
 * Balance metrics: sway, stability area, and composite score.
 */

import { BalanceMetrics } from './types.js';

// ---------------------------------------------------------------------------
// Sway metrics
// ---------------------------------------------------------------------------

export function computeSwayRMS(copX: number[], copY: number[]): number {
  const n = copX.length;
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += copX[i] * copX[i] + copY[i] * copY[i];
  return Math.sqrt(sumSq / n);
}

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

export function computeSwayVelocity(pathLength: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  return pathLength / durationSeconds;
}

export interface CentroidMetrics {
  maxdist: number;
  rangeAP: number;
  rangeML: number;
}

export function computeCentroidMetrics(copX: number[], copY: number[]): CentroidMetrics {
  const n = copX.length;
  if (n === 0) return { maxdist: 0, rangeAP: 0, rangeML: 0 };

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += copX[i]; sumY += copY[i]; }
  const meanCopX = sumX / n;
  const meanCopY = sumY / n;

  let maxdist = 0;
  let minX = copX[0], maxX = copX[0], minY = copY[0], maxY = copY[0];
  for (let i = 0; i < n; i++) {
    const dx = copX[i] - meanCopX;
    const dy = copY[i] - meanCopY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > maxdist) maxdist = d;
    if (copX[i] < minX) minX = copX[i];
    if (copX[i] > maxX) maxX = copX[i];
    if (copY[i] < minY) minY = copY[i];
    if (copY[i] > maxY) maxY = copY[i];
  }

  return { maxdist, rangeML: maxX - minX, rangeAP: maxY - minY };
}

// ---------------------------------------------------------------------------
// Stability area (95% confidence ellipse)
// ---------------------------------------------------------------------------

const CHI2_95_DF2 = 5.991;

export function computeEllipseParams(copX: number[], copY: number[]): {
  centerX: number; centerY: number;
  semiAxisA: number; semiAxisB: number;
  angle: number; lambda1: number; lambda2: number;
} {
  const n = copX.length;
  if (n < 3) return { centerX: 0, centerY: 0, semiAxisA: 0, semiAxisB: 0, angle: 0, lambda1: 0, lambda2: 0 };

  let meanX = 0, meanY = 0;
  for (let i = 0; i < n; i++) { meanX += copX[i]; meanY += copY[i]; }
  meanX /= n; meanY /= n;

  let varX = 0, varY = 0, covXY = 0;
  for (let i = 0; i < n; i++) {
    const dx = copX[i] - meanX;
    const dy = copY[i] - meanY;
    varX += dx * dx; varY += dy * dy; covXY += dx * dy;
  }
  varX /= (n - 1); varY /= (n - 1); covXY /= (n - 1);

  const trace = varX + varY;
  const det = varX * varY - covXY * covXY;
  const sqrtDisc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
  const lambda1 = (trace + sqrtDisc) / 2;
  const lambda2 = (trace - sqrtDisc) / 2;

  return {
    centerX: meanX, centerY: meanY,
    semiAxisA: Math.sqrt(Math.max(0, lambda1) * CHI2_95_DF2),
    semiAxisB: Math.sqrt(Math.max(0, lambda2) * CHI2_95_DF2),
    angle: 0.5 * Math.atan2(2 * covXY, varX - varY) * (180 / Math.PI),
    lambda1, lambda2,
  };
}

export function computeStabilityArea(copX: number[], copY: number[]): number {
  const { lambda1, lambda2 } = computeEllipseParams(copX, copY);
  return Math.PI * CHI2_95_DF2 * Math.sqrt(Math.max(0, lambda1 * lambda2));
}

// ---------------------------------------------------------------------------
// Composite balance score
// ---------------------------------------------------------------------------

const NORM_PARAMS = {
  swayRMS:       { center: 10.0,  scale: 6.0   },
  swayVelocity:  { center: 20.0,  scale: 12.0  },
  stabilityArea: { center: 500.0, scale: 300.0 },
};

function sigmoidNormInverse(value: number, center: number, scale: number): number {
  return 1.0 / (1.0 + Math.exp((value - center) / scale));
}

export function computeBalanceScore(
  metrics: Pick<BalanceMetrics, 'swayRMS' | 'swayVelocity' | 'stabilityArea'>,
): number {
  const normSwayRMS  = sigmoidNormInverse(metrics.swayRMS,       NORM_PARAMS.swayRMS.center,      NORM_PARAMS.swayRMS.scale);
  const normVelocity = sigmoidNormInverse(metrics.swayVelocity,  NORM_PARAMS.swayVelocity.center, NORM_PARAMS.swayVelocity.scale);
  const normArea     = sigmoidNormInverse(metrics.stabilityArea, NORM_PARAMS.stabilityArea.center, NORM_PARAMS.stabilityArea.scale);
  const rawScore = (normSwayRMS + normVelocity + normArea) / 3;
  return Math.max(0, Math.min(100, rawScore * 100));
}
