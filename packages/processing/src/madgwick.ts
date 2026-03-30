import { Quaternion } from './types.js';

/**
 * Madgwick AHRS (Attitude and Heading Reference System) filter.
 *
 * Fuses accelerometer and gyroscope data to estimate orientation as a quaternion.
 * Based on Sebastian Madgwick's gradient descent algorithm.
 *
 * Reference: Madgwick, S.O.H., Harrison, A.J.L., Vaidyanathan, R. (2011)
 * "Estimation of IMU and MARG orientation using a gradient descent algorithm"
 *
 * Port from the reference C implementation at x-io Technologies.
 */
export class MadgwickFilter {
  private q: Quaternion;
  private beta: number;
  private sampleRate: number;

  constructor(sampleRate: number = 100, beta: number = 0.1) {
    this.sampleRate = sampleRate;
    this.beta = beta;
    // Initialize to identity quaternion (no rotation)
    this.q = { w: 1, x: 0, y: 0, z: 0 };
  }

  /** Get the current orientation quaternion */
  getQuaternion(): Quaternion {
    return { ...this.q };
  }

  /** Reset to identity quaternion */
  reset(): void {
    this.q = { w: 1, x: 0, y: 0, z: 0 };
  }

  /** Set the filter gain parameter */
  setBeta(beta: number): void {
    this.beta = beta;
  }

  /**
   * Update the filter with new IMU data.
   *
   * @param ax Accelerometer X (g)
   * @param ay Accelerometer Y (g)
   * @param az Accelerometer Z (g)
   * @param gx Gyroscope X (rad/s) — NOTE: radians, not degrees
   * @param gy Gyroscope Y (rad/s)
   * @param gz Gyroscope Z (rad/s)
   */
  update(ax: number, ay: number, az: number, gx: number, gy: number, gz: number): void {
    let { w: q0, x: q1, y: q2, z: q3 } = this.q;
    const dt = 1.0 / this.sampleRate;

    // Normalize accelerometer measurement
    let norm = Math.sqrt(ax * ax + ay * ay + az * az);
    if (norm === 0) return; // Avoid division by zero
    norm = 1.0 / norm;
    ax *= norm;
    ay *= norm;
    az *= norm;

    // Auxiliary variables to avoid repeated arithmetic
    const _2q0 = 2.0 * q0;
    const _2q1 = 2.0 * q1;
    const _2q2 = 2.0 * q2;
    const _2q3 = 2.0 * q3;
    const _4q0 = 4.0 * q0;
    const _4q1 = 4.0 * q1;
    const _4q2 = 4.0 * q2;
    const _8q1 = 8.0 * q1;
    const _8q2 = 8.0 * q2;
    const q0q0 = q0 * q0;
    const q1q1 = q1 * q1;
    const q2q2 = q2 * q2;
    const q3q3 = q3 * q3;

    // Gradient descent corrective step
    // Objective function: minimize the error between measured and estimated gravity direction
    let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
    let s1 = _4q1 * q3q3 - _2q3 * ax + 4.0 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
    let s2 = 4.0 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
    let s3 = 4.0 * q1q1 * q3 - _2q1 * ax + 4.0 * q2q2 * q3 - _2q2 * ay;

    // Normalize step magnitude
    norm = 1.0 / Math.sqrt(s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3);
    s0 *= norm;
    s1 *= norm;
    s2 *= norm;
    s3 *= norm;

    // Rate of change of quaternion from gyroscope
    const qDot0 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    const qDot1 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
    const qDot2 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
    const qDot3 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

    // Apply feedback step
    q0 += (qDot0 - this.beta * s0) * dt;
    q1 += (qDot1 - this.beta * s1) * dt;
    q2 += (qDot2 - this.beta * s2) * dt;
    q3 += (qDot3 - this.beta * s3) * dt;

    // Normalize quaternion
    norm = 1.0 / Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    this.q.w = q0 * norm;
    this.q.x = q1 * norm;
    this.q.y = q2 * norm;
    this.q.z = q3 * norm;
  }
}
