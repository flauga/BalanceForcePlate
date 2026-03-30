/**
 * CSV export utilities for balance sessions.
 *
 * Two exports are available:
 *
 * 1. Raw CSV  — one row per IMU sample (100 Hz)
 *    Useful for re-running the processing pipeline with different parameters.
 *
 * 2. Processed CSV — one row per processed frame, including orientation,
 *    filtered angles, and metrics (when available, else empty).
 *    Useful for data analysis in Python/MATLAB/Excel.
 */

import type { Session, RawIMUData, ProcessedFrame, BalanceMetrics } from './types.js';

// ---- Raw CSV ---------------------------------------------------------------

const RAW_HEADER =
  'timestamp_ms,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps';

function rawRow(d: RawIMUData): string {
  return [d.t, d.ax, d.ay, d.az, d.gx, d.gy, d.gz].join(',');
}

/**
 * Convert raw IMU samples to a CSV string.
 * Falls back to an empty data section if the session has no rawData.
 */
export function sessionToRawCSV(session: Session): string {
  const rows: string[] = [RAW_HEADER];
  for (const d of session.rawData ?? []) {
    rows.push(rawRow(d));
  }
  return rows.join('\n');
}

// ---- Processed CSV ---------------------------------------------------------

const PROCESSED_HEADER = [
  'timestamp_ms',
  'roll_deg', 'pitch_deg',
  'roll_filtered_deg', 'pitch_filtered_deg',
  'gyro_x_dps', 'gyro_y_dps', 'gyro_z_dps',
  'session_state',
  // Metrics (empty when not computed for this frame)
  'sway_rms', 'path_length_deg', 'sway_velocity_dps',
  'stability_area_deg2', 'jerk_rms', 'time_in_zone_pct',
  'dominant_freq_hz', 'mean_freq_hz',
  'low_band_power', 'mid_band_power', 'high_band_power',
  'balance_score',
].join(',');

function metricsFields(m: BalanceMetrics | null): string {
  if (!m) return ',,,,,,,,,,,';
  return [
    m.swayRMS.toFixed(4),
    m.pathLength.toFixed(4),
    m.swayVelocity.toFixed(4),
    m.stabilityArea.toFixed(4),
    m.jerkRMS.toFixed(4),
    (m.timeInZone * 100).toFixed(2),
    m.frequencyFeatures.dominantFrequency.toFixed(4),
    m.frequencyFeatures.meanFrequency.toFixed(4),
    m.frequencyFeatures.lowBandPower.toFixed(6),
    m.frequencyFeatures.midBandPower.toFixed(6),
    m.frequencyFeatures.highBandPower.toFixed(6),
    m.balanceScore.toFixed(2),
  ].join(',');
}

function processedRow(f: ProcessedFrame): string {
  return [
    f.timestamp,
    f.roll.toFixed(4),
    f.pitch.toFixed(4),
    f.rollFiltered.toFixed(4),
    f.pitchFiltered.toFixed(4),
    f.gyroX.toFixed(4),
    f.gyroY.toFixed(4),
    f.gyroZ.toFixed(4),
    f.sessionState,
    metricsFields(f.metrics),
  ].join(',');
}

/**
 * Convert processed frames to a CSV string.
 * Falls back to an empty data section if the session has no timeSeries.
 */
export function sessionToProcessedCSV(session: Session): string {
  const rows: string[] = [PROCESSED_HEADER];
  for (const f of session.timeSeries ?? []) {
    rows.push(processedRow(f));
  }
  return rows.join('\n');
}
