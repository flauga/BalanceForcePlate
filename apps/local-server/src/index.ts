import express from 'express';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { SerialConnection, RawForceData } from './serial.js';
import { Pipeline } from '@force-plate/processing';

const HTTP_PORT  = 3000;
const WS_PORT    = 8080;
const SESSIONS_DIR = path.join(process.cwd(), 'sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

const pipeline = new Pipeline({ sampleRate: 40, lpfCutoff: 10.0 });

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
// Serial helpers
// ---------------------------------------------------------------------------
function openSerial(port: string, baudRate: number): Promise<void> {
  if (activeSerial) { activeSerial.close(); activeSerial = null; }

  const conn = new SerialConnection({ path: port, baudRate });

  conn.setDataHandler((data: RawForceData) => {
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
  });

  conn.setRawLineHandler((line: string) => ws.broadcastRawLine(line));

  conn.setErrorHandler((err) => {
    console.error('[Serial]', err.message);
    ws.broadcastStatus({ status: 'disconnected', reason: err.message });
    activeSerial = null;
    pipeline.reset();
  });

  return conn.open().then(() => { activeSerial = conn; });
}

// ---------------------------------------------------------------------------
// WS inbound commands
// ---------------------------------------------------------------------------
ws.setMessageHandler((msg: unknown) => {
  const m = msg as Record<string, unknown>;
  if (m?.type === 'session_start') { if (activeSerial) startSession(); }
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
    ws.broadcastStatus({ status: 'connected', port });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/disconnect', (_req, res) => {
  if (activeSerial) { activeSerial.close(); activeSerial = null; }
  pipeline.reset();
  ws.broadcastStatus({ status: 'disconnected' });
  res.json({ ok: true });
});

app.post('/api/session/start', (_req, res) => {
  if (!activeSerial) { res.status(400).json({ error: 'not connected' }); return; }
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

app.post('/api/cmd', (req, res) => {
  const { cmd } = req.body as { cmd: string };
  if (!activeSerial) { res.status(400).json({ error: 'not connected' }); return; }
  activeSerial.write(cmd + '\n');
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(HTTP_PORT, () => {
  console.log(`[HTTP] Dashboard at http://localhost:${HTTP_PORT}`);
});

export {};
