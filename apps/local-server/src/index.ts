/**
 * Local server entry point.
 *
 * Input modes (mutually exclusive):
 *   <port>           USB serial,  e.g. COM3 or /dev/ttyUSB0
 *   --wifi           WiFi TCP, connects to imu-balance.local:8888
 *   --wifi <host>    WiFi TCP, connects to <host>:8888
 *   --wifi-port <n>  Override TCP port (default 8888)
 *   --simulate       Simulated sway data (no hardware)
 *
 * HTTP:
 *   GET  /              → dashboard
 *   GET  /api/sessions  → session list
 *   GET  /api/sessions/:id          → session JSON
 *   GET  /api/sessions/:id/csv/raw       → raw IMU CSV download
 *   GET  /api/sessions/:id/csv/processed → processed CSV download
 */

import express from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Pipeline, Session, RawIMUData } from '@imu-balance/processing';
import { SerialConnection, SimulatedSerial } from './serial.js';
import { WifiConnection } from './wifi-connection.js';
import { WsBroadcaster } from './ws-server.js';
import { SessionStore } from './session-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Parse CLI args --------------------------------------------------------

const args = process.argv.slice(2);

const simulateMode = args.includes('--simulate');
const wifiFlag     = args.includes('--wifi');

// --wifi [optional-host] — host is the arg immediately after --wifi, if not another flag
const wifiIdx   = args.indexOf('--wifi');
const wifiHost  = (wifiIdx !== -1 && args[wifiIdx + 1] && !args[wifiIdx + 1].startsWith('--'))
  ? args[wifiIdx + 1]
  : 'imu-balance.local';

const wifiPortArg = args.find(a => a.startsWith('--wifi-port='));
const wifiPort    = wifiPortArg ? parseInt(wifiPortArg.split('=')[1], 10) : 8888;

const httpPort = parseInt(args.find(a => a.startsWith('--http-port='))?.split('=')[1] || '3000', 10);
const wsPort   = parseInt(args.find(a => a.startsWith('--ws-port='))?.split('=')[1]  || '8080', 10);

// Serial port is any non-flag positional arg
const serialPort = args.find(a => !a.startsWith('--')) || '';

// ---- Setup -----------------------------------------------------------------

async function main() {
  console.log('=== IMU Balance Board - Local Server ===\n');

  const store = new SessionStore();
  const ws    = new WsBroadcaster(wsPort);

  const pipeline = new Pipeline({}, (session: Session) => {
    console.log(`\n[Session] ${session.id}  ${session.duration.toFixed(1)}s  score ${session.finalMetrics.balanceScore.toFixed(1)}`);
    store.save(session);
    ws.broadcastSessionEnd(session);
  });

  const handleData = (data: RawIMUData) => {
    const frame = pipeline.processSample(data);
    ws.broadcastFrame(frame);
  };

  // ---- Choose input mode ---------------------------------------------------

  if (simulateMode) {
    console.log('[Mode] Simulation (no hardware required)');
    const sim = new SimulatedSerial(100);
    sim.setDataHandler(handleData);
    sim.start();

  } else if (wifiFlag) {
    console.log(`[Mode] WiFi TCP  →  ${wifiHost}:${wifiPort}`);
    console.log('       (mDNS may take a few seconds to resolve)\n');
    const wifi = new WifiConnection({ host: wifiHost, port: wifiPort });
    wifi.setDataHandler(handleData);
    wifi.setStatusHandler((s) => { console.log('[ESP32]', JSON.stringify(s)); ws.broadcastStatus(s); });
    wifi.setErrorHandler((e) => { console.error('[WiFi] Error:', e.message); });
    wifi.connect();

  } else {
    // Serial mode
    if (!serialPort) {
      console.log('Available serial ports:');
      const ports = await SerialConnection.listPorts();
      ports.length
        ? ports.forEach(p => console.log(`  ${p.path}${p.manufacturer ? ` (${p.manufacturer})` : ''}`))
        : console.log('  (none found)');
      console.log('\nUsage:');
      console.log('  npm run dev -- <port>           # USB serial');
      console.log('  npm run dev -- --wifi            # WiFi (imu-balance.local)');
      console.log('  npm run dev -- --wifi <host/ip>  # WiFi (custom host)');
      console.log('  npm run dev -- --simulate        # no hardware');
      process.exit(1);
    }

    console.log(`[Mode] Serial  →  ${serialPort}  @460800`);
    const serial = new SerialConnection({ path: serialPort, baudRate: 460800 });
    serial.setDataHandler(handleData);
    serial.setStatusHandler((s) => { console.log('[ESP32]', JSON.stringify(s)); ws.broadcastStatus(s); });
    serial.setErrorHandler((e) => { console.error('[Serial] Error:', e.message); });
    try {
      await serial.open();
    } catch (err) {
      console.error(`[Serial] Failed to open ${serialPort}:`, (err as Error).message);
      process.exit(1);
    }
  }

  // ---- HTTP server ---------------------------------------------------------

  const app = express();
  app.use(express.static(join(__dirname, '..', 'public')));

  // Session list
  app.get('/api/sessions', (_req, res) => {
    res.json(store.list());
  });

  // Session JSON
  app.get('/api/sessions/:id', (req, res) => {
    const session = store.load(req.params.id);
    if (!session) { res.status(404).json({ error: 'Not found' }); return; }
    // Include CSV availability flags for the dashboard
    res.json({ ...session, _csvFiles: store.csvFiles(req.params.id) });
  });

  // Raw IMU CSV download
  app.get('/api/sessions/:id/csv/raw', (req, res) => {
    const csv = store.loadCSV(req.params.id, 'raw');
    if (!csv) { res.status(404).json({ error: 'Raw CSV not found' }); return; }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}-raw.csv"`);
    res.send(csv);
  });

  // Processed CSV download
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
