/**
 * Second-order Butterworth low-pass filter.
 *
 * Designed for filtering orientation signals to remove sensor noise
 * and mechanical vibration while preserving postural sway dynamics.
 *
 * Default: 5 Hz cutoff at 100 Hz sample rate.
 */
export class LowPassFilter {
  // Filter coefficients
  private b0: number;
  private b1: number;
  private b2: number;
  private a1: number;
  private a2: number;

  // Filter state (Direct Form II Transposed)
  private z1: number = 0;
  private z2: number = 0;

  /**
   * Create a Butterworth low-pass filter.
   *
   * @param cutoffHz Cutoff frequency in Hz
   * @param sampleRate Sample rate in Hz
   */
  constructor(cutoffHz: number = 5.0, sampleRate: number = 100) {
    // Pre-warp the cutoff frequency
    const wc = Math.tan((Math.PI * cutoffHz) / sampleRate);
    const wc2 = wc * wc;
    const sqrt2 = Math.SQRT2;

    // Butterworth 2nd-order coefficients via bilinear transform
    const k = 1.0 / (1.0 + sqrt2 * wc + wc2);

    this.b0 = wc2 * k;
    this.b1 = 2.0 * this.b0;
    this.b2 = this.b0;
    this.a1 = 2.0 * (wc2 - 1.0) * k;
    this.a2 = (1.0 - sqrt2 * wc + wc2) * k;
  }

  /**
   * Process a single sample through the filter.
   *
   * @param input Raw input sample
   * @returns Filtered output sample
   */
  process(input: number): number {
    // Direct Form II Transposed
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    return output;
  }

  /** Reset filter state to zero */
  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}
