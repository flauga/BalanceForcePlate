'use client';

import { useState, useEffect, useRef } from 'react';

interface SessionTimerProps {
  state: string;
}

export function SessionTimer({ state }: SessionTimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (state === 'active' && !startRef.current) {
      startRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
      }, 100);
    } else if (state === 'idle') {
      startRef.current = null;
      setElapsed(0);
      if (intervalRef.current) clearInterval(intervalRef.current);
    } else if (state === 'ended') {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

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
        Session Time
      </div>
      <div style={{
        fontSize: '48px',
        fontWeight: 700,
        color: '#60a5fa',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {mins}:{secs.toString().padStart(2, '0')}
      </div>
    </div>
  );
}
