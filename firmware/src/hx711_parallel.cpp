#include "hx711_parallel.h"

// GPIO pin arrays — indexed by HX711Channel enum (TL=0, TR=1, BL=2, BR=3).
static const uint8_t kDoutPins[4] = {
    HX711_DOUT_TL,
    HX711_DOUT_TR,
    HX711_DOUT_BL,
    HX711_DOUT_BR
};

// ---- Constructor ----

HX711Parallel::HX711Parallel() {
    for (int i = 0; i < 4; i++) {
        _tare[i]  = 0;
        _scale[i] = 1.0f;
    }
}

// ---- Public API ----

void HX711Parallel::begin() {
    pinMode(HX711_SCK_PIN, OUTPUT);
    digitalWrite(HX711_SCK_PIN, LOW);

    for (int i = 0; i < 4; i++) {
        pinMode(kDoutPins[i], INPUT_PULLUP);
    }

    // Allow HX711 modules and load cells to settle after power-on.
    // Datasheet specifies ~400 ms after VDD stabilises.
    delay(1000);

    Serial.println("[HX711] begin: GPIO configured, settled 1 s");
}

void HX711Parallel::tare(uint8_t samples) {
    Serial.printf("[HX711] tare: averaging %u samples…\n", samples);

    int64_t acc[4] = {0, 0, 0, 0};

    for (uint8_t s = 0; s < samples; s++) {
        // Wait for all DOUT lines to go LOW (conversion ready).
        uint32_t deadline = micros() + 200000u; // 200 ms timeout per sample
        while (digitalRead(HX711_DOUT_TL) || digitalRead(HX711_DOUT_TR) ||
               digitalRead(HX711_DOUT_BL) || digitalRead(HX711_DOUT_BR)) {
            if (micros() > deadline) {
                Serial.println("[HX711] tare: timeout waiting for DOUT — check wiring");
                return;
            }
        }
        for (int ch = 0; ch < 4; ch++) {
            acc[ch] += readOneRaw(ch);
        }
        delay(15); // ~80 SPS → 12.5 ms between conversions; add margin
    }

    for (int i = 0; i < 4; i++) {
        _tare[i] = (int32_t)(acc[i] / samples);
    }

    Serial.printf("[HX711] tare done: %ld %ld %ld %ld\n",
                  _tare[0], _tare[1], _tare[2], _tare[3]);
}

HX711Reading HX711Parallel::read() {
    HX711Reading result;
    result.valid = false;

    // ---- Wait for all four DOUT lines to go LOW (new conversion ready) ----
    // At 80 SPS a fresh reading arrives every 12.5 ms.  At 50 Hz sampling we
    // call this every 20 ms, so the wait should be near-instantaneous.
    const uint32_t deadline = micros() + 100000u; // 100 ms max
    while (digitalRead(HX711_DOUT_TL) || digitalRead(HX711_DOUT_TR) ||
           digitalRead(HX711_DOUT_BL) || digitalRead(HX711_DOUT_BR)) {
        if (micros() > deadline) {
            return result;  // valid = false signals caller to skip this sample
        }
    }

    uint32_t raw[4] = {0, 0, 0, 0};

    // ---- Critical section: clock out 24 data bits + gain-select pulses ----
    // noInterrupts() prevents WiFi (Core 0) and other ISRs from stealing the
    // CPU long enough to leave SCK HIGH for > 60 µs, which would power-down
    // the HX711 chips.  The whole sequence takes ~50 µs.
    noInterrupts();

    for (int bit = 23; bit >= 0; bit--) {
        digitalWrite(HX711_SCK_PIN, HIGH);
        delayMicroseconds(1);

        // Sample all four DOUT lines on the same SCK HIGH edge.
        for (int ch = 0; ch < 4; ch++) {
            if (digitalRead(kDoutPins[ch])) {
                raw[ch] |= (1u << bit);
            }
        }

        digitalWrite(HX711_SCK_PIN, LOW);
        delayMicroseconds(1);
    }

    // Additional pulses select the gain / channel for the NEXT conversion.
    // HX711_GAIN_PULSES = 25 → 1 extra pulse → Channel A, gain 128.
    const int extraPulses = HX711_GAIN_PULSES - 24;
    for (int p = 0; p < extraPulses; p++) {
        digitalWrite(HX711_SCK_PIN, HIGH);
        delayMicroseconds(1);
        digitalWrite(HX711_SCK_PIN, LOW);
        delayMicroseconds(1);
    }

    interrupts();
    // ---- End of critical section ----

    for (int ch = 0; ch < 4; ch++) {
        result.ch[ch] = signExtend24(raw[ch]) - _tare[ch];
    }
    result.valid = true;
    return result;
}

float HX711Parallel::toKg(int32_t raw, uint8_t channel) const {
    if (channel >= 4) return 0.0f;
    // _scale is in grams/LSB; divide by 1000 for kg.
    return (float)raw * _scale[channel] / 1000.0f;
}

void HX711Parallel::setCalibration(uint8_t channel, float gramsPerLSB) {
    if (channel < 4) {
        _scale[channel] = gramsPerLSB;
    }
}

// ---- Private: single-channel raw read (used only during tare) ----

int32_t HX711Parallel::readOneRaw(uint8_t ch) {
    // The caller (tare) has already confirmed DOUT LOW.
    // This issues its own 24+gain pulses for one channel only.
    uint32_t raw = 0;

    noInterrupts();
    for (int bit = 23; bit >= 0; bit--) {
        digitalWrite(HX711_SCK_PIN, HIGH);
        delayMicroseconds(1);
        if (digitalRead(kDoutPins[ch])) {
            raw |= (1u << bit);
        }
        digitalWrite(HX711_SCK_PIN, LOW);
        delayMicroseconds(1);
    }
    const int extraPulses = HX711_GAIN_PULSES - 24;
    for (int p = 0; p < extraPulses; p++) {
        digitalWrite(HX711_SCK_PIN, HIGH);
        delayMicroseconds(1);
        digitalWrite(HX711_SCK_PIN, LOW);
        delayMicroseconds(1);
    }
    interrupts();

    return signExtend24(raw);
}
