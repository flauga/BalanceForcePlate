import { Quaternion, Orientation } from './types.js';

/**
 * Convert a quaternion to Euler angles (roll and pitch).
 *
 * Uses aerospace convention (ZYX rotation order):
 * - Roll (phi): rotation about X axis
 * - Pitch (theta): rotation about Y axis
 * - Yaw is not used for balance analysis
 *
 * @param q Orientation quaternion
 * @returns Roll and pitch in degrees
 */
export function quaternionToEuler(q: Quaternion): Orientation {
  const { w, x, y, z } = q;

  // Roll (rotation about X axis)
  const sinRoll = 2.0 * (w * x + y * z);
  const cosRoll = 1.0 - 2.0 * (x * x + y * y);
  const roll = Math.atan2(sinRoll, cosRoll);

  // Pitch (rotation about Y axis)
  const sinPitch = 2.0 * (w * y - z * x);
  // Clamp to avoid NaN from asin due to floating point
  const pitch = Math.abs(sinPitch) >= 1
    ? Math.sign(sinPitch) * (Math.PI / 2)
    : Math.asin(sinPitch);

  // Convert to degrees
  const RAD_TO_DEG = 180.0 / Math.PI;

  return {
    roll: roll * RAD_TO_DEG,
    pitch: pitch * RAD_TO_DEG,
  };
}

/**
 * Convert degrees to radians.
 */
export function degToRad(deg: number): number {
  return deg * (Math.PI / 180.0);
}

/**
 * Convert radians to degrees.
 */
export function radToDeg(rad: number): number {
  return rad * (180.0 / Math.PI);
}
