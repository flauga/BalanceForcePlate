# Balance Force Plate

A research-grade balance assessment system using a 4-corner load cell force plate. Stand on the plate, perform a timed balance test, and track your postural stability over time with real-time Center of Pressure (COP) analysis and a composite balance score.

## System Overview

```
4× RSL301 Load Cells ──> ESP32 ──Serial / WiFi TCP / BT SPP──> Local Server ──WebSocket──> Browser Dashboard
 (4 corners, HX711)              (JSON Lines)                   (Node.js)
                                   ← start/stop ───────────────────────────────────────────
```

- **ESP32 Firmware**: Reads 4 RSL301 load cells (via HX711 amplifiers) at 40 Hz, streams JSON Lines over USB Serial, WiFi TCP, or Bluetooth Classic SPP; responds to `start`/`stop`/`tare`/`calibrate` commands
- **Processing Library** (`@force-plate/processing`): TypeScript — COP calculation, Butterworth LPF, 7 posturography metrics, composite balance score
- **Local Dashboard**: Node.js serial bridge + WebSocket server, browser dashboard with real-time COP trajectory, force distribution, frequency spectrum, force asymmetry, and session comparison
- **Session control**: Start/Stop buttons on the dashboard drive when data is recorded; warmup filter discards the first 2 s of each session (removes step-on artifact)

---

## Project Structure

```
BalanceForcePlate/
├── firmware/                          # ESP32 PlatformIO project
│   └── src/
│       ├── main.cpp                   # 40 Hz sample loop; start/stop/tare/calibrate commands
│       ├── hx711.h / hx711.cpp        # HX711 load cell driver (4-channel array, timeout + ISR-safe)
│       ├── calibration.h / .cpp       # Persistent calibration via ESP32 NVS (tare offsets + scale factors)
│       ├── config.h                   # HX711 GPIO pins, sample rate, plate dimensions, calibration bounds
│       ├── wifi_stream.h / .cpp       # WiFi TCP server + mDNS (optional, needs wifi_config.h)
│       ├── bt_stream.h / .cpp         # Bluetooth Classic SPP server (optional, needs bt_config.h)
│       ├── wifi_config.h.example      # WiFi credentials template
│       ├── bt_config.h.example        # Bluetooth config template
│       └── loadcell_config.h.example  # Load cell count override template
│
├── packages/
│   └── processing/                    # @force-plate/processing (shared TypeScript)
│       └── src/
│           ├── types.ts               # RawForceData, ProcessedFrame, PipelineConfig, EllipseParams
│           ├── low-pass-filter.ts     # 2nd-order Butterworth LPF
│           ├── serial-parser.ts       # JSON Lines parser for ESP32 serial stream
│           ├── pipeline.ts            # COP calculation → filter → metrics; manual session control
│           ├── metrics/
│           │   ├── sway.ts            # COP RMS, path length, velocity (mm, mm/s)
│           │   ├── stability-area.ts  # 95% confidence ellipse area + params (mm²)
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
│       │   ├── index.ts              # Entry: serial/WiFi → pipeline → HTTP + WebSocket
│       │   ├── serial.ts             # SerialPort wrapper
│       │   ├── wifi-connection.ts    # WiFi TCP connection handler
│       │   ├── ws-server.ts          # WebSocket broadcaster (frames + session events)
│       │   ├── session-store.ts      # Local JSON file storage
│       │   └── loadcell-sample-simulator.ts  # Synthetic data for testing without hardware
│       └── public/                   # Vanilla JS dashboard (no build step needed)
│           ├── index.html            # Dashboard layout
│           ├── dashboard.js          # WebSocket client + connection/session control
│           ├── charts.js             # COP trajectory + force distribution + ellipse overlay
│           ├── spectrum-chart.js     # Frequency band power visualization
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

| Corner        | HX711 DOUT  | HX711 CLK   | E+   | E-  |
|-------------  |-----------  |-----------  |----- |-----|
| Front-Left -1 | GPIO 16-Rx2 | GPIO 4-D4   | 3.3V | GND |
| Front-Right-2 | GPIO 17-Tx2 | GPIO 5-D5  | 3.3V | GND |
| Back-Left  -3 | GPIO 25-D25 | GPIO 18-D18 | 3.3V | GND |
| Back-Right -4 | GPIO 26-D26 | GPIO 19-D19 | 3.3V | GND |

- Connect each load cell's output wires to the HX711 module: **S+ → A+**, **S- → A-** (Channel A differential input at 128× gain)
- HX711 E+ and E- provide excitation to the load cell bridge
- HX711 RATE pin: tie **HIGH** for 80 SPS hardware rate (firmware samples at 40 Hz)
- **GPIO power**: 3.3V (do **not** use 5V — ESP32 GPIO is not 5V-tolerant)
- **Load cell excitation**: The HX711 E+/E- are independent of GPIO logic levels. Using 5V excitation (from USB 5V rail to HX711 VCC) improves SNR by ~52% and is safe for the ESP32. The 3.3V warning applies only to the DOUT/CLK GPIO connections.
- Plate dimensions are configurable in `firmware/src/config.h` (`PLATE_WIDTH_MM`, `PLATE_HEIGHT_MM`; default 339.411 mm — RSL301 corner spacing)
- The firmware broadcasts `plate_geometry` on boot and periodically, so the processing pipeline automatically uses the correct dimensions for COP scaling

### Hardware Assembly

- **Physical mounting**: RSL301 half-bridge load cells must be mounted between two rigid plates (aluminum or plywood) so they are under compression when loaded. Secure each cell with M5 bolts through the RSL301 mounting holes.
- **Corner spacing**: Measure the actual center-to-center distance between mounting points and update `PLATE_WIDTH_MM` and `PLATE_HEIGHT_MM` in `config.h` if different from the default 339.411 mm.
- **Wiring**: Each RSL301 has 3 wires: E+ (excitation), S+ (signal+), S- (signal-). Connect S+ to HX711 A+, S- to HX711 A-. Connect E+ to HX711 E+, and the remaining wire to GND/E-.

### WiFi (optional)

```
cp firmware/src/wifi_config.h.example firmware/src/wifi_config.h
# Edit wifi_config.h with your SSID and password
```

The ESP32 will start a TCP server on port 8888 and advertise itself as `force-plate.local` via mDNS.

### Bluetooth Classic (optional)

```
cp firmware/src/bt_config.h.example firmware/src/bt_config.h
# Optionally edit BT_DEVICE_NAME (default: "BALANCE_PLATE")
```

After flashing, the ESP32 advertises as `BALANCE_PLATE_XXXX` (where `XXXX` is a unique 4-char hex suffix derived from the chip MAC address).

**Windows pairing:**

1. Open **Settings → Bluetooth & devices → Add device → Bluetooth**
2. Pair with `BALANCE_PLATE_XXXX`
3. Windows creates a virtual COM port (check **Device Manager → Ports (COM & LPT)** for the port number)
4. In the dashboard, select that COM port from the **Serial / Bluetooth COM Port** dropdown and click **Connect**

The JSON Lines protocol is identical across USB Serial, WiFi TCP, and Bluetooth SPP — the dashboard works the same way regardless of transport.

---

## Calibration

### How It Works

The firmware uses ESP32 NVS (Non-Volatile Storage) to persist calibration data across reboots. Each of the 4 load cells stores:
- **Tare offset** (raw ADC counts at zero load)
- **Scale factor** (counts-per-gram, default 1.0 = raw mode)
- **Timestamp** of last calibration

### Boot Behavior

On every reboot, the firmware:
1. Attempts to load saved calibration from NVS
2. Validates the data (checksum, bounds checks on offsets and scale factors)
3. If valid: injects saved offsets — **instant boot, no tare needed**
4. If invalid/missing: performs a live tare (plate must be unloaded), saves the result
5. Broadcasts a `calibration_state` JSON message with all 4 cells' values

### Serial Commands

| Command | Description | Precondition |
|---------|-------------|--------------|
| `tare` | Re-tare all 4 cells, save offsets to NVS | Plate must be empty |
| `calibrate <grams>` | Place known weight centered on plate, compute scale factors | Must tare first, then place weight |
| `cal_status` | Query current calibration data (non-destructive) | None |
| `cal_reset` | Clear saved calibration and re-tare | Plate should be empty |

### Calibration State Message

```json
{"status":"calibration_state","calibrated":true,"cells":[
  {"index":0,"offset":-123456,"scaleFactor":1.0,"timestamp":86400},
  {"index":1,"offset":-234567,"scaleFactor":1.0,"timestamp":86400},
  {"index":2,"offset":-345678,"scaleFactor":1.0,"timestamp":86400},
  {"index":3,"offset":-456789,"scaleFactor":1.0,"timestamp":86400}
]}
```

---

## Serial Protocol

**ESP32 → Laptop** (JSON Lines, 115200 baud)

```jsonc
// Data frame (40 Hz when streaming)
{"t":12345,"seq":0,"f0":50230,"f1":49870,"f2":51100,"f3":50400}

// Status messages
{"status":"ready","sensor":"RSL301_via_HX711","rate":40}
{"status":"streaming"}
{"status":"idle"}
{"status":"plate_geometry","plateWidthMm":339.411,"plateHeightMm":339.411}
{"status":"device_info","id":"A1B2C3D4E5F6","fw":"1.0.0","sensor":"RSL301_via_HX711","transports":["serial","wifi","bluetooth"]}
{"status":"calibration_state","calibrated":true,"cells":[...]}
```

Fields: `t` = timestamp ms (ESP millis), `seq` = packet sequence number (for drop detection), `f0`–`f3` = raw HX711 ADC counts after tare.

**Laptop → ESP32** (plain text commands)

```
start\n       →  begin streaming data frames
stop\n        →  pause streaming
tare\n        →  re-tare all load cells (plate must be empty)
calibrate N\n →  calibrate with N grams of known weight on plate
cal_status\n  →  query calibration (non-destructive)
cal_reset\n   →  clear saved calibration and re-tare
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

On first boot the ESP32 tares all load cells (plate must be **empty** during boot) and saves calibration to NVS. Subsequent boots reuse the saved calibration.

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

## Dashboard Guide

### Connecting and Starting a Session

1. **Connect**: Select the serial port (or enter the WiFi host) and click **Connect**. The ESP32 status indicator turns green; the firmware broadcasts its calibration state, plate geometry, and device info automatically.
2. **Stand on the plate**: Stand in your normal stance before clicking Start. The plate must already be loaded so the step-on transient is suppressed during warmup.
3. **Start Session**: Click **▶ Start Session**. The server sends `start` to the ESP32, which begins streaming at 40 Hz. The first **2 seconds** of data are silently buffered and excluded from all metric computation (warmup filter — removes the weight-settling artifact from stepping on).
4. **Stop Session**: Click **■ Stop Session** at any time. The session is saved locally with a timestamp; raw and processed CSV downloads appear in the session history table.
5. **Session comparison**: Tick any two rows in the history table. A side-by-side comparison grid appears showing each metric with a percentage delta and an up/down arrow indicating improvement or regression.

---

### Charts

#### COP Trajectory

The main scatter plot shows the Center of Pressure path in millimetres from the geometric plate centre, updated in real time at 40 Hz.

- **Blue dot / trail** — the filtered COP position over the last few seconds. The length of the trail gives an immediate sense of how much area the COP is sweeping.
- **Dashed green circle** — the 10 mm stability zone radius. When the COP stays inside this circle the Time-in-Zone metric counts that sample as "in zone". A well-balanced standing posture keeps the COP near the centre of this circle most of the time.
- **Amber dashed ellipse** — the live 95% confidence ellipse, recomputed every 100 ms from the 10-second sliding window. The ellipse is oriented along the principal axes of sway variance (the major axis aligns with the direction of greatest instability). A small, nearly circular ellipse indicates low and isotropic sway; a large or tilted ellipse indicates a preferred direction of instability (often anterior-posterior in healthy adults).

**Reading the trajectory**: a tight cluster near the centre means the subject is maintaining stable, centred balance. A wide, erratic path — especially one that frequently exits the green circle — indicates postural instability.

#### Force Distribution

Two sub-panels:

- **Corner bar chart (left)** — shows each of the four load cells (FL, FR, BL, BR) as a vertical bar whose height represents the fraction of total vertical force on that corner, as a percentage. A perfectly centred stance produces four bars near 25%. Asymmetry here directly reflects weight-shift habits or limb loading differences.
- **Total force time series (right)** — plots total vertical force Fz = f0 + f1 + f2 + f3 over time in raw counts. A flat, stable Fz line confirms the subject is maintaining consistent contact with the plate. Clicking the chart toggles individual corner traces so you can observe per-corner dynamics.

#### Frequency Spectrum

A three-band bar chart of the power spectral density of the radial COP signal √(copX² + copY²), computed via FFT on the current 10-second window with a Hanning window applied before transformation.

| Band | Frequency range | Physiological meaning |
|------|-----------------|-----------------------|
| **Low** | < 0.5 Hz | Natural slow sway driven by open-loop vestibular and proprioceptive inputs. Dominant in healthy, quiet standing. |
| **Mid** | 0.5 – 1.5 Hz | Closed-loop neuromuscular corrective responses. Elevated mid-band power indicates active, frequent corrections — the nervous system is working harder to maintain balance. |
| **High** | > 1.5 Hz | Tremor, mechanical noise, or high-frequency corrective bursts. Pathological tremor, fatigue, or poor surface contact elevates this band. |

A healthy quiet-standing profile is low-band dominant. As balance challenge increases (eyes closed, foam surface, single leg), power shifts toward the mid and high bands.

#### Force Asymmetry

Two split-bar indicators:

- **Left / Right** — fraction of total force on the left two cells (FL + BL) vs. right two cells (FR + BR), shown as a percentage split. Colour coding: green = 45–55% (balanced), amber = outside that range, red = extreme asymmetry (< 35% or > 65% on one side).
- **Front / Back** — fraction on the front two cells (FL + FR) vs. back two cells (BL + BR). The natural centre of gravity projection in quiet standing is slightly anterior to the ankle joint, so a slight front-biased reading (52–55% front) is normal.

These indicators are useful for detecting habitual weight-bearing asymmetries that may not be obvious from the COP trajectory alone.

#### COP Position Readout

Numeric displays below the trajectory chart show the current instantaneous filtered COP coordinates and total displacement from centre, updated every frame:

- **X (mm)** — medial-lateral displacement. Positive = right of centre.
- **Y (mm)** — anterior-posterior displacement. Positive = forward (front of plate).
- **|COP| (mm)** — Euclidean distance from centre = √(X² + Y²).

---

### Metrics — Calculation and Interpretation

All metrics are computed on a **10-second sliding window** (400 samples at 40 Hz), updated every 4 samples (10 Hz). The window slides continuously during an active session; the readout you see is always the most recent 10 seconds.

#### Sway RMS

```
Sway RMS = √( mean(copX² + copY²) )       [mm]
```

The root-mean-square of the COP distance from the plate centre across all samples in the window. This is the single most widely cited posturography metric (Prieto et al., 1996). It captures the average magnitude of postural sway regardless of direction.

- **Low values (3–8 mm)** indicate a stable, centred posture with small, well-controlled oscillations.
- **High values (> 12 mm)** indicate large excursions from centre — either genuine instability or a deliberate weight shift.
- Sway RMS is sensitive to sustained offsets (e.g. standing habitually on one leg) as well as to oscillation amplitude.
- **Score contribution: 25%** — the largest single weight in the composite score.

#### Path Length

```
Path Length = Σ √(ΔcopX² + ΔcopY²)        [mm]
```

The total arc length of the COP trajectory over the window, summed sample-by-sample. Prieto et al. (1996) identify path length as the single most sensitive posturographic measure for detecting balance impairment, because it integrates both the amplitude and the speed of sway corrections into one number.

- **100–400 mm** per 10 seconds is typical for healthy young adults in quiet standing.
- **> 500 mm** suggests elevated neuromuscular activity, fatigue, or impaired proprioception.
- Path length grows proportionally with both how far and how fast the COP moves, making it more discriminating than RMS alone.
- Path length does **not** directly contribute to the composite score, but it feeds into sway velocity (below).

#### Sway Velocity

```
Sway Velocity = Path Length / window duration        [mm/s]
```

The mean speed of the COP trajectory — path length normalised by the window duration (10 s). Equivalent to the time-averaged COP velocity. Normalising by time makes this metric comparable across sessions of different lengths and independent of sampling rate.

- **5–15 mm/s** is typical for healthy standing.
- **> 20 mm/s** is associated with fall risk and vestibular dysfunction (Palmieri et al., 2002).
- Sway velocity is one of the most clinically validated metrics for distinguishing fallers from non-fallers in elderly populations.
- **Score contribution: 20%**.

#### Stability Area (95% Confidence Ellipse)

```
Covariance matrix of (copX, copY):
  C = [[var(copX),  cov(copX,copY)],
       [cov(copX,copY), var(copY) ]]

Eigenvalues λ₁ ≥ λ₂ of C  →  principal sway variances

Stability Area = π × χ²(0.95, df=2) × √(λ₁ × λ₂)
               = π × 5.991 × √(λ₁ × λ₂)           [mm²]
```

The area of the ellipse that statistically encloses 95% of the COP samples, assuming a bivariate normal distribution. This is computed analytically from the eigendecomposition of the COP covariance matrix (Duarte & Freitas, 2010) — it does not require actually fitting or drawing the ellipse.

- λ₁ is the variance along the major sway axis (the direction of maximum instability).
- λ₂ is the variance along the minor axis.
- The semi-axes of the displayed amber ellipse are `semiAxisA = √(λ₁ × 5.991)` and `semiAxisB = √(λ₂ × 5.991)`, and the ellipse is rotated by `0.5 × atan2(2·cov, var_x - var_y)` degrees to align with the principal axes.
- **50–200 mm²** is normal for young adults. **> 400 mm²** indicates significantly elevated spatial sway.
- Stability area distinguishes between sway that is large in one axis (anisotropic — typical of A-P dominant sway) vs. uniformly large (isotropic — often seen in vestibular pathology).
- **Score contribution: 20%**.

#### Frequency Features

The radial COP signal `r(t) = √(copX² + copY²)` is DC-removed, Hanning-windowed, zero-padded to the next power of 2, and transformed with a radix-2 Cooley-Tukey FFT. Power at each frequency bin is `|X[k]|² / N`. Three band powers are summed:

| Feature | Calculation | Interpretation |
|---------|-------------|----------------|
| **Low band power** | Σ power for f < 0.5 Hz | Natural vestibular/proprioceptive sway |
| **Mid band power** | Σ power for 0.5 ≤ f ≤ 1.5 Hz | Active neuromuscular corrections |
| **High band power** | Σ power for f > 1.5 Hz | Tremor, noise, or high-freq corrections |
| **Dominant frequency** | Frequency bin with peak power | Primary oscillation rate |
| **Mean frequency** | Σ(f × power) / Σ(power) | Power-weighted centre of spectrum |

The dominant and mean frequencies are displayed numerically. A healthy standing profile has dominant frequency in the **0.1–0.5 Hz** range. Elevated dominant frequency (> 0.8 Hz) suggests rapid, high-frequency corrections consistent with balance difficulty or neuromuscular pathology.

Frequency features are **not** currently included in the composite balance score but are displayed as a separate chart for clinical and research interpretation.

#### Jerk RMS

```
velocity(t)  =  Δcop / Δt              [mm/s]   (computed sample-by-sample)

jerk(t)  =  (velocity(t+1) − velocity(t-1)) / (2·Δt)    [mm/s³]  (central difference)

Jerk RMS  =  √( mean(jerkX² + jerkY²) )                 [mm/s³]
```

Jerk is the time derivative of velocity (second derivative of displacement). It quantifies how abruptly the balance corrections change direction and magnitude. Hogan & Sternad (2009) established jerk as the canonical measure of movement smoothness: a lower jerk score means corrections are smooth and well-planned; a higher jerk score means corrections are sudden and reactive.

- **200–800 mm/s³** is typical for smooth, controlled standing.
- **> 1000 mm/s³** suggests jerky, reactive corrections — often seen with fatigue, anxiety, or proprioceptive impairment.
- Jerk is complementary to sway velocity: a subject can have low velocity (small corrections) but high jerk (those corrections are abrupt), which still indicates poor motor control quality.
- **Score contribution: 10%** — the smallest weight, reflecting that jerk is more sensitive to noise and hardware variation than the other metrics.

#### Time in Zone

```
Time in Zone  =  (number of samples where √(copX² + copY²) < 10 mm) / total samples   [0 – 1]
```

The fraction of samples in the window where the COP lies within 10 mm of the plate centre (the green circle on the trajectory chart). This is a direct, intuitive measure: it asks "what proportion of the time was the subject successfully holding their balance near centre?"

- **0.80–0.95** (80–95%) is typical for healthy young adults in bilateral quiet standing.
- **< 0.70** (< 70%) indicates frequent excursions outside the stability zone.
- The threshold (10 mm) is configurable via `stabilityThreshold` in `PipelineConfig`. A tighter threshold (e.g. 6 mm) discriminates high-performance balance; a looser threshold (e.g. 15 mm) is more appropriate for impaired populations.
- Time in Zone is already on a 0–1 scale, so it requires no further normalisation before entering the composite score.
- **Score contribution: 25%** — equal to Sway RMS as the two largest contributors.

---

### Composite Balance Score

The composite score combines five metrics into a single 0–100 value (higher = better balance). It is designed to give a quick, at-a-glance summary that is sensitive to changes across the full range of balance ability.

#### Normalisation

Each metric (except Time in Zone) is mapped from its raw physical units to a 0–1 score using an **inverse sigmoid** function:

```
normalised(metric) = 1 / (1 + exp((metric − center) / scale))
```

This function returns values close to 1 when the metric is well below its center (good balance), 0.5 exactly at center, and close to 0 when the metric is well above center (poor balance). The sigmoid shape means the score changes most rapidly near the center, providing good discrimination in the typical range while not over-penalising extreme values.

| Metric | Center | Scale | Rationale |
|--------|--------|-------|-----------|
| Sway RMS | 10 mm | 6 mm | ~10 mm is the midpoint of the normal–impaired range |
| Sway Velocity | 20 mm/s | 12 mm/s | ~20 mm/s is the clinical fall-risk threshold |
| Stability Area | 500 mm² | 300 mm² | ~500 mm² separates mild from moderate impairment |
| Jerk RMS | 1000 mm/s³ | 600 mm/s³ | ~1000 mm/s³ is the boundary between smooth and jerky corrections |

Time in Zone is already 0–1 and contributes directly (higher fraction = higher normalised score).

#### Weighted Sum

```
Score = 100 × (  0.25 × norm(SwayRMS)
               + 0.25 × TimeInZone
               + 0.20 × norm(SwayVelocity)
               + 0.20 × norm(StabilityArea)
               + 0.10 × norm(JerkRMS)       )
```

Weights sum to 1.0. The result is clamped to [0, 100].

#### Score Colour Bands

| Score | Colour | Interpretation |
|-------|--------|----------------|
| 70 – 100 | Green | Good balance; within normal range for healthy adults |
| 40 – 69 | Amber | Moderate impairment; elevated fall risk or challenge condition |
| 0 – 39 | Red | Significant impairment; consult clinical assessment |

The weights and normalisation centers are configurable via `scoreWeights` in `PipelineConfig` / `DEFAULT_CONFIG` in `packages/processing/src/types.ts`.

---

### Session Comparison

Select any two sessions in the history table using the checkboxes. A comparison grid appears showing each metric side-by-side with percentage deltas and improvement/regression arrows.

---

## Configuration

Key parameters in `packages/processing/src/types.ts` → `DEFAULT_CONFIG`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sampleRate` | 40 Hz | Match firmware `SAMPLE_RATE_HZ` |
| `lpfCutoff` | 5 Hz | Butterworth LPF cutoff |
| `stabilityThreshold` | 10 mm | Time-in-Zone radius |
| `warmupMs` | 2000 ms | Step-on artifact discard |
| `plateWidth` | 339.411 mm | RSL301 load cell X separation |
| `plateHeight` | 339.411 mm | RSL301 load cell Y separation |

---

## Development Workflow

### Firmware

```bash
cd firmware
pio run                    # Build
pio run --target upload    # Flash to ESP32
pio device monitor         # Serial monitor (close before using dashboard!)
```

Config files (`wifi_config.h`, `bt_config.h`, `loadcell_config.h`) are gitignored — copy from `.example` templates.

### Processing Library

```bash
pnpm --filter @force-plate/processing build      # Build TypeScript → ESM
pnpm --filter @force-plate/processing test        # Run Vitest tests
pnpm --filter @force-plate/processing test:watch  # Watch mode
```

After changes, rebuild the library before restarting the server (it's a workspace dependency).

### Dashboard

```bash
pnpm --filter local-server dev    # Start server with tsx (auto-reload for TS)
```

The `public/` directory is served statically — edit HTML/JS/CSS and refresh the browser. No build step needed for frontend changes.

### Testing Without Hardware

```bash
pnpm --filter local-server dev -- --simulate
```

Or connect to a real ESP32 with `LOADCELLS_CONNECTED_COUNT 0` in `loadcell_config.h` and use the **Run Sample** button for a 10-second simulated session with Lissajous-pattern sway data.

### Monorepo Structure

- Root `pnpm-workspace.yaml` declares `packages/*` and `apps/*`
- `pnpm build` builds all packages
- `pnpm test` runs all tests
- Cross-package dependencies use `workspace:*` protocol

---

## Architecture

### Data Flow

```
Load Cell (RSL301)
  → HX711 (24-bit ADC, 80 SPS, Channel A, 128× gain)
  → ESP32 GPIO (bit-bang read with interrupt-safe critical section)
  → JSON Lines @ 40 Hz with packet sequence numbers
  → Serial / WiFi TCP / Bluetooth SPP transport
  → Node.js server (serial.ts / wifi-connection.ts)
  → parseSerialLine() → Pipeline.processSample()
  → COP calculation → Butterworth LPF (5 Hz) → Sliding window metrics
  → WebSocket broadcast → Browser dashboard (Canvas rendering)
```

### Pipeline Stages

1. **Raw ADC → COP**: Corner forces to center of pressure via weighted average
2. **COP → Filtered COP**: 2nd-order Butterworth IIR (Direct Form II Transposed)
3. **Filtered COP → Metrics**: 10-second sliding window, computed every 4th sample (10 Hz)
4. **Metrics → Score**: Sigmoid normalisation per metric + weighted sum

### WebSocket Protocol

Server → Client message types:
- `frame`: ProcessedFrame with COP, forces, metrics, session state
- `session_end`: Session completion with final metrics
- `status`: ESP32 status updates (connection, calibration, geometry, RSSI)
- `loadcells_values`: Live raw load cell readings

Client → Server: `{ type: "command", data: { action: "..." } }`

The WS server caches durable state (connection, device info, geometry, calibration) and replays it to late-joining clients.

### Session Lifecycle

1. Dashboard POSTs `/api/session/start` → server sends `start\n` to ESP + `pipeline.startSession()`
2. ESP streams data frames at 40 Hz
3. Server processes each frame, broadcasts via WebSocket
4. First 2 seconds: data buffered but metrics suppressed (warmup)
5. After warmup: metrics computed every 100 ms on a 10-second sliding window
6. Dashboard POSTs `/api/session/stop` → server sends `stop\n` + `pipeline.stopSession()`
7. Session saved as JSON metadata + raw CSV + processed CSV
8. `session_end` broadcast to dashboard

---

## Troubleshooting

### HX711 Not Reading / Stuck at Zero

- **Wiring**: Verify DOUT and CLK connections match `config.h` pin assignments
- **RATE pin**: Must be tied HIGH (not floating) for 80 SPS
- **Load cell wires**: S+ goes to HX711 A+, S- goes to A-. If wired to B+/B- the code won't read them (uses Channel A only)
- **Excitation**: HX711 E+ and E- must be connected (provides bridge excitation voltage)
- **Timeout**: If an HX711 is disconnected, the firmware now times out after 200ms instead of hanging

### WiFi Not Connecting

- ESP32 only supports **2.4 GHz** WiFi (not 5 GHz)
- Check SSID/password in `wifi_config.h` (case-sensitive)
- mDNS (`force-plate.local`) may not resolve on all networks — use the IP address as a fallback
- Firewall: allow TCP port 8888

### Bluetooth Pairing on Windows

- Device name: `BALANCE_PLATE_XXXX` (4-char hex suffix is unique per board)
- After pairing, check **Device Manager → Ports** for the assigned COM port number
- Some Windows versions create two COM ports — use the "outgoing" one
- If pairing fails, remove the device from Bluetooth settings and re-pair
- `bt_config.h` must exist (copied from `.example`) for BT to be enabled

### Serial Port Busy

- Close PlatformIO Serial Monitor before connecting via the dashboard
- Only one application can use a serial port at a time
- On Windows, check Task Manager for orphaned `node.exe` processes

### Dashboard Shows "Waiting for Geometry"

- The server drops data frames until it receives a `plate_geometry` status from the ESP32
- This is sent on boot, on `start` command, and every 10 seconds
- If persistent, disconnect and reconnect

### Metrics Show NaN or Unexpected Values

- Ensure at least 2 seconds of data has been collected (warmup period)
- The metrics window needs at least 20 samples (0.5 seconds at 40 Hz)
- Check that total force (Fz) is positive — someone must be standing on the plate

---

## Contributing

- **Code style**: TypeScript strict mode, ES2022 target, ESM modules. Arduino C++ for firmware.
- **Adding a new metric**: Create a file in `packages/processing/src/metrics/`, export the computation function, wire it into `pipeline.ts`, add to `BalanceMetrics` interface in `types.ts`, add a metric card in `index.html`, update `dashboard.js` to display it.
- **Adding a new transport**: Implement the same interface as `SerialConnection` / `WifiConnection` (setDataHandler, setStatusHandler, write, close), add conditional compilation in `main.cpp`.
- **Tests**: The processing library uses Vitest. Run with `pnpm --filter @force-plate/processing test`.
- **PR process**: Fork, branch, make changes, ensure `pnpm build` succeeds, submit PR.

---

## Key References

- Prieto et al. (1996): *Measures of postural steadiness: differences between healthy young and elderly adults.* IEEE TBME
- Palmieri et al. (2002): *Center-of-pressure parameters used in the assessment of postural control.* J Sport Rehabil
- Duarte & Freitas (2010): *Revision of posturography based on force plate for balance evaluation.* Braz J Phys Ther
- Collins & De Luca (1993): *Open-loop and closed-loop control of posture: a random-walk analysis.* Exp Brain Res
- Hogan & Sternad (2009): *Sensitivity of smoothness measures to movement duration, amplitude, and arrests.* J Motor Behav
