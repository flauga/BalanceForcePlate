/**
 * Jerk metric: rate of change of angular velocity.
 *
 * Jerk captures the smoothness of balance corrections. High jerk values
 * indicate abrupt, jerky corrections — a sign of poor motor control.
 * Lower jerk values suggest smooth, well-coordinated balance responses.
 *
 * J = dω/dt (derivative of angular velocity)
 *
 * Reference:
 * - Hogan & Sternad (2009): Sensitivity of smoothness measures to movement
 *   duration, amplitude, and arrests
 */

/**
 * Compute RMS jerk from angular velocity arrays.
 *
 * @param gyroX Gyroscope X time series (deg/s)
 * @param gyroY Gyroscope Y time series (deg/s)
 * @param sampleRate Sample rate in Hz
 * @returns RMS jerk in deg/s³
 */
export function computeJerkRMS(
  gyroX: number[],
  gyroY: number[],
  sampleRate: number,
): number {
  const n = gyroX.length;
  if (n < 3) return 0;

  const dt = 1.0 / sampleRate;
  let sumSq = 0;
  let count = 0;

  // Central difference approximation for derivative of angular velocity
  // jerk_i = (ω_{i+1} - ω_{i-1}) / (2·dt)
  for (let i = 1; i < n - 1; i++) {
    const jerkX = (gyroX[i + 1] - gyroX[i - 1]) / (2 * dt);
    const jerkY = (gyroY[i + 1] - gyroY[i - 1]) / (2 * dt);
    sumSq += jerkX * jerkX + jerkY * jerkY;
    count++;
  }

  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}
