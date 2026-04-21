#include <Arduino.h>
#include <EEPROM.h>
#include "config.h"
#include "hx711.h"
#include "wifi_stream.h"
#if __has_include("wifi_config.h")
  #include "wifi_config.h"
  #define WIFI_ENABLED 1
  static const WifiCredential wifiCreds[] = WIFI_CREDENTIALS;
  static constexpr size_t     wifiCredCount = sizeof(wifiCreds) / sizeof(wifiCreds[0]);
#else
  #define WIFI_ENABLED 0
#endif

// ─── EEPROM Layout ───────────────────────────────────────────────────────────
// Magic(1) + CalData×4(40) + postingMode(1) = 42 bytes
#define EEPROM_SIZE    64
#define EEPROM_MAGIC   0xAD   // bump to invalidate stale data on new flash
#define MAGIC_ADDR     0
#define CAL_BASE_ADDR  1      // 10 bytes per cell × 4 = 40 bytes
#define POSTING_ADDR   41

struct CalData {
    bool  calibrated;
    float scaleFactor;
    long  offset;
    bool  twoPoint;
};

// ─── WiFi ─────────────────────────────────────────────────────────────────────
#if WIFI_ENABLED
static WiFiStream wifiStream;   // defaults: ws://force-plate.local:80
static bool wifiActive = false;
#endif

// Broadcast a line to Serial and (if connected) all WebSocket clients.
// Used for status, calibration, and info messages.
static void broadcast(const char* line) {
    Serial.println(line);
#if WIFI_ENABLED
    wifiStream.println(line);
#endif
}

// Overload for status/calibration paths that still use String.
static void broadcast(const String& line) {
    broadcast(line.c_str());
}

// Send a data line via Serial + WebSocket broadcast (40 Hz posting stream).
static void broadcastData(const char* line) {
    Serial.println(line);
#if WIFI_ENABLED
    wifiStream.sendData(line);
#endif
}

// ─── Globals ─────────────────────────────────────────────────────────────────
HX711Array sensors(
    HX711_DOUT_0, HX711_CLK_0,
    HX711_DOUT_1, HX711_CLK_1,
    HX711_DOUT_2, HX711_CLK_2,
    HX711_DOUT_3, HX711_CLK_3
);

static CalData calData[NUM_CELLS];
static bool    cellConnected[NUM_CELLS];
static int     connectedCount = 0;
static bool    postingMode    = false;
static bool    rawPostingMode = false;
static bool    calInProgress  = false;

// ─── Cell names ──────────────────────────────────────────────────────────────
static const char* CELL_NAMES[NUM_CELLS]     = {"FL", "FR", "BL", "BR"};
static const char* CELL_POSITIONS[NUM_CELLS] = {
    "FRONT-LEFT  (corner 1)",
    "FRONT-RIGHT (corner 2)",
    "BACK-LEFT   (corner 3)",
    "BACK-RIGHT  (corner 4)"
};

// ─── EEPROM helpers ──────────────────────────────────────────────────────────
static int calAddr(int idx) { return CAL_BASE_ADDR + idx * 10; }

static void eepromWriteCalData(int idx) {
    int a = calAddr(idx);
    EEPROM.write(a, calData[idx].calibrated ? 1 : 0);  a++;
    EEPROM.put(a,  calData[idx].scaleFactor);            a += 4;
    EEPROM.put(a,  calData[idx].offset);                 a += 4;
    EEPROM.write(a, calData[idx].twoPoint ? 1 : 0);
    EEPROM.commit();
}

static void eepromReadCalData(int idx) {
    int a = calAddr(idx);
    calData[idx].calibrated  = EEPROM.read(a) == 1;     a++;
    EEPROM.get(a, calData[idx].scaleFactor);              a += 4;
    EEPROM.get(a, calData[idx].offset);                   a += 4;
    calData[idx].twoPoint    = EEPROM.read(a) == 1;
}

// EEPROM layout and helpers end here
static void initEEPROM() {
    EEPROM.begin(EEPROM_SIZE);
    if (EEPROM.read(MAGIC_ADDR) != EEPROM_MAGIC) {
        EEPROM.write(MAGIC_ADDR, EEPROM_MAGIC);
        for (int i = 0; i < NUM_CELLS; i++) {
            calData[i] = {false, 1.0f, 0L, false};
            eepromWriteCalData(i);
        }
        postingMode = false;
        EEPROM.write(POSTING_ADDR, 0);
        EEPROM.commit();
        Serial.println(F("[INFO] Fresh EEPROM — calibration initialised."));
    } else {
        for (int i = 0; i < NUM_CELLS; i++) eepromReadCalData(i);
        postingMode = EEPROM.read(POSTING_ADDR) == 1;
        Serial.println(F("[INFO] Calibration data loaded from EEPROM."));
    }
}

// ─── Apply calibration to HX711 array ────────────────────────────────────────
static void applyCalibration(int idx) {
    if (calData[idx].calibrated) {
        sensors.setOffset(idx, calData[idx].offset);
    } else {
        sensors.setOffset(idx, 0);
    }
}

// ─── Status JSON broadcast ────────────────────────────────────────────────────
static void printStatus() {
    String s = "[STATUS] {\"cells\":[";
    for (int i = 0; i < NUM_CELLS; i++) {
        if (i) s += ',';
        s += "{\"id\":";      s += i;
        s += ",\"name\":\""; s += CELL_NAMES[i]; s += '"';
        s += ",\"connected\":"; s += cellConnected[i] ? "true" : "false";
        s += ",\"calibrated\":"; s += calData[i].calibrated ? "true" : "false";
        s += ",\"twoPoint\":"; s += calData[i].twoPoint ? "true" : "false";
        s += ",\"scale\":"; s += String(calData[i].scaleFactor, 4);
        s += ",\"offset\":"; s += calData[i].offset;
        s += '}';
    }
    s += "],\"postingMode\":";
    s += postingMode ? "true" : "false";
#if WIFI_ENABLED
    if (WiFi.status() == WL_CONNECTED) {
        s += ",\"ip\":\"";   s += WiFi.localIP().toString();
        s += "\",\"mdns\":\"force-plate.local\"";
        s += ",\"port\":80";
    }
#endif
    s += ",\"heap\":"; s += (uint32_t)ESP.getFreeHeap();
    s += '}';
    broadcast(s);
}

// ─── Connection detection ─────────────────────────────────────────────────────
static void detectConnectedCells() {
    broadcast("[INFO] Scanning for load cells...");
    connectedCount = 0;
    sensors.rescan();
    for (int i = 0; i < NUM_CELLS; i++) {
        cellConnected[i] = sensors.isConnected(i);
        if (cellConnected[i]) {
            connectedCount++;
            applyCalibration(i);
        }
    }
    printStatus();
}

// ─── All connected cells calibrated? ─────────────────────────────────────────
static bool allConnectedCalibrated() {
    for (int i = 0; i < NUM_CELLS; i++) {
        if (cellConnected[i] && !calData[i].calibrated) return false;
    }
    return connectedCount > 0;
}

// ─── Tare ─────────────────────────────────────────────────────────────────────
static void tareCell(int idx) {
    if (!cellConnected[idx]) {
        broadcast(String("[INFO] ") + CELL_NAMES[idx] + " not connected.");
        return;
    }
    sensors.setOffset(idx, 0);
    long sum = 0;
    for (int s = 0; s < 20; s++) {
        long f[4]; sensors.readAll(f);
        sum += f[idx];
        delay(25);
    }
    long newOffset = sum / 20;
    sensors.setOffset(idx, newOffset);
    calData[idx].offset = newOffset;
    if (calData[idx].calibrated) eepromWriteCalData(idx);
    broadcast(String("[INFO] Tared ") + CELL_NAMES[idx] + " offset=" + newOffset);
}

// ─── Reset calibration ────────────────────────────────────────────────────────
static void resetCalibration(int idx) {
    calData[idx] = {false, 1.0f, 0L, false};
    sensors.setOffset(idx, 0);
    eepromWriteCalData(idx);
    postingMode = false;
    EEPROM.write(POSTING_ADDR, 0);
    EEPROM.commit();
    broadcast(String("[INFO] Calibration reset: ") + CELL_NAMES[idx]);
}

// ─── Serial helpers ───────────────────────────────────────────────────────────
static void flushSerial() {
    while (Serial.available()) Serial.read();
}

static String readLine(unsigned long timeoutMs = 60000) {
    flushSerial();
    String s = "";
    unsigned long t0 = millis();
    while (true) {
        if (millis() - t0 > timeoutMs) return "";
        if (Serial.available()) {
            char c = Serial.read();
            if (c == '\n' || c == '\r') {
                if (s.length() > 0) return s;
            } else {
                s += c;
            }
        }
    }
}

static void waitForAck(unsigned long timeoutMs = 60000) {
    flushSerial();
    unsigned long t0 = millis();
    while (!Serial.available()) {
        if (millis() - t0 > timeoutMs) return;
        delay(20);
    }
    flushSerial();
}

static float readFloat(unsigned long timeoutMs = 60000) {
    return readLine(timeoutMs).toFloat();
}

// ─── Sample average for one cell ─────────────────────────────────────────────
static long sampleCell(int idx, int n = 20) {
    long sum = 0;
    for (int s = 0; s < n; s++) {
        long f[4]; sensors.readAll(f);
        sum += f[idx];
        delay(25);
    }
    return sum / n;
}

// ─── Full calibration sequence (all connected cells) ─────────────────────────
// New flow:
//   1. Ask for weight1 and weight2 values upfront (grams)
//   2. Zero (tare) ALL connected cells at once
//   3. For each cell: place weight1 → measure, place weight2 → measure
static void calibrateAllCells() {
    calInProgress = true;

    // ── Get the two known weights upfront ────────────────────────────────────
    Serial.println(F("[CAL] ════════════════════════════════════════"));
    Serial.println(F("[CAL] CALIBRATION SEQUENCE — 2-point, all cells"));
    Serial.println(F("[CAL] You will need two known weights."));
    Serial.println(F("[CAL] Enter WEIGHT 1 in grams (e.g. 500):"));
    float weight1 = readFloat(120000);
    if (weight1 <= 0) {
        Serial.println(F("[CAL] ERR: invalid weight — aborting.")); calInProgress = false; return;
    }
    Serial.print(F("[CAL] Weight 1 = ")); Serial.print(weight1, 1); Serial.println(F("g"));

    Serial.println(F("[CAL] Enter WEIGHT 2 in grams (must differ from weight 1, e.g. 1000):"));
    float weight2 = readFloat(120000);
    if (weight2 <= 0 || fabsf(weight2 - weight1) < 1.0f) {
        Serial.println(F("[CAL] ERR: invalid or identical weight — aborting.")); calInProgress = false; return;
    }
    Serial.print(F("[CAL] Weight 2 = ")); Serial.print(weight2, 1); Serial.println(F("g"));
    Serial.println(F("[CAL] ────────────────────────────────────────"));

    // ── Step 1: zero all cells ────────────────────────────────────────────────
    Serial.println(F("[CAL] STEP 1/3 — ZERO all cells"));
    Serial.println(F("[CAL]   Remove ALL weights from the force plate."));
    Serial.println(F("[CAL]   Send any key when ready."));
    waitForAck(120000);

    Serial.println(F("[CAL] Measuring zero load on all cells (20 samples each)..."));
    long rawZero[NUM_CELLS] = {0};
    for (int i = 0; i < NUM_CELLS; i++) {
        if (!cellConnected[i]) continue;
        sensors.setOffset(i, 0);
        rawZero[i] = sampleCell(i);
        sensors.setOffset(i, rawZero[i]);
        Serial.print(F("[CAL]   ")); Serial.print(CELL_NAMES[i]);
        Serial.print(F(" zero_raw=")); Serial.println(rawZero[i]);
    }
    Serial.println(F("[CAL] All cells zeroed."));
    Serial.println(F("[CAL] ────────────────────────────────────────"));

    // ── Steps 2 & 3: per-cell weight measurements ─────────────────────────────
    long rawW1[NUM_CELLS] = {0};
    long rawW2[NUM_CELLS] = {0};

    for (int i = 0; i < NUM_CELLS; i++) {
        if (!cellConnected[i]) continue;
        char tag[12]; sprintf(tag, "[CAL:%s]", CELL_NAMES[i]);

        // Weight 1
        Serial.println(F("[CAL] ────────────────────────────────────────"));
        Serial.print(tag); Serial.print(F(" STEP 2/3 — Place WEIGHT 1 ("));
        Serial.print(weight1, 1); Serial.print(F("g) on "));
        Serial.print(CELL_POSITIONS[i]); Serial.println(F("."));
        Serial.print(tag); Serial.println(F(" Send any key when ready."));
        waitForAck(120000);

        Serial.print(tag); Serial.println(F(" Measuring weight 1 (20 samples)..."));
        rawW1[i] = sampleCell(i);  // offset already set to rawZero, so this is tare-relative
        float scale1 = (float)rawW1[i] / weight1;
        Serial.print(tag); Serial.print(F(" raw=")); Serial.print(rawW1[i]);
        Serial.print(F(" scale1=")); Serial.println(scale1, 4);

        // Weight 2
        Serial.print(tag); Serial.print(F(" STEP 3/3 — Place WEIGHT 2 ("));
        Serial.print(weight2, 1); Serial.print(F("g) on "));
        Serial.print(CELL_POSITIONS[i]); Serial.println(F("."));
        Serial.print(tag); Serial.println(F(" Send any key when ready."));
        waitForAck(120000);

        Serial.print(tag); Serial.println(F(" Measuring weight 2 (20 samples)..."));
        rawW2[i] = sampleCell(i);
        float scale2 = (float)rawW2[i] / weight2;
        float diff = fabsf(scale1 - scale2) / ((scale1 + scale2) / 2.0f) * 100.0f;
        Serial.print(tag); Serial.print(F(" raw=")); Serial.print(rawW2[i]);
        Serial.print(F(" scale2=")); Serial.print(scale2, 4);
        Serial.print(F(" diff=")); Serial.print(diff, 2); Serial.println(F("%"));
        if (diff > 5.0f) {
            Serial.print(tag); Serial.println(F(" WARN: scales differ >5% — check cell and weights"));
        }

        float finalScale = (scale1 + scale2) / 2.0f;

        // Verify with weight 2 still on plate
        float verify = (float)rawW2[i] / finalScale;
        Serial.print(tag); Serial.print(F(" VERIFY (weight2 still on plate): "));
        Serial.print(verify, 2); Serial.print(F("g  (expected: "));
        Serial.print(weight2, 1); Serial.println(F("g)"));

        // Save
        calData[i] = {true, finalScale, rawZero[i], true};
        eepromWriteCalData(i);
        Serial.print(tag); Serial.println(F(" DONE — saved to EEPROM."));
    }

    Serial.println(F("[CAL] ════════════════════════════════════════"));
    Serial.println(F("[CAL] Calibration complete for all connected cells."));
    calInProgress = false;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────
static void printCalibratedValues() {
    long f[4]; sensors.readAll(f);
    broadcast("[LIVE] Calibrated values (grams):");
    float total = 0;
    for (int i = 0; i < NUM_CELLS; i++) {
        float val = 0.0f;
        if (cellConnected[i] && calData[i].calibrated && calData[i].scaleFactor != 0.0f) {
            val = (float)f[i] / calData[i].scaleFactor;
        }
        total += val;
        String line = "  "; line += CELL_NAMES[i];
        line += " ("; line += CELL_POSITIONS[i]; line += "): ";
        if (!cellConnected[i])           line += "NOT CONNECTED";
        else if (!calData[i].calibrated) line += "NOT CALIBRATED";
        else { line += String(val, 2); line += 'g'; }
        broadcast(line);
    }
    broadcast("  TOTAL: " + String(total, 2) + "g");
}

static void printRawValues() {
    long f[4]; sensors.readAll(f);
    broadcast("[LIVE] Raw ADC values:");
    for (int i = 0; i < NUM_CELLS; i++) {
        String line = "  "; line += CELL_NAMES[i];
        line += " ("; line += CELL_POSITIONS[i]; line += "): ";
        if (!cellConnected[i]) line += "NOT CONNECTED";
        else line += String(f[i]);
        broadcast(line);
    }
}

// ─── Command handler ──────────────────────────────────────────────────────────
static void handleCommand(String cmd) {
    cmd.trim(); cmd.toLowerCase();

    if (cmd == "h") {
        broadcast("[INFO] ════════════════════════════════════════");
        broadcast("[INFO] Available commands:");
        broadcast("[INFO]   h        - Show this help message");
        broadcast("[INFO]   s        - Print full status JSON");
        broadcast("[INFO]   d        - Re-scan for connected load cells");
        broadcast("[INFO]   l        - Print live calibrated values (grams)");
        broadcast("[INFO]   r        - Print raw ADC values");
        broadcast("[INFO]   start    - Start continuous posting (grams)");
        broadcast("[INFO]   read     - Start continuous posting (raw ADC)");
        broadcast("[INFO]   stop     - Stop continuous posting");
        broadcast("[INFO]   t        - Tare all connected cells");
        broadcast("[INFO]   t1-t4    - Tare single cell (1=FL 2=FR 3=BL 4=BR)");
        broadcast("[INFO]   c        - Full 2-point calibration sequence");
        broadcast("[INFO]   x        - Reset calibration for all cells");
        broadcast("[INFO]   x1-x4    - Reset calibration for single cell");
        broadcast("[INFO] ════════════════════════════════════════");

    } else if (cmd == "s") {
        printStatus();

    } else if (cmd == "l") {
        printCalibratedValues();

    } else if (cmd == "r") {
        printRawValues();

    } else if (cmd == "start") {
        if (!allConnectedCalibrated()) {
            broadcast("[INFO] ERR: not all connected cells are calibrated. Run 'c' first.");
        } else {
            rawPostingMode = false;
            postingMode = true;
            EEPROM.write(POSTING_ADDR, 1);
            EEPROM.commit();
            broadcast("[INFO] Posting started. Send 'stop' to halt.");
        }

    } else if (cmd == "read") {
        rawPostingMode = true;
        postingMode = false;
        EEPROM.write(POSTING_ADDR, 0);
        EEPROM.commit();
        broadcast("[INFO] Raw posting started. Send 'stop' to halt.");

    } else if (cmd == "stop") {
        postingMode = false;
        rawPostingMode = false;
        EEPROM.write(POSTING_ADDR, 0);
        EEPROM.commit();
        broadcast("[INFO] Posting stopped.");

    } else if (cmd == "d") {
        detectConnectedCells();

    } else if (cmd == "t") {
        for (int i = 0; i < NUM_CELLS; i++) tareCell(i);
        printStatus();

    } else if (cmd == "c") {
        if (connectedCount == 0) {
            broadcast("[INFO] No connected cells to calibrate.");
        } else {
            calibrateAllCells();
            if (allConnectedCalibrated()) {
                postingMode = true;
                EEPROM.write(POSTING_ADDR, 1);
                EEPROM.commit();
                broadcast("[INFO] All cells calibrated — posting mode enabled. Send 'stop' to halt.");
            }
            printStatus();
        }

    } else if (cmd == "x") {
        for (int i = 0; i < NUM_CELLS; i++) resetCalibration(i);
        printStatus();

    } else if (cmd.length() == 2) {
        int idx = cmd[1] - '1';
        if (idx < 0 || idx >= NUM_CELLS) {
            broadcast("[INFO] ERR: invalid cell index, use 1-4"); return;
        }
        if (cmd[0] == 't') {
            tareCell(idx); printStatus();
        } else if (cmd[0] == 'x') {
            resetCalibration(idx); printStatus();
        } else {
            broadcast("[INFO] Unknown command: " + cmd);
        }

    } else {
        broadcast("[INFO] Unknown command: " + cmd);
    }
}

// ─── Setup ────────────────────────────────────────────────────────────────────
void setup() {
    Serial.begin(SERIAL_BAUD);
    delay(800);
    Serial.println(F("[INFO] 4-Corner Load Cell System — ESP32"));

    initEEPROM();

    // HX711 GPIO init is handled inside detectConnectedCells() → sensors.rescan()
    detectConnectedCells();

    if (connectedCount == 0) {
        Serial.println(F("[INFO] No cells detected. Send 'd' to re-scan."));
    } else if (postingMode && allConnectedCalibrated()) {
        Serial.println(F("[INFO] Resuming posting mode from EEPROM."));
    } else if (!allConnectedCalibrated()) {
        postingMode = false;
        Serial.println(F("[INFO] Uncalibrated cells detected. Use 'c' to calibrate."));
    }

#if WIFI_ENABLED
    wifiActive = wifiStream.begin(wifiCreds, wifiCredCount);
    if (wifiActive) {
        // Re-send status to any WiFi client that connects after boot
        wifiStream.setClientConnectedCallback([]() {
            printStatus();
        });
    }
#endif
}

// ─── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
    // ── Non-blocking Serial command accumulation ──────────────────────────────
    // Reads all available bytes without blocking; dispatches complete lines only.
    {
        static char    serialBuf[64];
        static uint8_t serialLen = 0;
        while (Serial.available()) {
            char c = (char)Serial.read();
            if (c == '\n' || c == '\r') {
                if (serialLen > 0) {
                    serialBuf[serialLen] = '\0';
                    handleCommand(String(serialBuf));
                    serialLen = 0;
                }
            } else if (serialLen < sizeof(serialBuf) - 1) {
                serialBuf[serialLen++] = c;
            }
        }
    }

#if WIFI_ENABLED
    // Accept new WiFi clients and read commands from any connected client
    if (wifiActive) {
        wifiStream.update();
        String wCmd = wifiStream.readLine();
        if (wCmd.length() > 0) handleCommand(wCmd);
    }
#endif

    // Non-blocking sampling: poll each HX711 every loop pass without blocking.
    // Only when all 4 have fresh data AND the rate timer has elapsed do we send.
    // This keeps the loop free so WiFi/TCP tasks get CPU time via yield().
    static long     pendingF[4]     = {0, 0, 0, 0};
    static bool     pendingReady[4] = {false, false, false, false};
    static uint32_t lastSampleUs    = 0;

    if ((postingMode || rawPostingMode) && !calInProgress && connectedCount > 0) {
        for (int i = 0; i < NUM_CELLS; i++) {
            if (!pendingReady[i]) {
                bool newData = false;
                long v = sensors.readIfReady(i, newData);
                if (newData) { pendingF[i] = v; pendingReady[i] = true; }
            }
        }

        bool allReady = pendingReady[0] && pendingReady[1]
                     && pendingReady[2] && pendingReady[3];
        const uint32_t nowUs = micros();
        if (allReady && (nowUs - lastSampleUs >= SAMPLE_PERIOD_US)) {
            // Additive timestep keeps long-term average rate exact;
            // re-sync on large gaps (first sample, reconnect, pause).
            if (nowUs - lastSampleUs > 2 * SAMPLE_PERIOD_US) {
                lastSampleUs = nowUs;
            } else {
                lastSampleUs += SAMPLE_PERIOD_US;
            }
            pendingReady[0] = pendingReady[1] = pendingReady[2] = pendingReady[3] = false;

            static char lineBuf[128];
            bool skipSample = false;
            if (rawPostingMode) {
                // Raw ADC: reconstruct pre-offset value (pendingF is offset-subtracted)
                long raw[4];
                for (int i = 0; i < NUM_CELLS; i++) {
                    raw[i] = pendingF[i] + calData[i].offset;
                }
                snprintf(lineBuf, sizeof(lineBuf),
                    "[%lums] FL:%ld FR:%ld BL:%ld BR:%ld",
                    (unsigned long)millis(), raw[0], raw[1], raw[2], raw[3]);
            } else {
                // Use a static char buffer — no heap allocation on the hot path.
                float vals[4] = {0.0f, 0.0f, 0.0f, 0.0f};
                float total   = 0.0f;
                for (int i = 0; i < NUM_CELLS; i++) {
                    if (cellConnected[i] && calData[i].calibrated && calData[i].scaleFactor != 0.0f) {
                        vals[i] = (float)pendingF[i] / calData[i].scaleFactor;
                    }
                    total += vals[i];
                }
                // Skip if any connected+calibrated cell reads exactly 0 (HX711 timeout)
                for (int i = 0; i < NUM_CELLS; i++) {
                    if (cellConnected[i] && calData[i].calibrated && vals[i] == 0.0f) {
                        skipSample = true; break;
                    }
                }
                if (!skipSample) {
                    snprintf(lineBuf, sizeof(lineBuf),
                        "[%lums] FL:%.2fg FR:%.2fg BL:%.2fg BR:%.2fg TOTAL:%.2fg",
                        (unsigned long)millis(), vals[0], vals[1], vals[2], vals[3], total);
                }
            }
            if (!skipSample) broadcastData(lineBuf);
        }
    }

    yield();  // Let ESP32 WiFi/TCP background tasks run
}
