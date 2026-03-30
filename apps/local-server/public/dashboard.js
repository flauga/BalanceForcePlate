/**
 * Dashboard controller: connects to WebSocket and drives UI updates.
 */

// Initialize charts
const swayChart = new SwayChart('sway-canvas');
const timeSeriesChart = new TimeSeriesChart('timeseries-canvas');

// DOM references
const statusEl = document.getElementById('connection-status');
const scoreEl  = document.getElementById('balance-score');
const timerEl  = document.getElementById('session-timer');
const stateEl  = document.getElementById('session-state');
const esp32El  = document.getElementById('esp32-status');

const metricEls = {
  swayRMS:    document.getElementById('metric-sway-rms'),
  pathLength: document.getElementById('metric-path-length'),
  velocity:   document.getElementById('metric-velocity'),
  area:       document.getElementById('metric-area'),
  jerk:       document.getElementById('metric-jerk'),
  tiz:        document.getElementById('metric-tiz'),
  freq:       document.getElementById('metric-freq'),
};

// Session timing
let sessionStartTime = null;
let timerInterval    = null;

// WebSocket connection
let ws = null;
let reconnectTimeout = null;
const WS_URL = `ws://${window.location.hostname}:8080`;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status connected';
  };

  ws.onclose = () => {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status disconnected';
    reconnectTimeout = setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.warn('[WS] Parse error:', e);
    }
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'frame':        handleFrame(msg.data);      break;
    case 'session_end':  handleSessionEnd(msg.data); break;
    case 'status':       handleStatus(msg.data);     break;
  }
}

function handleStatus(s) {
  if (!esp32El) return;
  // Show meaningful status badges for WiFi / serial events
  const labels = {
    ready:               '✓ ESP32 ready',
    wifi_connected:      `✓ WiFi  ${s.ip ?? ''}`,
    wifi_connecting:     '… WiFi connecting',
    wifi_timeout:        '✗ WiFi timeout',
    wifi_client_connected:   '✓ TCP connected',
    wifi_tcp_connected:  '✓ TCP connected',
    wifi_tcp_disconnected: '… TCP reconnecting',
  };
  esp32El.textContent = labels[s.status] ?? `ESP32: ${s.status}`;
}

// Frame counter for chart throttling (~30fps)
let frameCount = 0;

function handleFrame(frame) {
  frameCount++;
  if (frameCount % 3 === 0) {
    swayChart.addPoint(frame.rollFiltered, frame.pitchFiltered);
    timeSeriesChart.addPoint(frame.rollFiltered, frame.pitchFiltered);
    swayChart.draw();
    timeSeriesChart.draw();
  }

  updateSessionState(frame.sessionState);
  if (frame.metrics) updateMetrics(frame.metrics);
}

function updateSessionState(state) {
  stateEl.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  stateEl.className = 'state-value ' + state;

  if (state === 'active' && !sessionStartTime) {
    sessionStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);
    swayChart.clear();
    timeSeriesChart.clear();
  } else if (state === 'idle') {
    sessionStartTime = null;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
}

function updateTimer() {
  if (!sessionStartTime) return;
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function updateMetrics(m) {
  scoreEl.textContent = m.balanceScore.toFixed(0);
  metricEls.swayRMS.textContent    = m.swayRMS.toFixed(2);
  metricEls.pathLength.textContent = m.pathLength.toFixed(1);
  metricEls.velocity.textContent   = m.swayVelocity.toFixed(2);
  metricEls.area.textContent       = m.stabilityArea.toFixed(1);
  metricEls.jerk.textContent       = m.jerkRMS.toFixed(0);
  metricEls.tiz.textContent        = (m.timeInZone * 100).toFixed(0);
  metricEls.freq.textContent       = m.frequencyFeatures.dominantFrequency.toFixed(2);

  const score = m.balanceScore;
  scoreEl.style.color = score >= 70 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171';
}

function handleSessionEnd(session) {
  sessionStartTime = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  addSessionRow(session, true);
}

/** Render one session row with CSV download links. */
function addSessionRow(session, isNew = false) {
  const tbody = document.getElementById('session-tbody');
  const row   = document.createElement('tr');

  const date     = new Date(session.startTime).toLocaleString();
  const mins     = Math.floor(session.duration / 60);
  const secs     = Math.floor(session.duration % 60).toString().padStart(2, '0');
  const duration = `${mins}:${secs}`;
  const score    = session.finalMetrics.balanceScore.toFixed(0);
  const id       = session.id;

  // CSV links — available immediately for new sessions, checked from _csvFiles for loaded history
  const hasRaw  = isNew || session._csvFiles?.raw;
  const hasProc = isNew || session._csvFiles?.processed;

  const rawLink  = hasRaw
    ? `<a href="/api/sessions/${id}/csv/raw"       download title="Raw 100Hz IMU data">raw.csv</a>`
    : '<span style="color:#555">—</span>';
  const procLink = hasProc
    ? `<a href="/api/sessions/${id}/csv/processed" download title="Orientation + metrics time series">processed.csv</a>`
    : '<span style="color:#555">—</span>';

  row.innerHTML = `
    <td>${date}</td>
    <td>${duration}</td>
    <td>${score}</td>
    <td>${rawLink}</td>
    <td>${procLink}</td>
  `;

  tbody.insertBefore(row, tbody.firstChild);
}

/** Load history from API on page load. */
async function loadHistory() {
  try {
    const res      = await fetch('/api/sessions');
    const sessions = await res.json();
    // Load details for each to get _csvFiles flags
    await Promise.all(sessions.map(async (s) => {
      try {
        const detail = await fetch(`/api/sessions/${s.id}`).then(r => r.json());
        addSessionRow({
          id: s.id,
          startTime: s.startTime,
          duration: s.duration,
          finalMetrics: { balanceScore: s.score },
          _csvFiles: detail._csvFiles ?? {},
        });
      } catch {
        // Fallback: show row without CSV links
        addSessionRow({ id: s.id, startTime: s.startTime, duration: s.duration, finalMetrics: { balanceScore: s.score } });
      }
    }));
  } catch (e) {
    console.log('[History] Could not load:', e.message);
  }
}

// Initialize
connect();
loadHistory();
swayChart.draw();
timeSeriesChart.draw();
