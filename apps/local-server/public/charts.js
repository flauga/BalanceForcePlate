/**
 * Chart rendering for the Balance Force Plate dashboard.
 * Uses HTML5 Canvas for COP trajectory and force distribution.
 */

class SwayChart {
  constructor(canvasId, maxPoints = 500) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.maxPoints = maxPoints;
    this.points = [];
    this.range = 30; // mm, auto-adjusts
  }

  addPoint(copX, copY) {
    this.points.push({ x: copX, y: copY });
    if (this.points.length > this.maxPoints) {
      this.points.shift();
    }

    // Auto-adjust range based on data
    const maxVal = Math.max(...this.points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
    this.range = Math.max(20, Math.ceil(maxVal * 1.3 / 10) * 10);
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

    // Grid — concentric circles every 10mm
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    for (let r = 10; r <= this.range; r += 10) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
      // Label outermost ring
      ctx.fillStyle = '#444';
      ctx.font = '10px sans-serif';
      ctx.fillText(`${r}mm`, cx + r * scale + 2, cy);
    }

    // Crosshairs
    ctx.strokeStyle = '#2a2d3a';
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#555';
    ctx.font = '11px sans-serif';
    ctx.fillText('Right (+X)', w - 68, cy - 6);
    ctx.fillText('Front (+Y)', cx + 5, 14);

    // Stability zone circle (10mm radius default)
    ctx.strokeStyle = '#166534';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(cx, cy, 10 * scale, 0, Math.PI * 2);
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
      ctx.lineTo(cx + this.points[i].x * scale,     cy - this.points[i].y * scale);
      ctx.stroke();
    }

    // Current position dot
    const last = this.points[this.points.length - 1];
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath();
    ctx.arc(cx + last.x * scale, cy - last.y * scale, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  clear() {
    this.points = [];
    this.range = 30;
  }
}

/**
 * ForceDistributionChart — shows real-time force on each of the 4 corners
 * plus total Fz, using a bar chart.
 */
class ForceDistributionChart {
  constructor(canvasId, historyLength = 200) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.historyLength = historyLength;
    // Rolling history for each sensor
    this.history = [[], [], [], []];
    this.fzHistory = [];
    this.maxForce = 1000; // auto-adjusts
    this.labels = ['FL', 'FR', 'BL', 'BR'];
    this.colors = ['#60a5fa', '#4ade80', '#f472b6', '#fbbf24'];
  }

  addReading(f0, f1, f2, f3) {
    const values = [f0, f1, f2, f3];
    const fz = f0 + f1 + f2 + f3;

    for (let i = 0; i < 4; i++) {
      this.history[i].push(values[i]);
      if (this.history[i].length > this.historyLength) this.history[i].shift();
    }
    this.fzHistory.push(fz);
    if (this.fzHistory.length > this.historyLength) this.fzHistory.shift();

    const max = Math.max(fz, this.maxForce);
    this.maxForce = Math.max(1000, Math.ceil(max / 10000) * 10000);
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const pad = { top: 30, right: 20, bottom: 50, left: 60 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Clear
    ctx.fillStyle = '#0f1117';
    ctx.fillRect(0, 0, w, h);

    // Get last values
    const lastVals = this.history.map(arr => arr[arr.length - 1] || 0);
    const fz = lastVals.reduce((a, b) => a + b, 0);
    const maxBar = Math.max(this.maxForce, fz);

    // --- Left panel: bar chart of 4 corners ---
    const barW = 60;
    const barGap = 20;
    const totalBarsW = 4 * barW + 3 * barGap;
    const barStartX = pad.left + (plotW * 0.4 - totalBarsW) / 2;
    const barBaseY = pad.top + plotH;

    // Y grid
    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#555';
    ctx.font = '10px sans-serif';
    const yTicks = 4;
    for (let i = 0; i <= yTicks; i++) {
      const val = (i / yTicks) * maxBar;
      const y = barBaseY - (val / maxBar) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + plotW * 0.45, y);
      ctx.stroke();
      ctx.fillText(val > 999 ? (val / 1000).toFixed(0) + 'k' : val.toFixed(0), 5, y + 4);
    }

    // Bars
    for (let i = 0; i < 4; i++) {
      const x = barStartX + i * (barW + barGap);
      const barH = maxBar > 0 ? (lastVals[i] / maxBar) * plotH : 0;
      const y = barBaseY - barH;

      // Bar fill
      ctx.fillStyle = this.colors[i];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y, barW, barH);
      ctx.globalAlpha = 1;

      // Bar border
      ctx.strokeStyle = this.colors[i];
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, barW, barH);

      // Label
      ctx.fillStyle = this.colors[i];
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.labels[i], x + barW / 2, barBaseY + 16);

      // Percentage
      const pct = fz > 0 ? ((lastVals[i] / fz) * 100).toFixed(0) : '0';
      ctx.fillStyle = '#aaa';
      ctx.font = '11px sans-serif';
      ctx.fillText(pct + '%', x + barW / 2, barBaseY + 30);
    }
    ctx.textAlign = 'left';

    // Title
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.fillText('Corner Forces', pad.left, pad.top - 10);

    // --- Right panel: Fz time series ---
    const tsX = pad.left + plotW * 0.5;
    const tsW = plotW * 0.5;

    ctx.fillStyle = '#555';
    ctx.font = '11px sans-serif';
    ctx.fillText('Total Force (Fz)', tsX + 4, pad.top - 10);

    ctx.strokeStyle = '#2a2d3a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= yTicks; i++) {
      const val = (i / yTicks) * maxBar;
      const y = barBaseY - (val / maxBar) * plotH;
      ctx.beginPath();
      ctx.moveTo(tsX, y);
      ctx.lineTo(tsX + tsW, y);
      ctx.stroke();
    }

    const n = this.fzHistory.length;
    if (n >= 2) {
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = tsX + (i / (this.historyLength - 1)) * tsW;
        const y = barBaseY - (this.fzHistory[i] / maxBar) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Fz value label
    ctx.fillStyle = '#a78bfa';
    ctx.font = 'bold 13px sans-serif';
    const fzDisplay = fz > 999 ? (fz / 1000).toFixed(1) + 'k' : fz.toFixed(0);
    ctx.fillText('Fz: ' + fzDisplay, tsX + 6, pad.top + 14);
  }

  clear() {
    this.history = [[], [], [], []];
    this.fzHistory = [];
    this.maxForce = 1000;
  }
}
