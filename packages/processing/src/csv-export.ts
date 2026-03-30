/**
 * CSV export utilities for balance sessions.
 *
 * Two exports are available:
 *
 * 1. Raw CSV  — one row per force plate sample (40 Hz)
 *    Contains raw HX711 counts for all 4 corners.
 *    Useful for re-running the processing pipeline with different parameters.
 *
 * 2. Processed CSV — one row per processed frame, including COP positions,
 *    filtered values, and metrics (when available, else empty).
 *    Useful for data analysis in Python/MATLAB/Excel.
 */

import type { Session, RawForceData, ProcessedFrame, BalanceMetrics } from './types.js';

// ---- Raw CSV ---------------------------------------------------------------

const RAW_HEADER =
  'timestamp_ms,f0_counts,f1_counts,f2_counts,f3_counts';

function rawRow(d: RawForceData): string {
  return [d.t, d.f0, d.f1, d.f2, d.f3].join(',');
}

/**
 * Convert raw force plate samples to a CSV string.
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
  'cop_x_mm', 'cop_y_mm',
  'cop_x_filtered_mm', 'cop_y_filtered_mm',
  'fz_counts',
  'f0_counts', 'f1_counts', 'f2_counts', 'f3_counts',
  'session_state',
  // Metrics (empty when not computed for this frame)
  'sway_rms_mm', 'path_length_mm', 'sway_velocity_mms',
  'stability_area_mm2', 'jerk_rms', 'time_in_zone_pct',
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
    f.copX.toFixed(4),
    f.copY.toFixed(4),
    f.copXFiltered.toFixed(4),
    f.copYFiltered.toFixed(4),
    f.fz,
    f.f0, f.f1, f.f2, f.f3,
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
