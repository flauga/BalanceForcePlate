# Balance Force Plate

Real-time balance assessment on a 4-corner load cell force plate. The ESP32 reads 4 HX711 amplifiers at 40 Hz, hosts a WebSocket server on its WiFi network, and broadcasts text-based force frames directly to any browser that opens the dashboard. No server, no installer, no bridge process — one ESP32 and one HTML file.

```
4 × RSL301 load cells  ──HX711──►  ESP32 ──ws://force-plate.local:80──►  Browser (forceplate_dashboard.html)
                                        ◄─── commands (text) ──────────
```

The browser does all the signal processing: COP calculation, 2nd-order Butterworth low-pass filter, sway metrics (RMS, path length, velocity, 95 % confidence ellipse, balance score), session recording → CSV, and CSV replay.

## Quick start

1. **Flash the firmware.** In `firmware/`, copy `src/wifi_config.h.example` → `src/wifi_config.h`, fill in your WiFi credentials (one or more networks, tried in order), then:

   ```
   pio run -e esp32 -t upload
   pio device monitor
   ```

   On boot the serial log prints the assigned IP and confirms `ws://force-plate.local:80` is up.

2. **Open the dashboard.** Double-click `firmware/forceplate_dashboard.html`. No server, no build step — it runs from the file system.

3. **Connect.** Leave the host field as `force-plate.local` (or paste the IP from the serial log if your OS does not resolve mDNS) and click **Connect**.

4. **Calibrate once (over USB serial).** Connect the ESP32 to a computer over USB, open `pio device monitor` (or any serial terminal at 115200 baud), and type `c`. The 2-point calibration wizard is interactive and blocking, and today it runs on the serial port only — it asks for two known weights in grams, walks through all four cells, and persists values to EEPROM. The dashboard's Calibration tab shows the resulting per-cell scale / offset / calibrated state, but the wizard's prompts themselves are serial-only. Calibration survives reboots and only needs to be redone when the hardware changes.

5. **Record a session.** Click **▶ Start Session**, stand on the plate, click **■ Stop & Save CSV** — the file downloads to your browser's default download folder.

Multiple browsers can connect to the device at the same time; every connected client receives the same broadcast.

## Wire protocol

Everything is plain UTF-8 text over a single WebSocket (`ws://<host>:80`). The firmware sends the same lines it already writes to the serial console, so `pio device monitor` remains a full debugging view.

| Direction | Prefix / shape | Meaning |
|---|---|---|
| ESP → dashboard | `[<ms>ms] FL:<g>g FR:<g>g BL:<g>g BR:<g>g TOTAL:<g>g` | 40 Hz posting line (calibrated grams) |
| ESP → dashboard | `[<ms>ms] FL:<raw> FR:<raw> BL:<raw> BR:<raw>` | Same cadence, raw ADC counts (after `r` command) |
| ESP → dashboard | `[STATUS] {"cells":[…], "postingMode":bool, "ip":…, "mdns":"force-plate.local", "port":80, "heap":<bytes>}` | Current device state, sent on connect and on `s` command |
| ESP → dashboard | `[INFO] <text>` | Human-readable event (boot, rescan, tare, errors) |
| ESP → dashboard | `[CAL] <text>` / `[CAL:<cell>] <text>` | Calibration wizard prompts — **serial only today**; WebSocket clients will not see them |
| Dashboard → ESP | `h · s · d · l · r · start · read · stop · t · t1-t4 · c · x · x1-x4` | Commands (same set accepted on serial and WebSocket) |

## Repository layout

```
firmware/
├── platformio.ini                    # ESP32 + WebSockets library
├── forceplate_dashboard.html         # The entire dashboard (single file)
└── src/
    ├── main.cpp                      # Event loop, commands, posting, calibration wizard
    ├── config.h                      # GPIO pins, sample rate, plate geometry, HX711 timing
    ├── hx711.h / .cpp                # 4-channel bit-bang HX711 driver (non-blocking)
    ├── wifi_stream.h / .cpp          # WebSocket server + mDNS; thin wrapper around links2004/WebSockets
    └── wifi_config.h.example         # Template for multi-SSID credentials (gitignored once copied)
```

## Signal processing (runs in the browser)

- **COP** from 4 calibrated corner forces, plate = 339.411 × 339.411 mm.
  `copX = ((FR+BR) − (FL+BL)) / total · plateW/2`
  `copY = ((FL+FR) − (BL+BR)) / total · plateH/2`
  COP is frozen at the last valid position when total force < 100 g.
- **Low-pass filter**: 2nd-order Butterworth, 5 Hz cutoff at 40 Hz sample rate, Direct Form II Transposed. Two independent filters for copX and copY.
- **Sway metrics** recomputed every 8 samples over an 800-sample (10 s) rolling window:
  sway RMS, path length, mean velocity, 95 % confidence ellipse area (covariance eigendecomposition), max distance from centroid, AP/ML range, composite balance score (sigmoid-normalised weighted average of RMS, velocity, area).
- **Warmup**: first 500 ms after session start are dropped to discard the step-on artefact.

All of the above is implemented directly in `forceplate_dashboard.html`. CSV replay feeds the same code path as live WebSocket data, so the metrics from a replay are numerically identical to the ones produced during the recording.

## CSV format

```
timestamp, elapsed_s, device_ms, fl_g, fr_g, bl_g, br_g, total_g, cop_x_mm, cop_y_mm
```

- `timestamp` — ISO 8601 wall-clock time when the frame was received by the browser.
- `elapsed_s` — seconds since **session start**.
- `device_ms` — ESP32 `millis()` at the time the frame was emitted.

## Hardware

- ESP32 DevKit V1 (any ESP32 with WiFi is fine).
- 4 × HX711 amplifiers (GPIO pairs in `src/config.h`: DOUT / CLK = 16/4, 17/5, 25/18, 26/19 for FL / FR / BL / BR).
- 4 × load cells in an RSL301-style plate (339.411 mm corner spacing assumed by the processing code; adjust `PLATE_W_MM` and `PLATE_H_MM` in the HTML if yours differs).

## Common operations

- **Re-scan for load cells** — send `d` (useful if a cable was loose at boot).
- **Tare** — send `t` (all cells) or `t1`…`t4` (single cell); values write to EEPROM if the cell is already calibrated.
- **Reset calibration** — send `x` (all) or `x1`…`x4`.
- **View raw ADC once** — send `r`; send `l` for one-shot calibrated grams.
- **Stream raw ADC continuously** — send `read` (stream raw posting lines); send `start` to go back to calibrated posting at 40 Hz.
- **Discover IP if mDNS does not resolve** — open serial monitor; the `[STATUS]` line prints `ip` on every connect.

## Why the architecture changed

Previous versions of this repo shipped a Node.js local server and an Electron desktop installer that bridged serial / WiFi → WebSocket → browser. That's been removed. The ESP32 now hosts the WebSocket itself and the browser does the processing, so the entire product is one firmware binary plus one HTML file that runs from any laptop without installation. This mirrors the sibling IMU balance board project and makes it easy to share the dashboard — just email the HTML file.
