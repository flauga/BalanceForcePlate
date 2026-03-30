/**
 * Frequency domain analysis of postural sway signals.
 *
 * FFT-based analysis reveals the control mechanisms underlying balance:
 * - < 0.5 Hz: Natural sway (open-loop vestibular/proprioceptive)
 * - 0.5–1.5 Hz: Corrective responses (closed-loop neuromuscular)
 * - > 1.5 Hz: Tremor, noise, or high-frequency corrections
 *
 * Reference:
 * - Collins & De Luca (1993): Open-loop and closed-loop control of posture
 */

import { FrequencyFeatures } from '../types.js';

/**
 * Compute frequency domain features from a sway signal.
 *
 * Uses a simple radix-2 FFT implementation (no external dependency for core).
 *
 * @param signal Input signal (roll or pitch time series)
 * @param sampleRate Sample rate in Hz
 * @returns Frequency analysis results
 */
export function computeFrequencyFeatures(signal: number[], sampleRate: number): FrequencyFeatures {
  if (signal.length < 4) {
    return {
      dominantFrequency: 0,
      meanFrequency: 0,
      lowBandPower: 0,
      midBandPower: 0,
      highBandPower: 0,
    };
  }

  // Zero-pad to next power of 2
  const n = nextPow2(signal.length);
  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  // Remove mean (DC offset) and copy
  let mean = 0;
  for (let i = 0; i < signal.length; i++) mean += signal[i];
  mean /= signal.length;
  for (let i = 0; i < signal.length; i++) {
    real[i] = signal[i] - mean;
  }

  // Apply Hanning window
  for (let i = 0; i < signal.length; i++) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (signal.length - 1)));
    real[i] *= w;
  }

  // FFT
  fft(real, imag);

  // Compute power spectrum (only positive frequencies)
  const halfN = n / 2;
  const freqResolution = sampleRate / n;
  const power = new Float64Array(halfN);
  for (let i = 0; i < halfN; i++) {
    power[i] = (real[i] * real[i] + imag[i] * imag[i]) / n;
  }

  // Find dominant frequency and compute band powers
  let maxPower = 0;
  let dominantIdx = 0;
  let totalPower = 0;
  let weightedFreqSum = 0;
  let lowBandPower = 0;
  let midBandPower = 0;
  let highBandPower = 0;

  for (let i = 1; i < halfN; i++) {  // Skip DC (i=0)
    const freq = i * freqResolution;
    const p = power[i];

    totalPower += p;
    weightedFreqSum += freq * p;

    if (p > maxPower) {
      maxPower = p;
      dominantIdx = i;
    }

    if (freq < 0.5) {
      lowBandPower += p;
    } else if (freq <= 1.5) {
      midBandPower += p;
    } else {
      highBandPower += p;
    }
  }

  const dominantFrequency = dominantIdx * freqResolution;
  const meanFrequency = totalPower > 0 ? weightedFreqSum / totalPower : 0;

  return {
    dominantFrequency,
    meanFrequency,
    lowBandPower,
    midBandPower,
    highBandPower,
  };
}

/**
 * In-place radix-2 Cooley-Tukey FFT.
 */
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Cooley-Tukey butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;

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

/** Find the next power of 2 >= n */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}
