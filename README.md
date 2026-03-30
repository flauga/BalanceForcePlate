# IMU Balance Board

A research-grade balance training system that uses an inertial measurement unit (IMU) to provide real-time posturography metrics. Stand on the board, balance as long as you can, and track your improvement over time with advanced signal processing and a composite balance score.

## System Overview

```
BMI323 IMU ──SPI──> ESP32 ──USB Serial──> Local Server ──WebSocket──> Browser Dashboard
                                              │
                                              └──Upload──> Supabase (PostgreSQL + Auth)
                                                              │
                                                          Next.js Web App
                                                          deployed on Netlify
```

- **ESP32 Firmware**: Reads BMI323 accelerometer + gyroscope at 100Hz, streams JSON Lines over USB serial
- **Processing Library** (`@imu-balance/processing`): Shared TypeScript package — Madgwick AHRS, Butterworth LPF, 7 posturography metrics, composite score
- **Local Dashboard**: Node.js serial bridge + WebSocket server, browser dashboard with real-time plots
- **Web App**: Next.js on Netlify + Supabase (PostgreSQL database, Auth, Row Level Security)

---

## Project Structure

```
IMUBalanceBoard/
├── firmware/                          # ESP32 PlatformIO project
│   ├── platformio.ini                 # Build config (ESP32, Arduino framework, 460800 baud)
│   └── src/
│       ├── main.cpp                   # 100Hz sample loop, JSON Lines serial output
│       ├── bmi323.h / bmi323.cpp      # BMI323 SPI driver (register-level, no external lib)
│       └── config.h                   # Pin assignments, sample rate, scale factors
│
├── packages/
│   └── processing/                    # @imu-balance/processing (shared TypeScript)
│       └── src/
│           ├── types.ts               # RawIMUData, BalanceMetrics, Session, PipelineConfig
│           ├── madgwick.ts            # Madgwick AHRS filter (accel+gyro → quaternion)
│           ├── orientation.ts         # Quaternion → Euler (roll/pitch) conversion
│           ├── low-pass-filter.ts     # 2nd-order Butterworth LPF, Direct Form II Transposed
│           ├── serial-parser.ts       # JSON Lines parser for ESP32 serial stream
│           ├── pipeline.ts            # Orchestrator: raw → fusion → filter → metrics
│           ├── metrics/
│           │   ├── sway.ts            # RMS sway, path length, velocity
│           │   ├── stability-area.ts  # 95% confidence ellipse (eigenvalue decomposition)
│           │   ├── frequency.ts       # FFT, band power, dominant/mean frequency
│           │   ├── jerk.ts            # Angular velocity derivative (smoothness)
│           │   ├── time-in-zone.ts    # % time within stability threshold
│           │   └── balance-score.ts   # Composite weighted score (0-100, sigmoid-normalized)
│           └── session/
│               ├── detector.ts        # Step-on/off detection via accel variance + debounce
│               └── session-manager.ts # Session lifecycle: start, accumulate, end
│
├── apps/
│   ├── local-server/                  # Node.js serial bridge + dashboard server
│   │   ├── src/
│   │   │   ├── index.ts              # Entry: serial/simulate → pipeline → WebSocket + HTTP
│   │   │   ├── serial.ts             # SerialPort wrapper + SimulatedSerial (dev mode)
│   │   │   ├── ws-server.ts          # WebSocket broadcaster (frames + session events)
│   │   │   └── session-store.ts      # Local JSON file storage (~/.imu-balance/sessions/)
│   │   └── public/                   # Browser dashboard (vanilla JS, no build step)
│   │       ├── index.html
│   │       ├── dashboard.js          # WebSocket client + UI state
│   │       ├── charts.js             # SwayChart + TimeSeriesChart (HTML5 Canvas)
│   │       └── style.css             # Dark theme
│   │
│   └── web/                          # Next.js cloud app (deployed on Netlify)
│       ├── netlify.toml              # Build command, @netlify/plugin-nextjs
│       ├── .env.local.example        # Required environment variables
│       └── src/
│           ├── app/
│           │   ├── page.tsx           # Landing page
│           │   ├── dashboard/page.tsx # Live dashboard (connects to local server WS)
│           │   ├── sessions/page.tsx  # Session history + score-over-time chart
│           │   ├── sessions/[id]/page.tsx  # Session detail + full metrics
│           │   ├── auth/page.tsx      # Email/password + Google OAuth
│           │   └── auth/callback/route.ts  # Supabase OAuth redirect handler
│           ├── components/
│           │   ├── SwayPlot.tsx       # 2D sway trajectory (Canvas, trail + stability zone)
│           │   ├── MetricsPanel.tsx   # 7-metric card grid
│           │   ├── BalanceScore.tsx   # Score gauge with color coding
│           │   └── SessionTimer.tsx   # Live session stopwatch
│           ├── lib/
│           │   ├── supabase.ts        # Supabase client + all auth helpers
│           │   └── database.ts        # Session CRUD (Supabase PostgreSQL)
│           └── hooks/
│               ├── useAuth.ts         # Supabase auth state subscription
│               └── useWebSocket.ts    # Local server WS connection with auto-reconnect
│
├── package.json                       # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Hardware Setup

### Components
- **BMI323 IMU dev board** (Bosch Sensortec) — 6-axis accel + gyro
- **ESP32 dev board** — any ESP32 with USB-C (e.g., ESP32-DevKitC-V4)

### Wiring (SPI — VSPI)

| ESP32 Pin | BMI323 Pin | Function         |
|-----------|-----------|------------------|
| GPIO 18   | SCK       | SPI Clock        |
| GPIO 23   | SDI (MOSI)| Data to sensor   |
| GPIO 19   | SDO (MISO)| Data from sensor |
| GPIO 5    | CSB       | Chip Select (active low) |
| 3.3V      | VDD / VDDIO | Power          |
| GND       | GND       | Ground           |

> ⚠️ BMI323 is **3.3V only**. Do not connect to 5V.

**BMI323 SPI quirk**: the first 16 bits read after CS assertion are dummy bytes (per datasheet). All burst reads account for this.

### Serial Protocol

The ESP32 streams **JSON Lines** at **460800 baud**:

```json
{"t":123456,"ax":0.012,"ay":-0.983,"az":0.021,"gx":0.5,"gy":-0.3,"gz":0.1}
```

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `t` | uint32 | ms | ESP32 `millis()` timestamp |
| `ax`, `ay`, `az` | float | g | Accelerometer |
| `gx`, `gy`, `gz` | float | deg/s | Gyroscope |

On startup: `{"status":"ready","sensor":"bmi323","rate":100}`

---

## Signal Processing Algorithm

The pipeline models upright balance as an **inverted pendulum** system, approximating Center of Pressure (COP) displacement using angular sway and velocity from inertial sensors — consistent with established inertial posturography methodology.

### 1. Sensor Fusion — Madgwick AHRS Filter

**Reference**: Madgwick et al. (2011), *IEEE Int. Conf. Rehab. Robot.*

Fuses accelerometer and gyroscope data using a gradient descent algorithm to estimate orientation as a quaternion. Single tuning parameter **beta** (default: 0.1) controls the balance between gyroscope integration and accelerometer correction.

- Lower beta (0.01–0.04): smoother, trusts gyro more
- Higher beta (0.1–0.5): faster convergence, trusts accel more

The quaternion is converted to **roll** (θx) and **pitch** (θy) in degrees. Yaw is not used.

### 2. Low-Pass Filtering — Butterworth 2nd Order

2nd-order Butterworth filter with **5 Hz cutoff** at 100 Hz sample rate, implemented as a Direct Form II Transposed difference equation. Removes sensor noise and mechanical vibration while preserving postural sway dynamics (< 3 Hz).

Coefficients computed via bilinear transform with pre-warped cutoff frequency.

### 3. Balance Metrics

Computed over a sliding **10-second window** (1000 samples) and updated at **10 Hz**.

#### 3.1 Sway Magnitude (RMS)

$$\theta_{RMS} = \sqrt{\frac{1}{N}\sum_{i=1}^{N}(\theta_{x,i}^2 + \theta_{y,i}^2)}$$

Overall deviation from vertical. Higher = more instability.

**Reference**: Prieto et al. (1996), *IEEE Trans. Biomed. Eng.*, 43(9), 956–966.

#### 3.2 Sway Path Length

$$L = \sum_{i=2}^{N}\sqrt{(\Delta\theta_x)^2 + (\Delta\theta_y)^2}$$

Total distance traced by the sway trajectory — the most sensitive COP-equivalent metric.

**Reference**: Ruhe et al. (2010), *Gait & Posture*, 32(4), 436–445.

#### 3.3 Sway Velocity

$$V = \frac{L}{T}$$

Mean correction speed. High velocity indicates rapid, potentially destabilizing corrections.

**Reference**: Palmieri et al. (2002), *J. Sport Rehabil.*, 11(1), 51–66.

#### 3.4 Stability Area (95% Confidence Ellipse)

Eigenvalue decomposition of the 2×2 covariance matrix of (roll, pitch):

$$\text{Cov} = \begin{bmatrix}\text{Var}(\theta_x) & \text{Cov}(\theta_x,\theta_y)\\\text{Cov}(\theta_x,\theta_y) & \text{Var}(\theta_y)\end{bmatrix}$$

$$\text{Area} = \pi \cdot \chi^2_{0.95,2} \cdot \sqrt{\lambda_1 \cdot \lambda_2} \quad (\chi^2 = 5.991)$$

Larger area = wider sway scatter = worse balance.

**Reference**: Duarte & Freitas (2010), *Rev. Bras. Fisioter.*, 14(3), 183–192.

#### 3.5 Frequency Domain Features (FFT)

Radix-2 Cooley-Tukey FFT with Hanning window on the combined sway signal:

| Band | Frequency | Mechanism |
|------|-----------|-----------|
| Low | < 0.5 Hz | Natural sway (open-loop vestibular/proprioceptive) |
| Mid | 0.5–1.5 Hz | Corrective responses (closed-loop neuromuscular) |
| High | > 1.5 Hz | Tremor / high-frequency overcorrection |

**Reference**: Collins & De Luca (1993), *Exp. Brain Res.*, 95(2), 308–318.

#### 3.6 Jerk (Smoothness)

$$J_{RMS} = \text{RMS}\!\left(\frac{d\omega}{dt}\right)$$

Central-difference approximation of angular acceleration. High jerk = abrupt, uncoordinated corrections.

**Reference**: Hogan & Sternad (2009), *J. Motor Behav.*, 41(6), 529–534.

#### 3.7 Time-in-Stability Zone

$$\text{TIZ} = \frac{|\{i : |\theta_i| < \theta_{thr}\}|}{N}$$

Fraction of time within the stability threshold (default: **3°**). The most directly interpretable metric.

**Reference**: Riemann et al. (1999), *J. Sport Rehabil.*, 8(2), 71–82.

### 4. Composite Balance Score

$$\text{Score} = \frac{\sum_i w_i \cdot \sigma(m_i)}{{\sum_i w_i}} \times 100$$

Each metric is normalized to [0, 1] via sigmoid inversion (`1 / (1 + exp((x - center) / scale))`), so lower sway/velocity/area/jerk → higher component score.

| Metric | Default Weight |
|--------|---------------|
| Sway RMS | 0.25 |
| Time in Zone | 0.25 |
| Sway Velocity | 0.20 |
| Stability Area | 0.20 |
| Jerk RMS | 0.10 |

### 5. Session Detection

Variance-based automatic detection using the accelerometer signal:

- **Step-on**: sustained variance above threshold for > 500 ms (dynamic loading)
- **Step-off**: variance below threshold for > 1000 ms (unloaded)
- Hysteresis prevents oscillation; debounce prevents false triggers from transient movements

---

## Cloud Stack: Supabase + Netlify

### Supabase

[Supabase](https://supabase.com) provides the PostgreSQL database, authentication, and Row Level Security.

#### Database Schema

Run this in the **Supabase SQL Editor** (`Dashboard → SQL Editor → New Query`):

```sql
CREATE TABLE sessions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  start_time    timestamptz NOT NULL,
  end_time      timestamptz NOT NULL,
  duration      float       NOT NULL,
  final_metrics jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Users can only read and write their own sessions
CREATE POLICY "Users manage own sessions"
  ON sessions FOR ALL
  USING (auth.uid() = user_id);
```

#### Authentication

Supabase Auth is used for email/password and Google OAuth sign-in. To enable Google:

1. Go to `Dashboard → Authentication → Providers → Google`
2. Add your Google OAuth Client ID and Secret
3. Set the redirect URL to `https://your-app.netlify.app/auth/callback`

#### Environment Variables

Copy `apps/web/.env.local.example` to `apps/web/.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Both values are found in `Supabase Dashboard → Project Settings → API`.

### Netlify

The web app deploys to [Netlify](https://netlify.com) using the Next.js plugin.

#### Deploy Steps

1. Push this repository to GitHub
2. In Netlify: **Add new site → Import from Git**
3. Set build settings (auto-detected from `netlify.toml`):
   - Base directory: *(leave blank — root)*
   - Build command: `pnpm --filter web build`
   - Publish directory: `apps/web/.next`
4. Add environment variables in `Netlify → Site settings → Environment variables`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **Deploy site**

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 8 (`npm install -g pnpm`)
- [PlatformIO](https://platformio.org/) (for firmware flashing)
- ESP32 dev board + BMI323 IMU (for hardware mode; simulation mode requires no hardware)

### Installation

```bash
cd IMUBalanceBoard
pnpm install
```

### Flash Firmware

```bash
cd firmware
pio run --target upload
pio device monitor --baud 460800   # Verify: should print JSON at 100Hz
```

Expected output at rest:
```
{"status":"ready","sensor":"bmi323","rate":100}
{"t":1234,"ax":0.01,"ay":-0.01,"az":0.98,"gx":0.1,"gy":0.0,"gz":-0.1}
...
```

### Run Local Dashboard

```bash
# With hardware:
pnpm --filter local-server dev -- COM3        # Windows
pnpm --filter local-server dev -- /dev/ttyUSB0 # Linux/Mac

# Without hardware (simulated sway data):
pnpm --filter local-server dev -- --simulate
```

Open **http://localhost:3000** — the dashboard connects automatically.

### Run Web App Locally

```bash
cp apps/web/.env.local.example apps/web/.env.local
# Fill in your Supabase URL and anon key

pnpm --filter web dev
```

Open **http://localhost:3001**. The live dashboard tab connects to the local server WebSocket at `ws://localhost:8080`.

### Build All

```bash
pnpm build
```

---

## Tuning Guide

### Madgwick Beta (`PipelineConfig.madgwickBeta`)
| Value | Behavior |
|-------|----------|
| 0.01–0.04 | Smooth output, trusts gyro, slower convergence from rest |
| 0.1 | Default — balanced |
| 0.2–0.5 | Faster convergence, noisier, trusts accelerometer more |

### Stability Threshold (`PipelineConfig.stabilityThreshold`)
- **3°** (default) — suitable for most users
- **5–8°** — easier, better for beginners
- **1–2°** — demanding, for advanced training

### Score Weights (`PipelineConfig.scoreWeights`)
Increase `timeInZone` weight to make the score more reward-focused (gamification). Increase `swayVelocity` for a clinical-style fall-risk emphasis.

---

## Key References

1. **Prieto, T. E., et al.** (1996). Measures of postural steadiness: differences between healthy young and elderly adults. *IEEE Trans. Biomed. Eng.*, 43(9), 956–966.
2. **Ruhe, A., et al.** (2010). The test–retest reliability of centre of pressure measures in bipedal static task conditions. *Gait & Posture*, 32(4), 436–445.
3. **Palmieri, R. M., et al.** (2002). Center-of-pressure parameters used in the assessment of postural control. *J. Sport Rehabil.*, 11(1), 51–66.
4. **Duarte, M., & Freitas, S. M. S. F.** (2010). Revision of posturography based on force plate for balance evaluation. *Rev. Bras. Fisioter.*, 14(3), 183–192.
5. **Collins, J. J., & De Luca, C. J.** (1993). Open-loop and closed-loop control of posture: a random-walk analysis of center-of-pressure trajectories. *Exp. Brain Res.*, 95(2), 308–318.
6. **Riemann, B. L., et al.** (1999). Relationship between clinical and forceplate measures of postural stability. *J. Sport Rehabil.*, 8(2), 71–82.
7. **Hogan, N., & Sternad, D.** (2009). Sensitivity of smoothness measures to movement duration, amplitude, and arrests. *J. Motor Behav.*, 41(6), 529–534.
8. **Madgwick, S. O. H., et al.** (2011). Estimation of IMU and MARG orientation using a gradient descent algorithm. *IEEE Int. Conf. Rehab. Robot.*

---

## License

MIT
