# Balance Force Plate

A research-grade balance assessment system using a 4-corner load cell force plate. Stand on the plate, perform a timed balance test, and track your postural stability over time with real-time Center of Pressure (COP) analysis and a composite balance score.

## System Overview

```
4× HX711 Load Cells ──> ESP32 ──USB Serial / WiFi TCP──> Local Server ──WebSocket──> Browser Dashboard
 (4 corners)                     (JSON Lines)             (Node.js)
                                   ← start/stop ──────────────────────────────────────────
```

- **ESP32 Firmware**: Reads 4 HX711 load cell amplifiers at 40 Hz, streams JSON Lines over USB Serial or WiFi TCP; responds to `start`/`stop` commands
- **Processing Library** (`@force-plate/processing`): TypeScript — COP calculation, Butterworth LPF, 7 posturography metrics, composite balance score
- **Local Dashboard**: Node.js serial bridge + WebSocket server, browser dashboard with real-time COP trajectory and force distribution charts
- **Session control**: Start/Stop buttons on the dashboard drive when data is recorded; warmup filter discards the first 2 s of each session (removes step-on artifact)

---

## Project Structure

```
BalanceForcePlate/
├── firmware/                          # ESP32 PlatformIO project
│   └── src/
│       ├── main.cpp                   # 40 Hz sample loop; start/stop command listener
│       ├── hx711.h / hx711.cpp        # HX711 load cell driver (4-channel array)
│       └── config.h                   # HX711 GPIO pins, sample rate, plate dimensions
│
├── packages/
│   └── processing/                    # @force-plate/processing (shared TypeScript)
│       └── src/
│           ├── types.ts               # RawForceData, ProcessedFrame, PipelineConfig
│           ├── low-pass-filter.ts     # 2nd-order Butterworth LPF
│           ├── serial-parser.ts       # JSON Lines parser for ESP32 serial stream
│           ├── pipeline.ts            # COP calculation → filter → metrics; manual session control
│           ├── metrics/
│           │   ├── sway.ts            # COP RMS, path length, velocity (mm, mm/s)
│           │   ├── stability-area.ts  # 95% confidence ellipse area (mm²)
│           │   ├── frequency.ts       # FFT, band power, dominant/mean frequency (Hz)
│           │   ├── jerk.ts            # COP velocity derivative (smoothness, mm/s³)
│           │   ├── time-in-zone.ts    # % time COP is within stability radius (mm)
│           │   └── balance-score.ts   # Composite weighted score (0-100, sigmoid-normalised)
│           └── session/
│               └── session-manager.ts # Session lifecycle: start, accumulate, end
│
├── apps/
│   └── local-server/                  # Node.js serial bridge + dashboard server
│       ├── src/
│       │   ├── index.ts              # Entry: serial/WiFi/simulate → pipeline → HTTP + WebSocket
│       │   ├── serial.ts             # SerialPort wrapper + SimulatedSerial (dev mode)
│       │   ├── wifi-connection.ts    # WiFi TCP connection handler
│       │   ├── ws-server.ts          # WebSocket broadcaster (frames + session events)
│       │   └── session-store.ts      # Local JSON file storage
│       └── public/                   # Vanilla JS dashboard (no build step needed)
│           ├── index.html            # Dashboard layout
│           ├── dashboard.js          # WebSocket client + connection/session control
│           ├── charts.js             # COP trajectory chart + force distribution chart
│           └── style.css             # Dark theme UI
│
├── package.json                       # pnpm workspace root
└── pnpm-workspace.yaml
```

---

## Hardware Setup

### Force Plate Layout

```
  Front-Left (f0)        Front-Right (f1)
       ●─────────────────────●
       │                     │
       │       PLATE         │
       │                     │
       ●─────────────────────●
  Back-Left  (f2)        Back-Right (f3)
```

### Wiring: 4× HX711 Modules → ESP32

Each HX711 requires two GPIO pins (DATA/DOUT and CLK/PD_SCK).

| Corner      | HX711 DOUT | HX711 CLK | E+  | E-  |
|-------------|-----------|-----------|-----|-----|
| Front-Left  | GPIO 16   | GPIO 4    | 3.3V | GND |
| Front-Right | GPIO 17   | GPIO 5    | 3.3V | GND |
| Back-Left   | GPIO 25   | GPIO 18   | 3.3V | GND |
| Back-Right  | GPIO 26   | GPIO 19   | 3.3V | GND |

- Connect each load cell's output wires (typically E+, E−, S+, S−) to the corresponding HX711 module
- HX711 RATE pin: tie **HIGH** for 80 SPS hardware rate (firmware samples at 40 Hz)
- Power: 3.3V (do **not** use 5V — ESP32 GPIO is not 5V-tolerant)
- Plate dimensions are configurable in `firmware/src/config.h` (`PLATE_WIDTH_MM`, `PLATE_HEIGHT_MM`; default 500 mm × 500 mm)

### WiFi (optional)

```
cp firmware/src/wifi_config.h.example firmware/src/wifi_config.h
# Edit wifi_config.h with your SSID and password
```

The ESP32 will start a TCP server on port 8888 and advertise itself as `force-plate.local` via mDNS.

---

## Serial Protocol

**ESP32 → Laptop** (JSON Lines, 115200 baud)

```jsonc
// Data frame (40 Hz when streaming)
{"t":12345,"f0":50230,"f1":49870,"f2":51100,"f3":50400}

// Status messages
{"status":"ready","sensor":"hx711","rate":40}
{"status":"streaming"}
{"status":"idle"}
```

Fields: `t` = timestamp ms (ESP millis), `f0`–`f3` = raw HX711 ADC counts after tare.

**Laptop → ESP32** (plain text commands)

```
start\n   →  begin streaming data frames
stop\n    →  pause streaming
```

---

## Signal Processing

### 1. COP Calculation

From 4 corner forces the Center of Pressure is:

```
Fz   = f0 + f1 + f2 + f3

COP_x = ((f1 + f3) − (f0 + f2)) / Fz  ×  (plateWidth  / 2)   [mm, +right]
COP_y = ((f0 + f1) − (f2 + f3)) / Fz  ×  (plateHeight / 2)   [mm, +front]
```

### 2. Low-Pass Filter

2nd-order Butterworth filter (5 Hz cutoff) applied to COP_x and COP_y independently. Removes high-frequency noise while preserving natural sway (< 3 Hz).

### 3. Warmup Filtering

The first **2 seconds** of every session are buffered but excluded from metrics computation. This removes the transient artifact that occurs when the subject steps onto the plate. Configurable via `warmupMs` in `PipelineConfig`.

### 4. Balance Metrics (7)

All computed over a 10-second sliding window, updated at 10 Hz:

| Metric | Formula | Units |
|--------|---------|-------|
| **Sway RMS** | √(mean(COP_x² + COP_y²)) | mm |
| **Path Length** | Σ√(ΔX² + ΔY²) | mm |
| **Sway Velocity** | Path Length / window duration | mm/s |
| **Stability Area** | π × χ²(0.95,2) × √(λ₁λ₂) | mm² |
| **Frequency Features** | FFT of √(COP_x² + COP_y²) | Hz |
| **Jerk RMS** | RMS(d²COP/dt²) — smoothness of corrections | mm/s³ |
| **Time in Zone** | Fraction of time \|COP\| < threshold (10mm) | % |

### 5. Composite Balance Score

Weighted sigmoid normalisation across 5 metrics (0–100, higher = better):

| Metric | Weight | Normalisation center |
|--------|--------|---------------------|
| Sway RMS | 25% | 10 mm |
| Time in Zone | 25% | — (already 0–1) |
| Sway Velocity | 20% | 20 mm/s |
| Stability Area | 20% | 500 mm² |
| Jerk RMS | 10% | 1000 mm/s³ |

---

## Getting Started

### Prerequisites

- [PlatformIO](https://platformio.org/) (for firmware flashing)
- [Node.js 18+](https://nodejs.org/) and [pnpm](https://pnpm.io/)

### 1. Flash the Firmware

```bash
cd firmware
pio run --target upload
```

On first boot the ESP32 tares all load cells (plate must be **empty** during boot).

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Build the Processing Library

```bash
pnpm --filter @force-plate/processing build
```

### 4. Run the Dashboard

```bash
# USB serial (replace /dev/ttyUSB0 with your port)
pnpm --filter local-server dev -- /dev/ttyUSB0

# WiFi TCP
pnpm --filter local-server dev -- --wifi force-plate.local

# No hardware (simulated force plate data)
pnpm --filter local-server dev -- --simulate
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 5. Using the Dashboard

1. **Connect to ESP32**: Select the serial port from the dropdown and click **Connect** (or use WiFi fields). The ESP status indicator turns green when the connection is established.
2. **Start a session**: Stand on the plate and click **▶ Start Session**. The ESP begins streaming; the first 2 seconds are discarded (warmup filter).
3. **Stop the session**: Click **■ Stop Session**. A session row appears in the history table with CSV download links.
4. **Download data**: Click `raw.csv` (raw HX711 counts, 40 Hz) or `processed.csv` (COP + metrics time series).

---

## Configuration

Key parameters in `packages/processing/src/types.ts` → `DEFAULT_CONFIG`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sampleRate` | 40 Hz | Match firmware `SAMPLE_RATE_HZ` |
| `lpfCutoff` | 5 Hz | Butterworth LPF cutoff |
| `stabilityThreshold` | 10 mm | Time-in-Zone radius |
| `warmupMs` | 2000 ms | Step-on artifact discard |
| `plateWidth` | 500 mm | Load cell X separation |
| `plateHeight` | 500 mm | Load cell Y separation |

---

## Key References

- Prieto et al. (1996): *Measures of postural steadiness: differences between healthy young and elderly adults.* IEEE TBME
- Palmieri et al. (2002): *Center-of-pressure parameters used in the assessment of postural control.* J Sport Rehabil
- Duarte & Freitas (2010): *Revision of posturography based on force plate for balance evaluation.* Braz J Phys Ther
- Collins & De Luca (1993): *Open-loop and closed-loop control of posture: a random-walk analysis.* Exp Brain Res
- Hogan & Sternad (2009): *Sensitivity of smoothness measures to movement duration, amplitude, and arrests.* J Motor Behav
