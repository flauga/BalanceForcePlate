/**
 * Chart rendering for the balance board dashboard.
 * Uses HTML5 Canvas for sway trajectory and time series.
 */

class SwayChart {
  constructor(canvasId, maxPoints = 500) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.points = [];
    this.range = 10; // degrees, auto-adjusts
  }

  addPoint(roll, pitch) {
    this.points.push({ x: roll, y: pitch });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }

    // Auto-adjust range
    const maxVal = Math.max(
      ...this.points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))
    );
    this.range = Math.max(5, Math.ceil(maxVal * 1.2));
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const scale = Math.min(cx, cy) / this.range;

    // Clear
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;

    // Concentric circles
    for (let r = 2; r <= this.range; r += 2) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.fillText('Roll', w - 30, cy - 5);
    ctx.fillText('Pitch', cx + 5, 15);

    // Stability zone circle
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, 3 * scale, 0, Math.PI * 2); // 3 degree threshold
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw trail
    if (this.points.length < 2) return;

    ctx.lineWidth = 1.5;
    for (let i = 1; i < this.points.length; i++) {
      const alpha = i / this.points.length;
      ctx.strokeStyle = `rgba(96, 165, 250, ${alpha * 0.8})`;
      ctx.beginPath();
      ctx.moveTo(cx + this.points[i - 1].x * scale, cy - this.points[i - 1].y * scale);
      ctx.lineTo(cx + this.points[i].x * scale, cy - this.points[i].y * scale);
      ctx.stroke();
    }

    // Current point
    const last = this.points[this.points.length - 1];
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(cx + last.x * scale, cy - last.y * scale, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  clear() {
    this.points = [];
  }
}

class TimeSeriesChart {
  constructor(canvasId, maxPoints = 500) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.rollData = [];
    this.pitchData = [];
    this.range = 10;
  }

  addPoint(roll, pitch) {
    this.rollData.push(roll);
    this.pitchData.push(pitch);
    if (this.rollData.length > this.maxPoints) {
      this.rollData.shift();
      this.pitchData.shift();
    }

    const maxVal = Math.max(
      ...this.rollData.map(Math.abs),
      ...this.pitchData.map(Math.abs)
    );
    this.range = Math.max(5, Math.ceil(maxVal * 1.2));
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const plotW = w - padding.left - padding.right;
    const plotH = h - padding.top - padding.bottom;
    const cy = padding.top + plotH / 2;

    // Clear
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, w, h);

    // Y axis grid and labels
    ctx.strokeStyle = '#2a2d3a';
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.lineWidth = 1;

    const ySteps = 5;
    for (let i = -ySteps; i <= ySteps; i++) {
      const val = (i / ySteps) * this.range;
      const y = cy - (val / this.range) * (plotH / 2);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillText(val.toFixed(0) + '°', 5, y + 4);
    }

    // Zero line
    ctx.strokeStyle = '#444';
    ctx.beginPath();
    ctx.moveTo(padding.left, cy);
    ctx.lineTo(w - padding.right, cy);
    ctx.stroke();

    // Draw data
    const n = this.rollData.length;
    if (n < 2) return;

    const drawLine = (data, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = padding.left + (i / (this.maxPoints - 1)) * plotW;
        const y = cy - (data[i] / this.range) * (plotH / 2);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    drawLine(this.rollData, '#60a5fa');   // Blue for roll
    drawLine(this.pitchData, '#f472b6');  // Pink for pitch

    // Legend
    ctx.fillStyle = '#60a5fa';
    ctx.fillRect(padding.left + 10, padding.top + 5, 12, 3);
    ctx.fillStyle = '#888';
    ctx.fillText('Roll', padding.left + 28, padding.top + 10);

    ctx.fillStyle = '#f472b6';
    ctx.fillRect(padding.left + 80, padding.top + 5, 12, 3);
    ctx.fillStyle = '#888';
    ctx.fillText('Pitch', padding.left + 98, padding.top + 10);
  }

  clear() {
    this.rollData = [];
    this.pitchData = [];
  }
}
