/**
 * All balance metrics: sway, stability area, frequency, jerk, time-in-zone, and composite score.
 */

import { BalanceMetrics, FrequencyFeatures, ScoreWeights } from './types.js';

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

export function computeSwayRMS_AP(copY: number[]): number {
  const n = copY.length;
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += copY[i] * copY[i];
  return Math.sqrt(sumSq / n);
}

export function computeSwayRMS_ML(copX: number[]): number {
  const n = copX.length;
  if (n === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) sumSq += copX[i] * copX[i];
  return Math.sqrt(sumSq / n);
}

export function computeSwayVelocity_AP(copY: number[], sampleRate: number): number {
  const n = copY.length;
  if (n < 2 || sampleRate <= 0) return 0;
  let length = 0;
  for (let i = 1; i < n; i++) length += Math.abs(copY[i] - copY[i - 1]);
  return length / (n / sampleRate);
}

export function computeSwayVelocity_ML(copX: number[], sampleRate: number): number {
  const n = copX.length;
  if (n < 2 || sampleRate <= 0) return 0;
  let length = 0;
  for (let i = 1; i < n; i++) length += Math.abs(copX[i] - copX[i - 1]);
  return length / (n / sampleRate);
}

export interface CentroidMetrics {
  meanCopX: number;
  meanCopY: number;
  mdist: number;
  maxdist: number;
  rangeAP: number;
  rangeML: number;
}

export function computeCentroidMetrics(copX: number[], copY: number[]): CentroidMetrics {
  const n = copX.length;
  if (n === 0) return { meanCopX: 0, meanCopY: 0, mdist: 0, maxdist: 0, rangeAP: 0, rangeML: 0 };

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += copX[i]; sumY += copY[i]; }
  const meanCopX = sumX / n;
  const meanCopY = sumY / n;

  let sumDist = 0, maxdist = 0;
  let minX = copX[0], maxX = copX[0], minY = copY[0], maxY = copY[0];
  for (let i = 0; i < n; i++) {
    const dx = copX[i] - meanCopX;
    const dy = copY[i] - meanCopY;
    const d = Math.sqrt(dx * dx + dy * dy);
    sumDist += d;
    if (d > maxdist) maxdist = d;
    if (copX[i] < minX) minX = copX[i];
    if (copX[i] > maxX) maxX = copX[i];
    if (copY[i] < minY) minY = copY[i];
    if (copY[i] > maxY) maxY = copY[i];
  }

  return { meanCopX, meanCopY, mdist: sumDist / n, maxdist, rangeML: maxX - minX, rangeAP: maxY - minY };
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
// Frequency features (FFT)
// ---------------------------------------------------------------------------

export function computeFrequencyFeatures(signal: number[], sampleRate: number): FrequencyFeatures {
  if (signal.length < 4) {
    return { dominantFrequency: 0, meanFrequency: 0, lowBandPower: 0, midBandPower: 0, highBandPower: 0 };
  }

  const n = nextPow2(signal.length);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  let mean = 0;
  for (let i = 0; i < signal.length; i++) mean += signal[i];
  mean /= signal.length;
  for (let i = 0; i < signal.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (signal.length - 1)));
    real[i] = (signal[i] - mean) * w;
  }

  fft(real, imag);

  const halfN = n / 2;
  const freqResolution = sampleRate / n;
  const power = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) power[i] = (real[i] * real[i] + imag[i] * imag[i]) / n;

  let maxPower = 0, dominantIdx = 0, totalPower = 0, weightedFreqSum = 0;
  let lowBandPower = 0, midBandPower = 0, highBandPower = 0;

  for (let i = 1; i < halfN; i++) {
    const freq = i * freqResolution;
    const p = power[i];
    totalPower += p;
    weightedFreqSum += freq * p;
    if (p > maxPower) { maxPower = p; dominantIdx = i; }
    if (freq < 0.5) lowBandPower += p;
    else if (freq <= 1.5) midBandPower += p;
    else highBandPower += p;
  }

  return {
    dominantFrequency: dominantIdx * freqResolution,
    meanFrequency: totalPower > 0 ? weightedFreqSum / totalPower : 0,
    lowBandPower, midBandPower, highBandPower,
  };
}

function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
    let k = n >> 1;
    while (k <= j) { j -= k; k >>= 1; }
    j += k;
  }

  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1, curImag = 0;
      for (let k = 0; k < halfLen; k++) {
        const evenIdx = i + k;
        const oddIdx = i + k + halfLen;
        const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
        const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];
        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] += tReal;
        imag[evenIdx] += tImag;
        const newCurReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurReal;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

// ---------------------------------------------------------------------------
// Jerk
// ---------------------------------------------------------------------------

export function computeJerkRMS(copXVel: number[], copYVel: number[], sampleRate: number): number {
  const n = copXVel.length;
  if (n < 3) return 0;
  const dt = 1.0 / sampleRate;
  let sumSq = 0, count = 0;
  for (let i = 1; i < n - 1; i++) {
    const jerkX = (copXVel[i + 1] - copXVel[i - 1]) / (2 * dt);
    const jerkY = (copYVel[i + 1] - copYVel[i - 1]) / (2 * dt);
    sumSq += jerkX * jerkX + jerkY * jerkY;
    count++;
  }
  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}

// ---------------------------------------------------------------------------
// Time in zone
// ---------------------------------------------------------------------------

export function computeTimeInZone(copX: number[], copY: number[], threshold: number = 10.0): number {
  const n = copX.length;
  if (n === 0) return 0;
  let inZoneCount = 0;
  for (let i = 0; i < n; i++) {
    if (Math.sqrt(copX[i] * copX[i] + copY[i] * copY[i]) < threshold) inZoneCount++;
  }
  return inZoneCount / n;
}

// ---------------------------------------------------------------------------
// Composite balance score
// ---------------------------------------------------------------------------

const NORM_PARAMS = {
  swayRMS:       { center: 10.0,  scale: 6.0   },
  swayVelocity:  { center: 20.0,  scale: 12.0  },
  stabilityArea: { center: 500.0, scale: 300.0 },
  jerkRMS:       { center: 1000,  scale: 600   },
};

function sigmoidNormInverse(value: number, center: number, scale: number): number {
  return 1.0 / (1.0 + Math.exp((value - center) / scale));
}

export function computeBalanceScore(
  metrics: Pick<BalanceMetrics, 'swayRMS' | 'swayVelocity' | 'stabilityArea' | 'jerkRMS' | 'timeInZone'>,
  weights: ScoreWeights,
): number {
  const normSwayRMS  = sigmoidNormInverse(metrics.swayRMS,       NORM_PARAMS.swayRMS.center,      NORM_PARAMS.swayRMS.scale);
  const normVelocity = sigmoidNormInverse(metrics.swayVelocity,  NORM_PARAMS.swayVelocity.center, NORM_PARAMS.swayVelocity.scale);
  const normArea     = sigmoidNormInverse(metrics.stabilityArea, NORM_PARAMS.stabilityArea.center, NORM_PARAMS.stabilityArea.scale);
  const normJerk     = sigmoidNormInverse(metrics.jerkRMS,       NORM_PARAMS.jerkRMS.center,      NORM_PARAMS.jerkRMS.scale);
  const totalWeight  = weights.swayRMS + weights.swayVelocity + weights.stabilityArea + weights.timeInZone + weights.jerkRMS;
  const rawScore =
    (weights.swayRMS       * normSwayRMS  +
     weights.swayVelocity  * normVelocity +
     weights.stabilityArea * normArea     +
     weights.timeInZone    * metrics.timeInZone +
     weights.jerkRMS       * normJerk) / totalWeight;
  return Math.max(0, Math.min(100, rawScore * 100));
}
