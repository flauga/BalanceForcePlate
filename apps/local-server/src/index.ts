import express from 'express';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { SerialConnection, RawForceData } from './serial.js';
import { WifiConnection } from './wifi-connection.js';
import { Pipeline, DEFAULT_CONFIG } from '@force-plate/processing';

const HTTP_PORT  = 3000;
const WS_PORT    = 8080;
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.text({ type: 'text/csv', limit: '50mb' }));
app.use(express.static(path.join(process.cwd(), 'public')));

const pipeline = new Pipeline({ sampleRate: 40, lpfCutoff: 5, metricsInterval: 8, metricsWindowSize: 400 });

// ---------------------------------------------------------------------------
// WebSocket broadcaster
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[WS] Listening on ws://localhost:${WS_PORT}`);

let onClientMessage: ((msg: unknown) => void) | undefined;

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try { onClientMessage?.(JSON.parse(raw.toString())); } catch { /* ignore */ }
  });
});

function wsSend(payload: unknown) {
  const msg = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

const ws = {
  broadcastFrame:   (frame: Record<string, unknown>) => wsSend({ type: 'frame', data: frame }),
  broadcastStatus:  (status: unknown)                => wsSend({ type: 'status', data: status }),
  broadcastRawLine: (line: string)                   => wsSend({ type: 'raw', line }),
  setMessageHandler: (handler: (msg: unknown) => void) => { onClientMessage = handler; },
};

// ---------------------------------------------------------------------------
// Recording state
// ---------------------------------------------------------------------------
interface CsvRow {
  timestamp: string; elapsed_s: string;
  fl_g: string; fr_g: string; bl_g: string; br_g: string; total_g: string;
  cop_x_mm: string; cop_y_mm: string;
}

let recording    = false;
let sessionStart = 0;
let csvRows: CsvRow[] = [];
let sessionId: string | null = null;

let activeSerial: SerialConnection | null = null;
let activeWifi:   WifiConnection   | null = null;

type ConnType = 'serial' | 'wifi' | null;
let connType: ConnType = null;

function activeConnection(): SerialConnection | WifiConnection | null {
  return activeSerial ?? activeWifi;
}

function sendToDevice(cmd: string): void {
  activeSerial?.write(cmd);
  activeWifi?.write(cmd);
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------
function startSession(): void {
  csvRows = [];
  sessionStart = Date.now();
  sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  recording = true;
  pipeline.startSession(sessionStart);
  ws.broadcastStatus({ status: 'recording' });
}

function stopSession(): { sessionId: string; samples: number } | null {
  recording = false;
  pipeline.stopSession();
  if (!csvRows.length || !sessionId) {
    pipeline.reset();
    return null;
  }
  const header = 'timestamp,elapsed_s,fl_g,fr_g,bl_g,br_g,total_g,cop_x_mm,cop_y_mm\n';
  const rows = csvRows.map(r =>
    `${r.timestamp},${r.elapsed_s},${r.fl_g},${r.fr_g},${r.bl_g},${r.br_g},${r.total_g},${r.cop_x_mm},${r.cop_y_mm}`
  ).join('\n');
  const filePath = path.join(SESSIONS_DIR, `${sessionId}.csv`);
  fs.writeFileSync(filePath, header + rows);
  console.log(`[Session] Saved ${csvRows.length} samples → ${filePath}`);
  ws.broadcastStatus({ status: 'idle' });
  const result = { sessionId: sessionId!, samples: csvRows.length };
  sessionId = null;
  csvRows = [];
  pipeline.reset();
  return result;
}

// ---------------------------------------------------------------------------
// Shared connection handler wiring
// ---------------------------------------------------------------------------
/** Track whether we've received data (posting active) after a connect. */
let receivedFirstData = false;

function wireHandlers(
  conn: SerialConnection | WifiConnection,
  label: string,
  onDisconnect: () => void,
): void {
  conn.setDataHandler((data: RawForceData) => {
    receivedFirstData = true;
    const frame = pipeline.processSample({
      t: data.t, f0: data.fl, f1: data.fr, f2: data.bl, f3: data.br,
    });
    ws.broadcastFrame(frame as unknown as Record<string, unknown>);
    if (recording && sessionStart) {
      const elapsed = (Date.now() - sessionStart) / 1000;
      csvRows.push({
        timestamp: new Date().toISOString(),
        elapsed_s: elapsed.toFixed(3),
        fl_g: data.fl.toFixed(2), fr_g: data.fr.toFixed(2),
        bl_g: data.bl.toFixed(2), br_g: data.br.toFixed(2),
        total_g: data.total.toFixed(2),
        cop_x_mm: frame.copXFiltered.toFixed(2),
        cop_y_mm: frame.copYFiltered.toFixed(2),
      });
    }
  });

  conn.setStatusHandler((s) => {
    ws.broadcastStatus(s);
    const status = s as Record<string, unknown>;
    if (typeof status.plate_width_mm === 'number' && typeof status.plate_height_mm === 'number') {
      pipeline.setPlateGeometry({
        plateWidthMm:  status.plate_width_mm,
        plateHeightMm: status.plate_height_mm,
      });
    }
    // Auto-start posting when firmware reports calibrated cells but posting is off.
    // This covers WiFi reconnect and the initial 'd' rescan after connect.
    if (Array.isArray(status.cells) && status.postingMode === false) {
      const cells = status.cells as Array<Record<string, unknown>>;
      const allCalibrated = cells.length > 0 && cells.every(
        c => !c.connected || c.calibrated
      );
      const anyConnected = cells.some(c => c.connected);
      if (anyConnected && allCalibrated) {
        console.log(`[${label}] Auto-sending 'start' — cells calibrated, posting was off`);
        conn.write('start\n');
      }
    }
  });

  conn.setRawLineHandler((line: string) => {
    // Parse WiFi status JSON emitted by firmware (e.g. wifi_connected, wifi_client_connected)
    if (line.startsWith('{')) {
      try {
        const j = JSON.parse(line) as Record<string, unknown>;
        if (typeof j.status === 'string') ws.broadcastStatus(j);
        return;
      } catch { /* not JSON */ }
    }
    ws.broadcastRawLine(line);
  });

  conn.setErrorHandler((err) => {
    console.error(`[${label}]`, err.message);
    ws.broadcastStatus({ status: 'disconnected', reason: err.message });
    onDisconnect();
    pipeline.reset();
  });
}

// ---------------------------------------------------------------------------
// Serial helpers
// ---------------------------------------------------------------------------
function openSerial(port: string, baudRate: number): Promise<void> {
  if (activeSerial) { activeSerial.close(); activeSerial = null; }
  if (activeWifi)   { activeWifi.close();   activeWifi   = null; }

  const conn = new SerialConnection({ path: port, baudRate });
  wireHandlers(conn, 'Serial', () => { activeSerial = null; connType = null; });

  return conn.open().then(() => {
    activeSerial = conn;
    connType = 'serial';
    receivedFirstData = false;

    // Robust startup: send 'd' (rescan cells) repeatedly until we get data.
    const delays = [500, 1200, 2500];
    delays.forEach((ms, i) => {
      setTimeout(() => {
        if (conn !== activeSerial) return;
        if (receivedFirstData) return;
        console.log(`[Serial] Sending 'd' (attempt ${i + 1}/${delays.length})`);
        conn.write('d\n');
      }, ms);
    });
  });
}

// ---------------------------------------------------------------------------
// WiFi helpers
// ---------------------------------------------------------------------------
function openWifi(host: string, port = 8888): Promise<void> {
  if (activeSerial) { activeSerial.close(); activeSerial = null; }
  if (activeWifi)   { activeWifi.close();   activeWifi   = null; }

  const conn = new WifiConnection({ host, port });
  wireHandlers(conn, 'WiFi', () => { activeWifi = null; connType = null; });

  return conn.open().then(() => {
    activeWifi = conn;
    connType = 'wifi';
    receivedFirstData = false;

    // Robust startup: send 'd' (rescan cells) repeatedly until we get data.
    // The status reply from 'd' triggers auto-start in the status handler.
    // Retry up to 5 times at increasing intervals in case the first command
    // is lost or the ESP hasn't finished its client-connect handshake yet.
    const delays = [300, 800, 1500, 2500, 4000];
    delays.forEach((ms, i) => {
      setTimeout(() => {
        if (conn !== activeWifi) return;  // connection was replaced
        if (receivedFirstData) return;    // already streaming — no need to retry
        console.log(`[WiFi] Sending 'd' (attempt ${i + 1}/${delays.length})`);
        conn.write('d\n');
      }, ms);
    });
  });
}

// ---------------------------------------------------------------------------
// WS inbound commands
// ---------------------------------------------------------------------------
ws.setMessageHandler((msg: unknown) => {
  const m = msg as Record<string, unknown>;
  if (m?.type === 'session_start') { if (activeConnection()) startSession(); }
  else if (m?.type === 'session_stop') { stopSession(); }
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.get('/api/ports', async (_req, res) => {
  const ports = await SerialConnection.listPorts();
  res.json(ports.map(p => ({ path: p.path, manufacturer: p.manufacturer })));
});

app.post('/api/connect', async (req, res) => {
  const { port, baudRate = 115200 } = req.body as { port: string; baudRate?: number };
  if (!port) { res.status(400).json({ error: 'port required' }); return; }
  try {
    await openSerial(port, baudRate);
    ws.broadcastStatus({ status: 'connected', port, connType: 'serial' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/connect-wifi', async (req, res) => {
  const { host, port = 8888 } = req.body as { host: string; port?: number };
  if (!host) { res.status(400).json({ error: 'host required' }); return; }
  try {
    await openWifi(host, port);
    ws.broadcastStatus({ status: 'connected', host, connType: 'wifi' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/disconnect', (_req, res) => {
  if (activeSerial) { activeSerial.close(); activeSerial = null; }
  if (activeWifi)   { activeWifi.close();   activeWifi   = null; }
  connType = null;
  pipeline.reset();
  ws.broadcastStatus({ status: 'disconnected' });
  res.json({ ok: true });
});

app.post('/api/pipeline/reset', (_req, res) => {
  pipeline.reset();
  res.json({ ok: true });
});

app.post('/api/session/start', (_req, res) => {
  if (!activeConnection()) { res.status(400).json({ error: 'not connected' }); return; }
  startSession();
  res.json({ ok: true });
});

app.post('/api/session/stop', (_req, res) => {
  const result = stopSession();
  if (!result) { res.status(400).json({ error: 'no data' }); return; }
  res.json(result);
});

app.get('/api/sessions/:id/csv', (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.csv`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'not found' }); return; }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.csv"`);
  res.sendFile(filePath);
});

app.get('/api/sessions', (_req, res) => {
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.csv'));
  const list = files.map(f => ({
    id: f.replace('.csv', ''),
    mtime: fs.statSync(path.join(SESSIONS_DIR, f)).mtime,
  }));
  res.json(list.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()));
});

app.get('/api/sessions/:id/replay', (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${req.params.id}.csv`);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'not found' }); return; }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').slice(1); // skip header
  const p = new Pipeline(DEFAULT_CONFIG);
  p.startSession(Date.now());
  const SAMPLE_DT = 1000 / DEFAULT_CONFIG.sampleRate;
  const frames = lines.map((line, i) => {
    const cols = line.split(',');
    const fl = parseFloat(cols[2]), fr = parseFloat(cols[3]);
    const bl = parseFloat(cols[4]), br = parseFloat(cols[5]);
    return p.processSample({ t: i * SAMPLE_DT, f0: fl, f1: fr, f2: bl, f3: br });
  });
  res.json(frames);
});

// Accept CSV text, run through pipeline, return frames with computed metrics.
app.post('/api/replay/compute', (req, res) => {
  const csvText = req.body as string;
  if (!csvText || typeof csvText !== 'string') { res.status(400).json({ error: 'csv body required' }); return; }
  const lines = csvText.trim().split('\n').slice(1); // skip header
  const p = new Pipeline({ sampleRate: 40, lpfCutoff: 5, metricsInterval: 8 });
  p.startSession(Date.now());
  const SAMPLE_DT = 1000 / 40;
  const frames = lines.map((line, i) => {
    const cols = line.split(',');
    const fl = parseFloat(cols[2]), fr = parseFloat(cols[3]);
    const bl = parseFloat(cols[4]), br = parseFloat(cols[5]);
    if (isNaN(fl) || isNaN(fr) || isNaN(bl) || isNaN(br)) return null;
    return p.processSample({ t: i * SAMPLE_DT, f0: fl, f1: fr, f2: bl, f3: br });
  }).filter(Boolean);
  res.json(frames);
});

app.post('/api/cmd', (req, res) => {
  const { cmd } = req.body as { cmd: string };
  if (!activeConnection()) { res.status(400).json({ error: 'not connected' }); return; }
  sendToDevice(cmd + '\n');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Dashboard at http://localhost:${HTTP_PORT}`);
});

export {};
