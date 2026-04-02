/**
 * Dashboard controller: handles ESP connection, session control, and real-time display.
 */

// ---- Charts ----------------------------------------------------------------
const swayChart  = new SwayChart('sway-canvas');
const forceChart = new ForceDistributionChart('force-canvas');

// ---- DOM refs --------------------------------------------------------------
const wsStatusEl    = document.getElementById('ws-status');
const espStatusEl   = document.getElementById('esp-status');
const scoreEl       = document.getElementById('balance-score');
const timerEl       = document.getElementById('session-timer');
const stateEl       = document.getElementById('session-state');
const startBtn      = document.getElementById('start-btn');
const stopBtn       = document.getElementById('stop-btn');
const connectBtn    = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const wifiConnectBtn= document.getElementById('wifi-connect-btn');
const portSelect    = document.getElementById('port-select');
const baudInput     = document.getElementById('baud-input');
const wifiHostInput = document.getElementById('wifi-host');
const wifiPortInput = document.getElementById('wifi-port');
const refreshBtn    = document.getElementById('refresh-ports-btn');

const metricEls = {
  swayRMS:    document.getElementById('metric-sway-rms'),
  pathLength: document.getElementById('metric-path-length'),
  velocity:   document.getElementById('metric-velocity'),
  area:       document.getElementById('metric-area'),
  jerk:       document.getElementById('metric-jerk'),
  tiz:        document.getElementById('metric-tiz'),
  freq:       document.getElementById('metric-freq'),
};

// ---- New DOM refs (loadcells panel) ----------------------------------------
const loadcellsCountEl  = document.getElementById('loadcells-count');
const loadcellsSimEl    = document.getElementById('loadcells-sim-status');
const runSampleBtn      = document.getElementById('run-sample-btn');
const loadcellValuesEl  = document.getElementById('loadcell-values');
const lcValEls          = [0, 1, 2, 3].map(i => document.getElementById(`lc-val-${i}`));

// ---- State -----------------------------------------------------------------
let sessionStartTime        = null;
let timerInterval           = null;
let espConnected            = false;
let loadcellsConnectedCount = null;   // null = unknown; 0 = none wired
let sampleRunning           = false;

// ---- WebSocket connection to local server ----------------------------------
let ws = null;
let reconnectTimeout = null;
const WS_URL = `ws://${window.location.hostname}:8080`;

function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    wsStatusEl.textContent = 'Server connected';
    wsStatusEl.className = 'status connected';
  };

  ws.onclose = () => {
    wsStatusEl.textContent = 'Server disconnected';
    wsStatusEl.className = 'status disconnected';
    reconnectTimeout = setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (e) {
      console.warn('[WS] Parse error:', e);
    }
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'frame':            handleFrame(msg.data);           break;
    case 'session_end':      handleSessionEnd(msg.data);      break;
    case 'status':           handleStatus(msg.data);          break;
    case 'loadcells_values': handleLoadcellValues(msg.data);  break;
  }
}

// ---- ESP status messages ---------------------------------------------------
function handleStatus(s) {
  const labels = {
    ready:                   '✓ ESP ready',
    streaming:               '● Streaming',
    idle:                    '○ Idle',
    initializing:            '… Initializing',
    connected:               '✓ Connected',
    disconnected:            'Not connected',
    serial_error:            '✗ Serial error',
    session_started:         '● Session active',
    session_stopped:         '○ Session stopped',
    wifi_connected:          `✓ WiFi  ${s.ip ?? ''}`,
    wifi_connecting:         '… WiFi connecting',
    wifi_timeout:            '✗ WiFi timeout',
    wifi_tcp_connected:      '✓ TCP connected',
    wifi_tcp_disconnected:   '… TCP reconnecting',
    loadcells_sample_started: null,   // handled below
    loadcells_sample_done:    null,
  };

  if (s.status === 'connected') {
    espConnected = true;
    setESPConnected(true);
  } else if (s.status === 'disconnected') {
    espConnected = false;
    setESPConnected(false);
  } else if (s.status === 'loadcells_state') {
    updateLoadcellsState(s.connected_count, s.channel_count);
    return;
  } else if (s.status === 'loadcells_sample_started') {
    sampleRunning = true;
    runSampleBtn.disabled = true;
    loadcellsSimEl.textContent = '⚡ Simulation running…';
    swayChart.clear();
    forceChart.clear();
    swayChart.draw();
    forceChart.draw();
    return;
  } else if (s.status === 'loadcells_sample_done') {
    sampleRunning = false;
    runSampleBtn.disabled = false;
    loadcellsSimEl.textContent = '✓ Sample complete';
    return;
  }

  const label = labels[s.status];
  if (label !== null && label !== undefined) {
    espStatusEl.textContent = label;
  } else {
    espStatusEl.textContent = `ESP: ${s.status}`;
  }
}

// ---- Load cell state -------------------------------------------------------
function updateLoadcellsState(connected, total) {
  loadcellsConnectedCount = connected;
  loadcellsCountEl.textContent = `${connected}/${total}`;
  loadcellsCountEl.style.color = connected > 0 ? '#4ade80' : '#f87171';

  // Show Run Sample button only when no cells are wired
  runSampleBtn.style.display = connected === 0 ? 'inline-flex' : 'none';

  if (connected > 0) {
    loadcellsSimEl.textContent = '';
    loadcellValuesEl.style.display = 'none';
  }
}

// ---- Load cell values (from real streaming or simulation) ------------------
function handleLoadcellValues(d) {
  loadcellValuesEl.style.display = 'flex';
  d.values.forEach((v, i) => {
    if (lcValEls[i]) lcValEls[i].textContent = Math.round(v).toLocaleString();
  });
}

// ---- Frame handling --------------------------------------------------------
let frameCount = 0;

function handleFrame(frame) {
  // Suppress real frames when no cells are wired and no simulation is running
  if (loadcellsConnectedCount === 0 && !sampleRunning) return;

  frameCount++;

  // Update force distribution chart every frame
  forceChart.addReading(frame.f0, frame.f1, frame.f2, frame.f3);

  // Throttle COP chart to ~30fps
  if (frameCount % 2 === 0) {
    swayChart.addPoint(frame.copXFiltered, frame.copYFiltered);
    swayChart.draw();
    forceChart.draw();
  }

  if (frame.sessionState === 'active' && !sessionStartTime) {
    sessionStartTime = Date.now();
    timerInterval = setInterval(updateTimer, 100);
  }

  if (frame.metrics) updateMetrics(frame.metrics);
}

// ---- Session timer ---------------------------------------------------------
function updateTimer() {
  if (!sessionStartTime) return;
  const elapsed = (Date.now() - sessionStartTime) / 1000;
  const mins = Math.floor(elapsed / 60);
  const secs = Math.floor(elapsed % 60);
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ---- Metrics display -------------------------------------------------------
function updateMetrics(m) {
  scoreEl.textContent = m.balanceScore.toFixed(0);
  const score = m.balanceScore;
  scoreEl.style.color = score >= 70 ? '#4ade80' : score >= 40 ? '#fbbf24' : '#f87171';

  metricEls.swayRMS.textContent    = m.swayRMS.toFixed(1);
  metricEls.pathLength.textContent = m.pathLength.toFixed(0);
  metricEls.velocity.textContent   = m.swayVelocity.toFixed(1);
  metricEls.area.textContent       = m.stabilityArea.toFixed(0);
  metricEls.jerk.textContent       = m.jerkRMS.toFixed(0);
  metricEls.tiz.textContent        = (m.timeInZone * 100).toFixed(0);
  metricEls.freq.textContent       = m.frequencyFeatures.dominantFrequency.toFixed(2);
}

// ---- Session end -----------------------------------------------------------
function handleSessionEnd(session) {
  sessionStartTime = null;
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerEl.textContent = '0:00';
  setSessionActive(false);
  addSessionRow(session, true);
}

// ---- Connection panel logic ------------------------------------------------
function setESPConnected(connected) {
  espConnected = connected;
  connectBtn.disabled    =  connected;
  disconnectBtn.disabled = !connected;
  wifiConnectBtn.disabled = connected;
  startBtn.disabled = !connected;
  if (!connected) {
    stopBtn.disabled = true;
    setSessionActive(false);
  }
}

function setSessionActive(active) {
  startBtn.disabled = active || !espConnected;
  stopBtn.disabled  = !active;
  stateEl.textContent = active ? 'Active' : 'Idle';
  stateEl.className = 'state-value ' + (active ? 'active' : 'idle');
  if (!active) {
    sessionStartTime = null;
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }
}

// Refresh available serial ports
async function refreshPorts() {
  try {
    const ports = await fetch('/api/ports').then(r => r.json());
    const current = portSelect.value;
    portSelect.innerHTML = '<option value="">— select port —</option>';
    ports.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.path;
      opt.textContent = p.path + (p.manufacturer ? ` (${p.manufacturer})` : '');
      portSelect.appendChild(opt);
    });
    if (current) portSelect.value = current;
  } catch (e) {
    console.warn('[Ports] Failed to list:', e);
  }
}

// Connect via serial
connectBtn.addEventListener('click', async () => {
  const port = portSelect.value;
  if (!port) { alert('Select a serial port first.'); return; }
  const baudRate = parseInt(baudInput.value, 10) || 115200;
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting…';
  try {
    const res = await fetch('/api/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port, baudRate }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Connect failed');
    // Status update will come via WebSocket
  } catch (e) {
    alert('Connection failed: ' + e.message);
    connectBtn.disabled = false;
  } finally {
    connectBtn.textContent = 'Connect';
  }
});

// Disconnect
disconnectBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/disconnect', { method: 'POST' });
  } catch (e) {
    console.warn('Disconnect error:', e);
  }
});

// Connect via WiFi
wifiConnectBtn.addEventListener('click', async () => {
  const host = wifiHostInput.value.trim();
  if (!host) { alert('Enter a host/IP for the WiFi connection.'); return; }
  // WiFi connection requires server restart — inform user
  alert('WiFi connection requires starting the server with:\n  npm run dev -- --wifi ' + host + '\n\nRestart the server with that argument.');
});

// Refresh ports on page load and on button click
refreshBtn.addEventListener('click', refreshPorts);
refreshPorts();

// ---- Session Start / Stop --------------------------------------------------
startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  try {
    const res = await fetch('/api/session/start', { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || 'Start failed');
    }
    setSessionActive(true);
    swayChart.clear();
    forceChart.clear();
    swayChart.draw();
    forceChart.draw();
  } catch (e) {
    alert('Could not start session: ' + e.message);
    startBtn.disabled = false;
  }
});

stopBtn.addEventListener('click', async () => {
  stopBtn.disabled = true;
  try {
    const res = await fetch('/api/session/stop', { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error || 'Stop failed');
    }
    setSessionActive(false);
  } catch (e) {
    alert('Could not stop session: ' + e.message);
    stopBtn.disabled = false;
  }
});

// ---- Session history -------------------------------------------------------
function addSessionRow(session, isNew = false) {
  const tbody = document.getElementById('session-tbody');
  const row   = document.createElement('tr');

  const date     = new Date(session.startTime).toLocaleString();
  const mins     = Math.floor(session.duration / 60);
  const secs     = Math.floor(session.duration % 60).toString().padStart(2, '0');
  const duration = `${mins}:${secs}`;
  const score    = session.finalMetrics.balanceScore.toFixed(0);
  const id       = session.id;

  const hasRaw  = isNew || session._csvFiles?.raw;
  const hasProc = isNew || session._csvFiles?.processed;

  const rawLink  = hasRaw
    ? `<a href="/api/sessions/${id}/csv/raw"       download title="Raw force plate data (40Hz)">raw.csv</a>`
    : '<span style="color:#555">—</span>';
  const procLink = hasProc
    ? `<a href="/api/sessions/${id}/csv/processed" download title="COP + metrics time series">processed.csv</a>`
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

async function loadHistory() {
  try {
    const sessions = await fetch('/api/sessions').then(r => r.json());
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
        addSessionRow({ id: s.id, startTime: s.startTime, duration: s.duration, finalMetrics: { balanceScore: s.score } });
      }
    }));
  } catch (e) {
    console.log('[History] Could not load:', e.message);
  }
}

// ---- Run Sample button -----------------------------------------------------
runSampleBtn.addEventListener('click', () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'command',
    data: { action: 'run_loadcell_sample', channel_count: 4 },
  }));
});

// ---- Initialize ------------------------------------------------------------
connectWS();
loadHistory();
swayChart.draw();
forceChart.draw();
