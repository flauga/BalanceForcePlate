/**
 * Jerk metric: rate of change of COP velocity.
 *
 * Jerk captures the smoothness of balance corrections. High jerk values
 * indicate abrupt, jerky corrections — a sign of poor motor control.
 * Lower jerk values suggest smooth, well-coordinated balance responses.
 *
 * J = dv/dt (derivative of COP velocity)
 *
 * Reference:
 * - Hogan & Sternad (2009): Sensitivity of smoothness measures to movement
 *   duration, amplitude, and arrests
 */

/**
 * Compute RMS jerk from COP velocity arrays.
 *
 * Uses central difference approximation: jerk_i = (v_{i+1} - v_{i-1}) / (2·dt)
 *
 * @param copXVel COP X velocity time series (mm/s)
 * @param copYVel COP Y velocity time series (mm/s)
 * @param sampleRate Sample rate in Hz
 * @returns RMS jerk in mm/s³
 */
export function computeJerkRMS(
  copXVel: number[],
  copYVel: number[],
  sampleRate: number,
): number {
  const n = copXVel.length;
  if (n < 3) return 0;

  const dt = 1.0 / sampleRate;
  let sumSq = 0;
  let count = 0;

  for (let i = 1; i < n - 1; i++) {
    const jerkX = (copXVel[i + 1] - copXVel[i - 1]) / (2 * dt);
    const jerkY = (copYVel[i + 1] - copYVel[i - 1]) / (2 * dt);
    sumSq += jerkX * jerkX + jerkY * jerkY;
    count++;
  }

  if (count === 0) return 0;
  return Math.sqrt(sumSq / count);
}
