/**
 * Balance Force Plate - Local Server
 *
 * Serves the dashboard on HTTP and bridges ESP32 data to the browser via WebSocket.
 * The dashboard drives everything: it connects to the ESP, starts/stops sessions.
 *
 * Input modes (mutually exclusive, all optional — can also connect via REST):
 *   <port>           USB serial,  e.g. COM3 or /dev/ttyUSB0
 *   --wifi           WiFi TCP, connects to force-plate.local:8888
 *   --wifi <host>    WiFi TCP, connects to <host>:8888
 *   --wifi-port <n>  Override TCP port (default 8888)
 *   --simulate       Simulated sway data (no hardware)
 *
 * HTTP API:
 *   GET  /                              → dashboard
 *   GET  /api/ports                     → list available serial ports
 *   POST /api/connect                   → { port, baudRate? } connect to serial port
 *   POST /api/disconnect                → disconnect from ESP
 *   POST /api/session/start             → start recording session (sends "start\n" to ESP)
 *   POST /api/session/stop              → stop recording session (sends "stop\n" to ESP)
 *   GET  /api/sessions                  → session list
 *   GET  /api/sessions/:id              → session JSON
 *   GET  /api/sessions/:id/csv/raw      → raw force plate CSV download
 *   GET  /api/sessions/:id/csv/processed → processed CSV download
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pipeline, Session, RawForceData } from '@force-plate/processing';
import { SerialConnection, SimulatedSerial } from './serial.js';
import { WifiConnection } from './wifi-connection.js';
import { WsBroadcaster } from './ws-server.js';
import { SessionStore } from './session-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Parse CLI args --------------------------------------------------------

const args = process.argv.slice(2);

const simulateMode = args.includes('--simulate');
const wifiFlag     = args.includes('--wifi');

const wifiIdx  = args.indexOf('--wifi');
const wifiHost = (wifiIdx !== -1 && args[wifiIdx + 1] && !args[wifiIdx + 1].startsWith('--'))
  ? args[wifiIdx + 1]
  : 'force-plate.local';

const wifiPortArg = args.find(a => a.startsWith('--wifi-port='));
const wifiPort    = wifiPortArg ? parseInt(wifiPortArg.split('=')[1], 10) : 8888;

const httpPort = parseInt(args.find(a => a.startsWith('--http-port='))?.split('=')[1] || '3000', 10);
const wsPort   = parseInt(args.find(a => a.startsWith('--ws-port='))?.split('=')[1]  || '8080', 10);

const serialPortArg = args.find(a => !a.startsWith('--')) || '';

// ---- Setup -----------------------------------------------------------------

async function main() {
  console.log('=== Balance Force Plate - Local Server ===\n');

  const store = new SessionStore();
  const ws    = new WsBroadcaster(wsPort);

  const pipeline = new Pipeline({}, (session: Session) => {
    console.log(`\n[Session] ${session.id}  ${session.duration.toFixed(1)}s  score ${session.finalMetrics.balanceScore.toFixed(1)}`);
    store.save(session);
    ws.broadcastSessionEnd(session);
  });

  const handleData = (data: RawForceData) => {
    const frame = pipeline.processSample(data);
    ws.broadcastFrame(frame);
  };

  // Active connections (only one at a time)
  let activeSerial: SerialConnection | null = null;
  let activeWifi: WifiConnection | null = null;
  let activeSim: SimulatedSerial | null = null;

  /** Send a raw command string to the connected ESP32 */
  function sendToESP(cmd: string): void {
    activeSerial?.write(cmd);
    activeWifi?.write(cmd);
  }

  function isConnected(): boolean {
    return !!(activeSerial?.isOpen() || activeWifi?.isConnected() || activeSim);
  }

  // ---- Pre-configured input mode (CLI args) --------------------------------

  if (simulateMode) {
    console.log('[Mode] Simulation (no hardware required)');
    const sim = new SimulatedSerial(40);
    sim.setDataHandler(handleData);
    sim.start();
    activeSim = sim;

  } else if (wifiFlag) {
    console.log(`[Mode] WiFi TCP  →  ${wifiHost}:${wifiPort}`);
    const wifi = new WifiConnection({ host: wifiHost, port: wifiPort });
    wifi.setDataHandler(handleData);
    wifi.setStatusHandler((s) => { console.log('[ESP32]', JSON.stringify(s)); ws.broadcastStatus(s); });
    wifi.setErrorHandler((e) => { console.error('[WiFi] Error:', e.message); });
    wifi.connect();
    activeWifi = wifi;

  } else if (serialPortArg) {
    console.log(`[Mode] Serial  →  ${serialPortArg}  @115200`);
    const serial = new SerialConnection({ path: serialPortArg, baudRate: 115200 });
    serial.setDataHandler(handleData);
    serial.setStatusHandler((s) => { console.log('[ESP32]', JSON.stringify(s)); ws.broadcastStatus(s); });
    serial.setErrorHandler((e) => { console.error('[Serial] Error:', e.message); });
    try {
      await serial.open();
      activeSerial = serial;
    } catch (err) {
      console.error(`[Serial] Failed to open ${serialPortArg}:`, (err as Error).message);
      process.exit(1);
    }

  } else {
    console.log('[Mode] Waiting for connection via dashboard or CLI.\n');
    console.log('  Dashboard:   http://localhost:' + httpPort);
    console.log('  CLI serial:  npm run dev -- <port>');
    console.log('  CLI WiFi:    npm run dev -- --wifi [host]');
    console.log('  CLI sim:     npm run dev -- --simulate\n');
  }

  // ---- HTTP server ---------------------------------------------------------

  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, '..', 'public')));

  // --- Connection management ------------------------------------------------

  /** GET /api/ports — list available serial ports */
  app.get('/api/ports', async (_req, res) => {
    try {
      const ports = await SerialConnection.listPorts();
      res.json(ports);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** POST /api/connect — connect to a serial port */
  app.post('/api/connect', async (req, res) => {
    const { port, baudRate = 115200 } = req.body as { port: string; baudRate?: number };
    if (!port) { res.status(400).json({ error: 'port required' }); return; }

    // Close any existing connection
    if (activeSerial) { await activeSerial.close(); activeSerial = null; }
    if (activeWifi)   { activeWifi.close(); activeWifi = null; }
    if (activeSim)    { activeSim.stop(); activeSim = null; }

    const serial = new SerialConnection({ path: port, baudRate });
    serial.setDataHandler(handleData);
    serial.setStatusHandler((s) => {
      console.log('[ESP32]', JSON.stringify(s));
      ws.broadcastStatus(s);
    });
    serial.setErrorHandler((e) => {
      console.error('[Serial] Error:', e.message);
      ws.broadcastStatus({ status: 'serial_error', message: e.message });
    });

    try {
      await serial.open();
      activeSerial = serial;
      console.log(`[Serial] Opened ${port} @${baudRate}`);
      ws.broadcastStatus({ status: 'connected', port, baudRate });
      res.json({ ok: true, port, baudRate });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  /** POST /api/disconnect — disconnect from ESP */
  app.post('/api/disconnect', async (_req, res) => {
    if (activeSerial) { await activeSerial.close(); activeSerial = null; }
    if (activeWifi)   { activeWifi.close(); activeWifi = null; }
    if (activeSim)    { activeSim.stop(); activeSim = null; }
    ws.broadcastStatus({ status: 'disconnected' });
    res.json({ ok: true });
  });

  // --- Session control ------------------------------------------------------

  /** POST /api/session/start — start a recording session */
  app.post('/api/session/start', (_req, res) => {
    if (pipeline.getSessionState() === 'active') {
      res.status(409).json({ error: 'Session already active' });
      return;
    }
    sendToESP('start\n');
    pipeline.startSession(Date.now());
    ws.broadcastStatus({ status: 'session_started' });
    console.log('[Session] Started');
    res.json({ ok: true });
  });

  /** POST /api/session/stop — stop the current recording session */
  app.post('/api/session/stop', (_req, res) => {
    if (pipeline.getSessionState() !== 'active') {
      res.status(409).json({ error: 'No active session' });
      return;
    }
    sendToESP('stop\n');
    pipeline.stopSession();
    ws.broadcastStatus({ status: 'session_stopped' });
    console.log('[Session] Stopped');
    res.json({ ok: true });
  });

  // --- Session data ---------------------------------------------------------

  app.get('/api/sessions', (_req, res) => {
    res.json(store.list());
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = store.load(req.params.id);
    if (!session) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ...session, _csvFiles: store.csvFiles(req.params.id) });
  });

  app.get('/api/sessions/:id/csv/raw', (req, res) => {
    const csv = store.loadCSV(req.params.id, 'raw');
    if (!csv) { res.status(404).json({ error: 'Raw CSV not found' }); return; }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-raw.csv"`);
    res.send(csv);
  });

  app.get('/api/sessions/:id/csv/processed', (req, res) => {
    const csv = store.loadCSV(req.params.id, 'processed');
    if (!csv) { res.status(404).json({ error: 'Processed CSV not found' }); return; }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-processed.csv"`);
    res.send(csv);
  });

  app.listen(httpPort, () => {
    console.log(`\n[HTTP] Dashboard:  http://localhost:${httpPort}`);
    console.log(`[WS]   Data feed:  ws://localhost:${wsPort}\n`);
  });
}

main().catch(console.error);
