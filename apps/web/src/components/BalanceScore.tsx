'use client';

interface BalanceScoreDisplayProps {
  score: number | null;
}

export function BalanceScoreDisplay({ score }: BalanceScoreDisplayProps) {
  const color = score === null ? '#888' :
    score >= 70 ? '#4ade80' :
    score >= 40 ? '#fbbf24' : '#f87171';

  return (
    <div style={{
      flex: 1,
      background: '#1a1d27',
      border: '1px solid #2a2d3a',
      borderRadius: '12px',
      padding: '20px',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: '13px',
        color: '#888',
        marginBottom: '8px',
        textTransform: 'uppercase',
        letterSpacing: '1px',
      }}>
        Balance Score
      </div>
      <div style={{
        fontSize: '48px',
        fontWeight: 700,
        color,
      }}>
        {score !== null ? score.toFixed(0) : '--'}
      </div>
    </div>
  );
}
