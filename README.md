# Balance Force Plate

A real-time balance assessment system using a 4-corner load cell force plate. Stand on the plate, perform a timed balance test, and track your postural stability with live Center of Pressure (COP) analysis, sway metrics, and a composite balance score.

## System Overview

```
4x RSL301 Load Cells --> ESP32 --Serial USB / WiFi TCP+UDP--> Local Server --WebSocket--> Browser Dashboard
 (4 corners, HX711)           (text posting lines)           (Node.js)       (port 8080)  (port 3000)
                                <-- start/stop/tare/cal ----------------------------------------
```

- **ESP32 Firmware** (C++/Arduino): Reads 4 RSL301 load cells via HX711 amplifiers at 40 Hz, streams calibrated gram values as text posting lines over USB Serial and WiFi (TCP for commands, UDP for data); handles tare, 2-point calibration, and EEPROM persistence
- **Processing Library** (`@force-plate/processing`, TypeScript): COP calculation, 2nd-order Butterworth low-pass filter, balance metrics (sway RMS, path length, velocity, stability area, max distance, range AP/ML), composite balance score
- **Local Server** (Node.js/TypeScript): Serial and WiFi bridge to the ESP32, HTTP API for session management, WebSocket server for real-time frame broadcast to the browser dashboard
- **Browser Dashboard** (single-file HTML/JS/CSS): Real-time stabilogram canvas, live force display, session recording with CSV export, CSV replay with server-side metric recomputation

---

## Languages Used

### C++ (Arduino Framework) — Firmware

**Location:** `firmware/src/`

All code that runs on the ESP32 microcontroller is written in C++ using the Arduino framework, built with PlatformIO. This includes:

- **`main.cpp`** (619 lines) — The main application: setup, event loop, command parser, posting loop, calibration wizard. Uses a non-blocking architecture where HX711 sensors are polled each loop pass via `readIfReady()` so WiFi/TCP background tasks get CPU time via `yield()`. Commands arrive from both Serial and WiFi TCP and are dispatched identically.
- **`hx711.h` / `hx711.cpp`** — Custom HX711 load cell amplifier driver. Implements the 24-bit bit-bang SPI protocol with interrupt-safe critical sections (`portDISABLE_INTERRUPTS`) to prevent clock violations. Supports 4-channel array reads, per-channel offsets, hardware-ready polling (`readIfReady`), connection detection with timeout, and hot-rescan.
- **`wifi_stream.h` / `wifi_stream.cpp`** — Hybrid WiFi transport layer. Runs a TCP server (port 8888) for bidirectional commands/status and sends high-frequency data via UDP (port 8889) to the connected client's IP. Includes mDNS advertisement as `force-plate.local`. TCP alone suffers from delayed-ACK stalls at 40 Hz; UDP eliminates this.
- **`config.h`** — All hardware constants: GPIO pin assignments, sample rate (40 Hz / 25000 us period), serial baud rate (115200), plate geometry (339.411 mm), HX711 timing parameters.

C++ was chosen because it's the standard for Arduino/ESP32 embedded development and provides the low-level GPIO control needed for the HX711 bit-bang protocol and microsecond-precision timing.

### TypeScript — Processing Pipeline & Server

**Location:** `packages/processing/src/` and `apps/local-server/src/`

All server-side and signal processing code is written in TypeScript, compiled to ES2022 JavaScript. TypeScript's static typing catches interface mismatches between the pipeline, server, and type definitions at compile time.

#### Processing Library (`packages/processing/src/`)

A pure computation library with no hardware dependencies:

- **`types.ts`** — All shared type definitions: `RawForceData`, `ProcessedFrame`, `BalanceMetrics`, `EllipseParams`, `PipelineConfig`, `Session`, `SessionState`. Also exports `DEFAULT_CONFIG` with production defaults.
- **`pipeline.ts`** — The main processing orchestrator. Accepts raw force samples, computes COP from 4 corner forces, applies Butterworth low-pass filtering, accumulates sliding window buffers, and triggers metric computation every N samples. Manages session lifecycle (start/stop) with warmup period suppression. Contains an inlined `SessionManager` class for session state tracking.
- **`metrics.ts`** — All balance metric computations: sway RMS, path length, sway velocity, centroid metrics (max distance, range AP/ML), 95% confidence ellipse (covariance eigendecomposition), and composite balance score (sigmoid-normalised weighted average).
- **`low-pass-filter.ts`** — 2nd-order Butterworth IIR filter using bilinear transform for coefficient computation and Direct Form II Transposed for streaming processing. Maintains filter state (z1, z2) across samples.
- **`csv-export.ts`** — Session export utilities: raw CSV (timestamp + 4 corner forces) and processed CSV (COP, filtered COP, forces, session state, metrics).
- **`serial-parser.ts`** — Parsing utilities for the ESP32 text protocol: `parseSerialLine()` for JSON data frames and `isStatusMessage()` for status detection.
- **`index.ts`** — Public API barrel export for all pipeline classes, metric functions, types, and config.

#### Local Server (`apps/local-server/src/`)

- **`index.ts`** — Express HTTP server (port 3000) + WebSocket server (port 8080). Provides REST API endpoints for connection management, session recording, CSV download, and CSV replay. Wires Serial/WiFi data handlers to the processing pipeline and broadcasts processed frames to all WebSocket clients. Implements robust startup retry logic (sends `d` command with exponential backoff until data flows).
- **`serial.ts`** — SerialPort wrapper using the `serialport` npm package with `ReadlineParser`. Parses the text posting format (`[<ms>ms] FL:<g>g FR:<g>g ...`) and status JSON (`[STATUS] {...}`). Provides the same callback interface (`setDataHandler`, `setStatusHandler`, `setRawLineHandler`, `setErrorHandler`) as the WiFi connection for uniform handling.
- **`wifi-connection.ts`** — TCP + UDP client for WiFi-connected ESP32. Resolves `.local` hostnames via OS DNS and raw mDNS multicast queries (with caching). Binds a UDP listener on port 8889 for high-frequency data, connects TCP on port 8888 for commands/status. Includes 5-second TCP connect timeout, robust UDP socket cleanup on reconnect, and a `closing` flag to prevent ghost callbacks during teardown.

TypeScript was chosen over plain JavaScript for type safety across the pipeline boundary (raw sensor data types flow through processing into WebSocket frames) and for catching interface drift between the server and processing library at build time.

### HTML / JavaScript / CSS — Dashboard

**Location:** `apps/local-server/public/index.html`

The entire dashboard is a single self-contained HTML file (~1300 lines) with inline `<style>` and `<script>` blocks. No build step, no framework, no bundler — edit and refresh.

- **HTML** — Semantic structure with 3 tabs (Live, Calibration, About). Uses a dark theme with CSS custom properties for consistent theming. The Live tab contains the connection controls, force display cards, stabilogram canvas, metrics sidebar, Chart.js force-over-time graph, session stats bar, and log panel.
- **JavaScript** — Vanilla ES2021+ with `'use strict'`. Manages WebSocket connection to port 8080, processes incoming frames (force clamping, COP clamping to plate boundaries), drives the stabilogram canvas renderer (cached background layer + real-time COP trail with opacity-banded segments + 95% confidence ellipse overlay), updates Chart.js, handles session recording/CSV replay, and manages UI state (connected/disconnected/recording/replay modes).
- **CSS** — Custom dark theme using CSS variables (`--bg`, `--text`, `--green`, `--fl`, etc.) with IBM Plex Sans/Mono font families. Responsive grid layout for metrics cards, flexbox for controls and stabilogram layout.
- **Chart.js** (external CDN) — Used for the force-over-time line chart (4 series, 600-sample rolling window, 100ms throttled updates).

A single-file approach was chosen to keep deployment trivial (the server just serves the `public/` directory) and to avoid build tool complexity for what is fundamentally a real-time data visualization page.

---

## Project Structure

```
BalanceForcePlate/
├── firmware/                          # ESP32 PlatformIO project (C++)
│   ├── platformio.ini                 # Build config: esp32dev, Arduino, 115200 baud
│   ├── .gitignore                     # Excludes .pio, .vscode build artifacts
│   └── src/
│       ├── main.cpp                   # Event loop, commands, posting, calibration wizard
│       ├── config.h                   # GPIO pins, sample rate, plate geometry, HX711 timing
│       ├── hx711.h / hx711.cpp        # HX711 4-channel driver (bit-bang, non-blocking, ISR-safe)
│       └── wifi_stream.h / .cpp       # WiFi TCP+UDP server, mDNS (optional, needs wifi_config.h)
│
├── packages/
│   └── processing/                    # @force-plate/processing (TypeScript library)
│       ├── package.json               # Dependencies: typescript, vitest
│       └── src/
│           ├── types.ts               # RawForceData, ProcessedFrame, BalanceMetrics, PipelineConfig
│           ├── pipeline.ts            # COP calculation -> filter -> metrics; session management
│           ├── metrics.ts             # Sway RMS, path length, velocity, ellipse, balance score
│           ├── low-pass-filter.ts     # 2nd-order Butterworth IIR (Direct Form II Transposed)
│           ├── csv-export.ts          # Raw + processed CSV export
│           ├── serial-parser.ts       # ESP32 JSON line parser
│           └── index.ts               # Public API exports
│
├── apps/
│   ├── local-server/                  # Node.js server + browser dashboard
│   │   ├── package.json               # Dependencies: express, serialport, ws, tsx
│   │   ├── src/
│   │   │   ├── index.ts               # HTTP API + WebSocket + pipeline orchestration
│   │   │   ├── serial.ts              # SerialPort wrapper (posting line parser)
│   │   │   └── wifi-connection.ts     # WiFi TCP+UDP client, mDNS resolver
│   │   └── public/
│   │       └── index.html             # Single-file dashboard (HTML + JS + CSS)
│   │
│   └── desktop/                       # Electron desktop app (Windows installer)
│       ├── package.json               # electron-builder config, NSIS installer settings
│       ├── electron-main.js           # Electron main process: starts server, opens window
│       ├── start.js                   # Dev launcher (handles VSCode ELECTRON_RUN_AS_NODE)
│       └── build/
│           └── icon.ico               # Application icon
│
├── .github/
│   └── workflows/
│       └── release.yml                # GitHub Actions: build .exe on tag push, publish release
│
├── package.json                       # pnpm workspace root (build, dev:local, dev:desktop scripts)
├── pnpm-workspace.yaml                # Workspace: packages/*, apps/*
├── tsconfig.base.json                 # Shared TS config: ES2022, strict, declaration maps
└── .gitignore                         # node_modules, dist, sessions, wifi_config.h, etc.
```

---

## Hardware Setup

### Force Plate Layout

```
  Front-Left (FL/f0)     Front-Right (FR/f1)
       *-------------------------*
       |                         |
       |         PLATE           |
       |                         |
       *-------------------------*
  Back-Left  (BL/f2)     Back-Right (BR/f3)
```

### Wiring: 4x HX711 Modules -> ESP32

Each HX711 requires two GPIO pins (DOUT and CLK).

| Corner        | HX711 DOUT | HX711 CLK | E+   | E-  |
|---------------|------------|-----------|------|-----|
| Front-Left    | GPIO 16    | GPIO 4    | 3.3V | GND |
| Front-Right   | GPIO 17    | GPIO 5    | 3.3V | GND |
| Back-Left     | GPIO 25    | GPIO 18   | 3.3V | GND |
| Back-Right    | GPIO 26    | GPIO 19   | 3.3V | GND |

- Connect each load cell's output wires to the HX711: **S+ -> A+**, **S- -> A-** (Channel A, 128x gain)
- HX711 RATE pin: tie **HIGH** for 80 SPS hardware rate (firmware samples at 40 Hz)
- **GPIO power**: 3.3V only — ESP32 GPIO is not 5V-tolerant
- **Load cell excitation**: HX711 E+/E- are independent of GPIO logic. Using 5V excitation (USB 5V rail to HX711 VCC) improves SNR by ~52% and is safe for the ESP32
- Plate dimensions: configurable in `firmware/src/config.h` (`PLATE_WIDTH_MM`, `PLATE_HEIGHT_MM`; default 339.411 mm)

### WiFi (optional)

```bash
cp firmware/src/wifi_config.h.example firmware/src/wifi_config.h
# Edit with your SSID and password
```

The ESP32 connects to WiFi, starts a TCP server on port 8888, streams data via UDP on port 8889, and advertises as `force-plate.local` via mDNS. The dashboard can connect via WiFi or Serial — the protocol is identical.

---

## Calibration

### Method

The firmware uses a 2-point calibration method with EEPROM persistence. Each load cell stores:
- **Offset** (raw ADC counts at zero load)
- **Scale factor** (counts per gram, averaged from two known weights)
- **Two-point flag** (whether both weights were used)

### Process

1. Enter two known weights (e.g. 500g and 1000g)
2. Remove all weight from the plate — system zeros all cells (20 samples averaged per cell)
3. For each cell: place weight 1, measure, place weight 2, measure
4. Scale factor = average of (raw/weight1) and (raw/weight2)
5. If the two scale factors differ by >5%, firmware warns of nonlinearity
6. All values saved to EEPROM (survives power cycles, wiped on reflash)

### EEPROM Layout (64 bytes)

| Address | Size | Content |
|---------|------|---------|
| 0       | 1    | Magic byte (0xAD) — invalidates on new flash |
| 1-40    | 40   | 4x CalData (10 bytes each: calibrated, scaleFactor, offset, twoPoint) |
| 41      | 1    | postingMode flag |

---

## Serial Protocol

### ESP32 -> Server (115200 baud)

**Posting line (40 Hz, calibrated grams):**
```
[12345ms] FL:123.45g FR:100.00g BL:80.00g BR:90.00g TOTAL:393.45g
```

**Status JSON:**
```
[STATUS] {"cells":[{"id":0,"name":"FL","connected":true,"calibrated":true,"twoPoint":true,"scale":1.2340,"offset":50000},...],postingMode":true}
```

**Calibration messages:**
```
[CAL] CALIBRATION SEQUENCE -- 2-point, all cells
[CAL:FL] STEP 2/3 -- Place WEIGHT 1 (500.0g) on FRONT-LEFT (corner 1).
[CAL:FL] DONE -- saved to EEPROM.
```

**Info messages:** `[INFO] ...`

### Server -> ESP32 (plain text commands)

| Command | Description |
|---------|-------------|
| `h`     | Show help |
| `s`     | Print status JSON |
| `d`     | Re-scan for connected load cells |
| `l`     | Print live calibrated values (grams) |
| `r`     | Print raw ADC values |
| `start` | Start continuous posting (calibrated grams) |
| `read`  | Start continuous posting (raw ADC) |
| `stop`  | Stop posting |
| `t`     | Tare all connected cells |
| `t1`-`t4` | Tare single cell (1=FL, 2=FR, 3=BL, 4=BR) |
| `c`     | Full 2-point calibration sequence |
| `x`     | Reset all calibration |
| `x1`-`x4` | Reset single cell calibration |

### Data rejection

The firmware and server both reject malformed samples:
- Any cell reading exactly 0g when total >50g (HX711 timeout, not a real measurement)
- Any NaN values in force cells

---

## Signal Processing

### 1. COP Calculation

From 4 corner forces:

```
Fz    = f0 + f1 + f2 + f3

COP_x = ((f1 + f3) - (f0 + f2)) / Fz  x  (plateWidth  / 2)   [mm, +right]
COP_y = ((f0 + f1) - (f2 + f3)) / Fz  x  (plateHeight / 2)   [mm, +front]
```

When total force < 100g (nobody on the plate), COP is frozen at the last valid position to prevent noise jitter.

### 2. Low-Pass Filter

2nd-order Butterworth filter (5-10 Hz cutoff, configurable) applied to COP_x and COP_y independently. Removes high-frequency noise while preserving natural sway dynamics (< 3 Hz). Implemented as Direct Form II Transposed with bilinear transform for coefficient computation.

### 3. Warmup Filtering

The first **500 ms** of every session are buffered but excluded from metrics. This removes the transient artifact when stepping onto the plate. Configurable via `warmupMs` in `PipelineConfig`.

### 4. Balance Metrics

All computed over a sliding window (10 seconds at 80 Hz / 400 samples at 40 Hz), updated at ~10 Hz:

| Metric | Formula | Units |
|--------|---------|-------|
| **Sway RMS** | sqrt(mean(COP_x^2 + COP_y^2)) | mm |
| **Sway Length** (Path Length) | sum of distances between consecutive COP points | mm |
| **Sway Velocity** | Path Length / window duration | mm/s |
| **Sway Area** (Stability Area) | pi x chi^2(0.95,2) x sqrt(lambda1 x lambda2) | mm^2 |
| **Max Distance** | Maximum COP distance from centroid | mm |
| **Range AP** | max(COP_y) - min(COP_y) | mm |
| **Range ML** | max(COP_x) - min(COP_x) | mm |

### 5. Composite Balance Score (0-100)

Three metrics are sigmoid-normalised and equally weighted:

```
normalised(metric) = 1 / (1 + exp((metric - center) / scale))
```

| Metric | Center | Scale |
|--------|--------|-------|
| Sway RMS | 10 mm | 6 mm |
| Sway Velocity | 20 mm/s | 12 mm/s |
| Stability Area | 500 mm^2 | 300 mm^2 |

```
Score = 100 x (norm(SwayRMS) + norm(SwayVelocity) + norm(StabilityArea)) / 3
```

Clamped to [0, 100]. Higher = better balance.

---

## Dashboard

### Live Tab

**Connection controls:** Serial port selector with refresh, WiFi hostname/IP input, connect/disconnect buttons. The server auto-sends `d` (rescan cells) with retry on connect, then auto-sends `start` when calibrated cells are detected.

**Force display:** 4 color-coded corner force cards (FL=blue, FR=green, BL=amber, BR=red) showing real-time grams, plus total force and sample rate.

**Stabilogram (canvas):** Real-time 2D COP trajectory visualization:
- Concentric reference circles at 50, 100, 150, 170 mm
- Plate boundary rectangle
- 95% confidence ellipse overlay (amber, updates live)
- 5-second COP trail with 8-band opacity gradient
- Corner force labels with live values
- Current COP position (green dot with glow)

**Metrics sidebar** (right of stabilogram):
- Balance Score (0-100, large green display)
- Sway Velocity (mm/s)
- Sway Length (mm)
- Sway RMS (mm)
- Sway Area (mm^2)
- Max Distance (mm) with AP and ML ranges

**Force chart:** Chart.js line graph of per-corner forces, rolling 600-sample window, 100ms throttled updates.

**Session controls:** Record/Stop, Tare All, Clear Chart, Reset View, Refresh Status, raw command input.

**CSV replay:** Load a previously saved CSV, server recomputes metrics via the pipeline, replays at original timing. During replay, live ESP data is suppressed to prevent interleaving.

### Calibration Tab

- 4-cell status grid showing connected/calibrated state, scale factor, offset
- Calibrate All / Reset All buttons
- Calibration log panel

### About Tab

- Serial protocol reference
- CSV format documentation
- Calibration method explanation

---

## HTTP API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/ports` | List available serial ports |
| POST | `/api/connect` | Connect to serial port `{ port, baudRate? }` |
| POST | `/api/connect-wifi` | Connect via WiFi `{ host, port? }` |
| POST | `/api/disconnect` | Disconnect from device |
| POST | `/api/session/start` | Start recording session |
| POST | `/api/session/stop` | Stop recording, save CSV |
| GET | `/api/sessions` | List saved sessions |
| GET | `/api/sessions/:id/csv` | Download session CSV |
| GET | `/api/sessions/:id/replay` | Replay session through pipeline |
| POST | `/api/replay/compute` | Process uploaded CSV (text/csv body) |
| POST | `/api/cmd` | Send raw command to device `{ cmd }` |
| POST | `/api/pipeline/reset` | Reset pipeline state |

### WebSocket (port 8080)

**Server -> Client:**
```json
{ "type": "frame",  "data": { /* ProcessedFrame */ } }
{ "type": "status", "data": { /* status object */ } }
{ "type": "raw",    "line": "..." }
```

**Client -> Server:**
```json
{ "type": "session_start" }
{ "type": "session_stop" }
```

---

## Desktop App (Windows Installer)

The dashboard is available as a standalone Windows desktop application. End users do not need Node.js, pnpm, or any development tools — just download the installer, install, and run.

### How It Works

The desktop app is an [Electron](https://www.electronjs.org/) wrapper around the existing local server and dashboard. When you launch the app:

1. Electron starts the Express HTTP server (port 3000) and WebSocket server (port 8080) inside its main process
2. A native window opens and loads the dashboard from `http://localhost:3000`
3. The dashboard works identically to the browser version — same UI, same features, same connection flow

No code changes were made to the server or dashboard. The Electron wrapper (`apps/desktop/electron-main.js`) is a thin ~80-line script that imports the compiled server module and opens a `BrowserWindow`.

### Installing the Desktop App on Windows

Follow these steps to install and run the Force Plate Dashboard on any Windows laptop or PC:

#### Step 1: Download the Installer

1. Go to the [GitHub Releases page](https://github.com/flauga/BalanceForcePlate/releases) in your web browser
2. Find the latest release (it will be at the top of the page, tagged as something like `v1.0.0`)
3. Under the **Assets** section of that release, click the `.exe` file to download it (the file will be named something like `Force Plate Dashboard Setup 1.0.0.exe`)
4. Save the file anywhere on your computer (e.g. your Downloads folder)

#### Step 2: Run the Installer

1. Double-click the downloaded `.exe` file to start the installer
2. **Windows SmartScreen warning:** Since the app is not code-signed, Windows will show a warning that says "Windows protected your PC" or "Unknown publisher." This is normal for open-source software that has not purchased a code signing certificate. To proceed:
   - Click **"More info"** (the text link, not the button)
   - Then click **"Run anyway"**
3. The NSIS installer wizard will open. Follow the steps:
   - **Choose Install Location:** You can accept the default location (usually `C:\Users\<YourName>\AppData\Local\Programs\Force Plate Dashboard`) or click Browse to choose a different folder
   - Click **Install** to begin the installation
   - Wait for the progress bar to complete
   - Click **Finish** to close the installer

#### Step 3: Launch the App

You can launch the Force Plate Dashboard in any of these ways:

- **Start Menu:** Click the Windows Start button, search for **"Force Plate Dashboard"**, and click it
- **Desktop shortcut:** If you chose to create a desktop shortcut during installation, double-click the icon on your desktop
- **Installation folder:** Navigate to the install location and double-click `Force Plate Dashboard.exe`

When the app starts, you will see a brief loading period while the internal server initializes, then the dashboard will appear in a native window.

#### Step 4: Connect to the ESP32

1. **Power on the ESP32** force plate. If using WiFi, make sure it is connected to the same network as your laptop. If using USB, plug in the USB cable.
2. **Serial (USB) connection:**
   - Click the **Refresh** button next to the serial port dropdown to scan for available ports
   - Select the correct COM port from the dropdown (it will be something like `COM3` or `COM4`)
   - Click **Connect**
3. **WiFi connection:**
   - In the WiFi host field, type the ESP32's IP address or hostname (e.g. `force-plate.local` or `192.168.1.100`)
   - Click **Connect WiFi**
4. Once connected, the dashboard will automatically detect calibrated load cells and begin streaming live force data at 40 Hz. You will see the stabilogram, force cards, and metrics update in real time.

#### Step 5: Use the Dashboard

The dashboard works exactly as described in the [Dashboard](#dashboard) section above:

- **View live balance data** on the stabilogram and metrics sidebar
- **Record sessions** by clicking Start Session, standing on the plate, then clicking Stop
- **Export CSV files** of recorded sessions for offline analysis
- **Replay previous sessions** by loading a saved CSV file
- **Calibrate the force plate** using the Calibration tab

### Uninstalling

To remove the Force Plate Dashboard from your computer:

1. Open **Windows Settings** > **Apps** > **Installed apps** (or **Apps & features** on older Windows versions)
2. Search for **"Force Plate Dashboard"**
3. Click the three-dot menu (or the app entry) and select **Uninstall**
4. Follow the uninstaller prompts

Alternatively, you can run the uninstaller directly from the installation folder (look for `Uninstall Force Plate Dashboard.exe`).

### Release Process (for developers)

The desktop app is built automatically by GitHub Actions when a version tag is pushed:

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers the `.github/workflows/release.yml` workflow, which:

1. Checks out the code on a `windows-latest` GitHub Actions runner
2. Installs pnpm and Node.js 22
3. Builds all TypeScript packages (`pnpm -r build`)
4. Creates a standalone server bundle using `pnpm deploy` (resolves workspace dependencies into real `node_modules/` with no symlinks)
5. Rebuilds the `@serialport/bindings-cpp` native module against Electron's Node.js headers using `@electron/rebuild`
6. Runs `electron-builder` to package everything into an NSIS Windows installer
7. Publishes the `.exe` installer to the GitHub Release for that tag

The installer is also uploaded as a GitHub Actions artifact for debugging.

### Desktop App Limitations

- **Windows only** — macOS and Linux support can be added later by extending the GitHub Actions workflow matrix
- **No code signing** — Windows SmartScreen will show an "Unknown publisher" warning on first run. This is cosmetic and does not affect functionality
- **No auto-update** — when a new version is released, users must manually download the new installer from GitHub Releases
- **Fixed ports** — the app uses ports 3000 (HTTP) and 8080 (WebSocket). If another application is using these ports, the server will fail to start
- **Internet required on first launch** — the dashboard loads Chart.js and Google Fonts from CDN. After the first load, the browser cache may serve them offline

---

## Getting Started

### Prerequisites

- [PlatformIO](https://platformio.org/) (firmware flashing)
- [Node.js 18+](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### 1. Flash the Firmware

```bash
cd firmware
pio run --target upload
```

On first boot (or after reflash), EEPROM is initialized fresh. Use the `c` command to run the 2-point calibration sequence.

### 2. Install & Build

```bash
pnpm install
pnpm build
```

### 3. Run the Dashboard

**Option A: Browser (development)**
```bash
pnpm dev:local
```
Open [http://localhost:3000](http://localhost:3000). Select your serial port or enter the ESP32's IP/hostname and click Connect.

**Option B: Desktop app (development)**
```bash
pnpm -r build
pnpm run bundle-server
pnpm dev:desktop
```
This launches the Electron desktop app pointing at the local server code. See [Desktop App](#desktop-app-windows-installer) for end-user installation.

**Option C: Desktop app (end user)**

Download the latest `.exe` installer from [GitHub Releases](https://github.com/flauga/BalanceForcePlate/releases) and follow the [installation guide](#installing-the-desktop-app-on-windows) above.

### 4. Record a Session

1. Connect to the ESP32 (Serial or WiFi)
2. Cells auto-detected and posting starts automatically if calibrated
3. Click **Start Session** — stand on the plate
4. Click **Stop** when done
5. Click **Save CSV** to download the recording

---

## Configuration

### Firmware (`firmware/src/config.h`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `SAMPLE_RATE_HZ` | 40 | Posting rate |
| `SERIAL_BAUD` | 115200 | Serial baud rate |
| `PLATE_WIDTH_MM` | 339.411 | Load cell X spacing |
| `PLATE_HEIGHT_MM` | 339.411 | Load cell Y spacing |
| `HX711_DOUT_0..3` | 16,17,25,26 | HX711 data pins |
| `HX711_CLK_0..3` | 4,5,18,19 | HX711 clock pins |

### Pipeline (`packages/processing/src/types.ts` -> `DEFAULT_CONFIG`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sampleRate` | 80 Hz | Match firmware rate (server overrides to 40) |
| `lpfCutoff` | 10 Hz | Butterworth LPF cutoff (server uses 5 Hz) |
| `metricsInterval` | 8 | Compute metrics every N samples (~10 Hz) |
| `metricsWindowSize` | 800 | Sliding window (10s at 80 Hz; server uses 400) |
| `warmupMs` | 500 | Step-on artifact discard |
| `plateWidth` | 339.411 mm | RSL301 corner spacing |
| `plateHeight` | 339.411 mm | RSL301 corner spacing |

---

## Development

### Firmware

```bash
cd firmware
pio run                    # Build
pio run --target upload    # Flash
pio device monitor         # Serial monitor (close before dashboard!)
```

WiFi config (`wifi_config.h`) is gitignored — copy from the `.example` template.

### Processing Library

```bash
pnpm --filter @force-plate/processing build
pnpm --filter @force-plate/processing test
```

Rebuild the library after changes before restarting the server (workspace dependency).

### Dashboard Server

```bash
pnpm dev:local
```

The `public/` directory is served statically — edit `index.html` and refresh the browser. No build step for frontend changes.

### Desktop App

```bash
pnpm -r build                          # Build TypeScript
pnpm run bundle-server                  # Create standalone server bundle
pnpm dev:desktop                        # Launch Electron app (dev mode)
pnpm dist:desktop                       # Build full .exe installer locally
```

The `bundle-server` script uses `pnpm deploy --legacy` to create a self-contained copy of the local server at `apps/desktop/server-bundle/` with all workspace dependencies resolved into real `node_modules/` (no symlinks). The Electron wrapper imports this bundle at runtime.

To release a new version:
```bash
git tag v1.0.0
git push origin v1.0.0
```
GitHub Actions will build and publish the `.exe` to the release automatically.

### Monorepo

- `pnpm-workspace.yaml` declares `packages/*` and `apps/*`
- `pnpm build` builds all packages
- Cross-package dependencies use `workspace:*` protocol

---

## Troubleshooting

### HX711 Not Reading

- Verify DOUT/CLK wiring matches `config.h` pin assignments
- RATE pin must be tied HIGH (not floating) for 80 SPS
- Load cell S+ -> HX711 A+, S- -> A- (Channel A only)
- HX711 E+/E- must be connected for bridge excitation
- Firmware times out after 200ms per cell (won't hang on disconnected sensor)

### WiFi Issues

- ESP32 supports **2.4 GHz only** (not 5 GHz)
- Check SSID/password in `wifi_config.h` (case-sensitive)
- mDNS (`force-plate.local`) may not resolve on all networks — use IP address as fallback
- Allow TCP 8888 and UDP 8889 through firewall
- Server retries `d` command up to 5 times with increasing delays on WiFi connect

### Serial Port Busy

- Close PlatformIO Serial Monitor before connecting via dashboard
- Only one application can use a serial port at a time
- On Windows, check Task Manager for orphaned `node.exe` processes

### Dashboard Not Showing Data

- Ensure cells are calibrated (run `c` command) — posting won't start without calibration
- The server auto-sends `start` when it detects calibrated cells
- Check the log panel at the bottom of the Live tab for error messages
- Try Reset View to clear stale state, or disconnect and reconnect

---

## Key References

- Prieto et al. (1996): *Measures of postural steadiness: differences between healthy young and elderly adults.* IEEE TBME
- Palmieri et al. (2002): *Center-of-pressure parameters used in the assessment of postural control.* J Sport Rehabil
- Duarte & Freitas (2010): *Revision of posturography based on force plate for balance evaluation.* Braz J Phys Ther
