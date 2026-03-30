'use client';

import { useWebSocket } from '@/hooks/useWebSocket';
import { SwayPlot } from '@/components/SwayPlot';
import { MetricsPanel } from '@/components/MetricsPanel';
import { BalanceScoreDisplay } from '@/components/BalanceScore';
import { SessionTimer } from '@/components/SessionTimer';
import Link from 'next/link';

export default function DashboardPage() {
  const { connected, latestFrame, latestMetrics, sessionState } = useWebSocket();

  return (
    <div style={{ minHeight: '100vh', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
      }}>
        <h1 style={{ fontSize: '20px' }}>
          <Link href="/" style={{ color: '#fff', textDecoration: 'none' }}>IMU Balance Board</Link>
          {' '}<span style={{ color: '#888' }}>/ Live Dashboard</span>
        </h1>
        <div style={{
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '13px',
          fontWeight: 500,
          background: connected ? '#0a3d1a' : '#3d0a0a',
          color: connected ? '#4ade80' : '#f87171',
          border: `1px solid ${connected ? '#166534' : '#7f1d1d'}`,
        }}>
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      {!connected && (
        <div style={{
          background: '#1a1d27',
          border: '1px solid #2a2d3a',
          borderRadius: '12px',
          padding: '32px',
          textAlign: 'center',
          marginBottom: '20px',
        }}>
          <h3 style={{ marginBottom: '8px' }}>Waiting for connection...</h3>
          <p style={{ color: '#888', fontSize: '14px' }}>
            Make sure the local server is running: <code style={{ color: '#60a5fa' }}>pnpm --filter local-server dev -- --simulate</code>
          </p>
        </div>
      )}

      {/* Top row */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <BalanceScoreDisplay score={latestMetrics?.balanceScore ?? null} />
        <SessionTimer state={sessionState} />
        <div style={{
          flex: 1,
          background: '#1a1d27',
          border: '1px solid #2a2d3a',
          borderRadius: '12px',
          padding: '20px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '13px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            State
          </div>
          <div style={{
            fontSize: '24px',
            fontWeight: 600,
            color: sessionState === 'active' ? '#4ade80' : sessionState === 'ended' ? '#fbbf24' : '#888',
          }}>
            {sessionState.charAt(0).toUpperCase() + sessionState.slice(1)}
          </div>
        </div>
      </div>

      {/* Charts */}
      <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
        <SwayPlot
          roll={latestFrame?.rollFiltered ?? 0}
          pitch={latestFrame?.pitchFiltered ?? 0}
        />
      </div>

      {/* Metrics */}
      <MetricsPanel metrics={latestMetrics} />
    </div>
  );
}
