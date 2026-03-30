import Link from 'next/link';

export default function HomePage() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
    }}>
      <h1 style={{ fontSize: '48px', fontWeight: 700, marginBottom: '16px' }}>
        IMU Balance Board
      </h1>
      <p style={{ fontSize: '18px', color: '#888', marginBottom: '48px', textAlign: 'center', maxWidth: '600px' }}>
        Train your balance with real-time posturography metrics.
        Track your progress over time with advanced IMU-based analysis.
      </p>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/dashboard" style={{
          padding: '14px 32px',
          background: '#4ade80',
          color: '#000',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 600,
          textDecoration: 'none',
        }}>
          Live Dashboard
        </Link>
        <Link href="/sessions" style={{
          padding: '14px 32px',
          background: '#1a1d27',
          color: '#e0e0e0',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 600,
          border: '1px solid #2a2d3a',
          textDecoration: 'none',
        }}>
          Session History
        </Link>
        <Link href="/auth" style={{
          padding: '14px 32px',
          background: '#1a1d27',
          color: '#e0e0e0',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: 600,
          border: '1px solid #2a2d3a',
          textDecoration: 'none',
        }}>
          Sign In
        </Link>
      </div>

      <div style={{
        marginTop: '80px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '24px',
        maxWidth: '900px',
        width: '100%',
      }}>
        {[
          {
            title: 'Real-Time Metrics',
            desc: 'Sway RMS, path length, velocity, stability area, jerk, and frequency analysis computed at 10Hz.',
          },
          {
            title: 'Balance Score',
            desc: 'Composite 0-100 score combining multiple posturography metrics with research-backed weighting.',
          },
          {
            title: 'Progress Tracking',
            desc: 'Track your balance improvement over time with session history and trend visualization.',
          },
        ].map((feature) => (
          <div key={feature.title} style={{
            background: '#1a1d27',
            border: '1px solid #2a2d3a',
            borderRadius: '12px',
            padding: '24px',
          }}>
            <h3 style={{ fontSize: '16px', marginBottom: '8px', color: '#60a5fa' }}>
              {feature.title}
            </h3>
            <p style={{ fontSize: '14px', color: '#888', lineHeight: '1.5' }}>
              {feature.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
