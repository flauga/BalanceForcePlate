'use client';

import { useRef, useEffect } from 'react';

interface SwayPlotProps {
  roll: number;
  pitch: number;
  maxPoints?: number;
}

export function SwayPlot({ roll, pitch, maxPoints = 500 }: SwayPlotProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointsRef = useRef<Array<{ x: number; y: number }>>([]);

  useEffect(() => {
    const points = pointsRef.current;
    points.push({ x: roll, y: pitch });
    if (points.length > maxPoints) points.shift();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Auto-range
    let range = 5;
    for (const p of points) {
      range = Math.max(range, Math.abs(p.x) * 1.2, Math.abs(p.y) * 1.2);
    }
    range = Math.ceil(range);
    const scale = Math.min(cx, cy) / range;

    // Clear
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, w, h);

    // Grid circles
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    for (let r = 2; r <= range; r += 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();

    // Stability zone
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Trail
    if (points.length >= 2) {
      ctx.lineWidth = 1.5;
      for (let i = 1; i < points.length; i++) {
        const alpha = i / points.length;
        ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * 0.8})`;
        ctx.beginPath();
        ctx.moveTo(cx + points[i - 1].x * scale, cy - points[i - 1].y * scale);
        ctx.lineTo(cx + points[i].x * scale, cy - points[i].y * scale);
        ctx.stroke();
      }

      // Current point
      const last = points[points.length - 1];
      ctx.fillStyle = '#60a5fa';
      ctx.beginPath();
      ctx.arc(cx + last.x * scale, cy - last.y * scale, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [roll, pitch, maxPoints]);

  return (
    <div style={{
      background: '#1a1d27',
      border: '1px solid #2a2d3a',
      borderRadius: '12px',
      padding: '16px',
      flex: 1,
    }}>
      <h3 style={{ fontSize: '14px', color: '#888', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
        Sway Trajectory
      </h3>
      <canvas ref={canvasRef} width={400} height={400} style={{ width: '100%', height: 'auto' }} />
    </div>
  );
}
