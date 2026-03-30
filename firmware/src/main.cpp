/**
 * ESP32 Force Plate Firmware — Phase 1
 *
 * Architecture (dual-core FreeRTOS):
 *
 *   Core 1 (APP_CPU) — ADC task (priority MAX)
 *     Hardware timer ISR fires at 50 Hz
 *     → notifies adcTask via xTaskNotifyGive
 *     adcTask reads all 4 HX711 channels in parallel (~50 µs)
 *     → packs 22-byte UDP packet with CRC-16-CCITT
 *     → pushes to FreeRTOS ring buffer (non-blocking)
 *     → updates force-plate state machine
 *
 *   Core 0 (PRO_CPU) — UDP task (priority 5) + WiFi AP stack
 *     Drains ring buffer and sends each packet via UDP
 *     Sniffs incoming UDP traffic to learn client IP dynamically
 *     Produces heartbeat packets when IDLE
 *
 * Packet format: see packet.h (22 bytes, CRC-16-CCITT).
 * Pin assignments: see config.h.
 */

#include <Arduino.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/ringbuf.h"

#include "config.h"
#include "hx711_parallel.h"
#include "wifi_ap.h"
#include "packet.h"

// ---- Globals ----

static HX711Parallel hx711;
static WiFiAP        wifiAP;

static RingbufHandle_t ringBuf = nullptr;

static TaskHandle_t adcTaskHandle  = nullptr;
static TaskHandle_t udpTaskHandle  = nullptr;
static hw_timer_t*  adcTimer       = nullptr;

static volatile uint16_t gSeqNum      = 0;
static volatile uint32_t gDropCount   = 0;   // ring buffer overflow counter

// ---- State machine ----

enum class FPState : uint8_t {
    IDLE,       // plate unloaded; heartbeat packets only
    DETECTING,  // force above threshold, waiting for debounce
    RECORDING,  // streaming; COP data meaningful
    FINISHING   // draining ring buffer before returning to IDLE
};

static volatile FPState  gState          = FPState::IDLE;
static volatile uint32_t gDetectStartMs  = 0;
static volatile uint32_t gOffloadStartMs = 0;
static volatile uint32_t gLastHbMs       = 0;

// ---- Timer ISR ----

void IRAM_ATTR onAdcTimer() {
    BaseType_t woken = pdFALSE;
    vTaskNotifyGiveFromISR(adcTaskHandle, &woken);
    if (woken) portYIELD_FROM_ISR();
}

// ---- ADC task (Core 1) ----

static void adcTask(void* /*arg*/) {
    for (;;) {
        // Block until the 50 Hz timer ISR wakes us.
        ulTaskNotifyTake(pdTRUE, portMAX_DELAY);

        const uint32_t ts  = micros();
        const uint16_t seq = gSeqNum++;

        HX711Reading reading = hx711.read();

        if (!reading.valid) {
            // DOUT timeout — skip this sample without incrementing drop counter
            // (not a ring-buffer drop; a sensor issue).
            continue;
        }

        // ---- State machine update ----
        // Compute rough total force in kg for step-on/step-off detection.
        float fTotalKg = 0.0f;
        for (int i = 0; i < 4; i++) {
            fTotalKg += hx711.toKg(reading.ch[i], (uint8_t)i);
        }

        const uint32_t now = millis();

        switch (gState) {
        case FPState::IDLE:
            if (fTotalKg > DETECT_THRESHOLD_KG) {
                gState = FPState::DETECTING;
                gDetectStartMs = now;
            }
            break;

        case FPState::DETECTING:
            if (fTotalKg < DETECT_THRESHOLD_KG) {
                // Transient — cancel debounce.
                gState = FPState::IDLE;
            } else if (now - gDetectStartMs >= DETECT_DEBOUNCE_MS) {
                gState = FPState::RECORDING;
                Serial.println("[FP] → RECORDING");
            }
            break;

        case FPState::RECORDING:
            if (fTotalKg < DETECT_THRESHOLD_KG) {
                gState = FPState::FINISHING;
                gOffloadStartMs = now;
                Serial.println("[FP] → FINISHING");
            }
            break;

        case FPState::FINISHING:
            // Return to IDLE once force has stayed low long enough to confirm
            // step-off (not just a momentary unloading during movement).
            if (fTotalKg >= DETECT_THRESHOLD_KG) {
                // Subject stepped back on — resume recording.
                gState = FPState::RECORDING;
                Serial.println("[FP] → RECORDING (resumed)");
            } else if (now - gOffloadStartMs >= OFFLOAD_DEBOUNCE_MS) {
                gState = FPState::IDLE;
                Serial.println("[FP] → IDLE");
            }
            break;
        }

        // ---- Pack and enqueue packet ----
        uint8_t pkt[PACKET_SIZE];
        pack_data_packet(pkt, seq, ts,
                         reading.ch[0], reading.ch[1],
                         reading.ch[2], reading.ch[3]);

        // Non-blocking send: drop oldest if buffer is full.
        BaseType_t sent = xRingbufferSend(ringBuf, pkt, PACKET_SIZE, 0);
        if (sent != pdTRUE) {
            gDropCount++;
        }
    }
}

// ---- UDP task (Core 0) ----

static void udpTask(void* /*arg*/) {
    uint32_t ipCheckCounter = 0;

    for (;;) {
        // ---- Drain ring buffer ----
        size_t itemSize = 0;
        void* item = xRingbufferReceive(ringBuf, &itemSize, pdMS_TO_TICKS(10));

        if (item != nullptr) {
            wifiAP.sendPacket((const uint8_t*)item, itemSize);
            vRingbufferReturnItem(ringBuf, item);
        }

        // ---- Heartbeat (IDLE state only) ----
        const uint32_t now = millis();
        if (gState == FPState::IDLE && (now - gLastHbMs) >= 1000u) {
            gLastHbMs = now;
            uint8_t hbPkt[PACKET_SIZE];
            pack_heartbeat_packet(hbPkt, gSeqNum++, micros());
            wifiAP.sendPacket(hbPkt, PACKET_SIZE);
        }

        // ---- Client IP update (every ~100 iterations ≈ 1 s) ----
        if (++ipCheckCounter >= 100) {
            ipCheckCounter = 0;
            wifiAP.updateClientIP();
        }
    }
}

// ---- setup() ----

void setup() {
    Serial.begin(SERIAL_BAUD_RATE);
    delay(100);
    Serial.println("\n[FP] Force Plate firmware starting…");

    // 1. WiFi AP — must be up before tasks start sending packets.
    if (!wifiAP.begin()) {
        Serial.println("[FP] WiFi AP init failed — halting");
        for (;;) delay(1000);
    }

    // 2. HX711 — configure GPIOs, wait for settle, then tare.
    hx711.begin();

    // Set calibration scales if known; otherwise default 1.0 (raw counts).
    hx711.setCalibration(CH_TL, DEFAULT_SCALE_CH0);
    hx711.setCalibration(CH_TR, DEFAULT_SCALE_CH1);
    hx711.setCalibration(CH_BL, DEFAULT_SCALE_CH2);
    hx711.setCalibration(CH_BR, DEFAULT_SCALE_CH3);

    hx711.tare(HX711_TARE_SAMPLES);

    // 3. FreeRTOS ring buffer (NOSPLIT: each item is always returned whole).
    ringBuf = xRingbufferCreate(RING_BUFFER_SIZE, RINGBUF_TYPE_NOSPLIT);
    if (ringBuf == nullptr) {
        Serial.println("[FP] Ring buffer alloc failed — halting");
        for (;;) delay(1000);
    }

    // 4. Create tasks before starting the timer.
    //    ADC task → Core 1 at max priority (configMAX_PRIORITIES - 1 = 24).
    //    UDP task → Core 0 at priority 5 (alongside WiFi stack).
    xTaskCreatePinnedToCore(adcTask, "adcTask",
                            4096, nullptr,
                            configMAX_PRIORITIES - 1,
                            &adcTaskHandle, 1 /* Core 1 */);

    xTaskCreatePinnedToCore(udpTask, "udpTask",
                            4096, nullptr,
                            5,
                            &udpTaskHandle, 0 /* Core 0 */);

    // 5. Hardware timer: APB clock (80 MHz), prescaler 80 → 1 MHz tick.
    //    Alarm at 20 000 ticks → 50 Hz.
    adcTimer = timerBegin(0, 80, true);
    timerAttachInterrupt(adcTimer, &onAdcTimer, true);
    timerAlarmWrite(adcTimer, 20000, true);
    timerAlarmEnable(adcTimer);

    Serial.println("[FP] Ready — 50 Hz streaming on ForcePlate_01");
}

// ---- loop() — idle; all work done in FreeRTOS tasks ----

void loop() {
    // Periodically print diagnostics to Serial.
    static uint32_t lastDiagMs = 0;
    const uint32_t now = millis();
    if (now - lastDiagMs >= 5000u) {
        lastDiagMs = now;
        Serial.printf("[FP] state=%d  seq=%u  drops=%u  clients=%d  ip=%s\n",
                      (int)gState, (unsigned)gSeqNum, (unsigned)gDropCount,
                      WiFi.softAPgetStationNum(),
                      wifiAP.clientIPString().c_str());
    }
    delay(100);
}
