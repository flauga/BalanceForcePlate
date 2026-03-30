'use client';

import type { BalanceMetrics } from '@imu-balance/processing';

interface MetricsPanelProps {
  metrics: BalanceMetrics | null;
}

interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
}

function MetricCard({ label, value, unit }: MetricCardProps) {
  return (
    <div style={{
      background: '#1a1d27',
      border: '1px solid #2a2d3a',
      borderRadius: '12px',
      padding: '16px',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '11px',
        color: '#888',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        marginBottom: '8px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: '28px',
        fontWeight: 700,
        color: '#e0e0e0',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {value}
      </div>
      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
        {unit}
      </div>
    </div>
  );
}

export function MetricsPanel({ metrics }: MetricsPanelProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: '12px',
    }}>
      <MetricCard
        label="Sway RMS"
        value={metrics ? metrics.swayRMS.toFixed(2) : '--'}
        unit="deg"
      />
      <MetricCard
        label="Path Length"
        value={metrics ? metrics.pathLength.toFixed(1) : '--'}
        unit="deg"
      />
      <MetricCard
        label="Sway Velocity"
        value={metrics ? metrics.swayVelocity.toFixed(2) : '--'}
        unit="deg/s"
      />
      <MetricCard
        label="Stability Area"
        value={metrics ? metrics.stabilityArea.toFixed(1) : '--'}
        unit="deg²"
      />
      <MetricCard
        label="Jerk RMS"
        value={metrics ? metrics.jerkRMS.toFixed(0) : '--'}
        unit="deg/s³"
      />
      <MetricCard
        label="Time in Zone"
        value={metrics ? (metrics.timeInZone * 100).toFixed(0) : '--'}
        unit="%"
      />
      <MetricCard
        label="Dominant Freq"
        value={metrics ? metrics.frequencyFeatures.dominantFrequency.toFixed(2) : '--'}
        unit="Hz"
      />
    </div>
  );
}
