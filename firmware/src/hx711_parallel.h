#pragma once

#include <Arduino.h>
#include "config.h"

/**
 * HX711Parallel — reads four HX711 load-cell ADCs simultaneously.
 *
 * All four HX711 modules share a single SCK line (GPIO HX711_SCK_PIN).
 * Each has its own DOUT line (GPIO HX711_DOUT_TL/TR/BL/BR).
 *
 * By toggling the shared SCK and reading all four DOUT GPIOs in the same
 * loop iteration, all channels are clocked at the same microsecond,
 * achieving <1 µs inter-channel synchronisation — essential for accurate
 * Center-of-Pressure computation.
 *
 * Wiring (corner labels viewed from above):
 *
 *   TL ──── HX711 #0 ── DOUT → GPIO 19
 *   TR ──── HX711 #1 ── DOUT → GPIO 21
 *   BL ──── HX711 #2 ── DOUT → GPIO 22
 *   BR ──── HX711 #3 ── DOUT → GPIO 23
 *   All HX711 SCK ←── GPIO 18
 *   All HX711 RATE → VCC  (→ 80 SPS mode)
 *
 * Timing constraints:
 *   - SCK HIGH and LOW must each be ≥ 0.2 µs (datasheet min); we use 1 µs.
 *   - SCK must NOT remain HIGH for > 60 µs between conversions — that triggers
 *     the HX711's power-down mode, requiring a reset/power-cycle.  The full
 *     24+1 pulse cycle with 1 µs per half-period takes ~50 µs total, well
 *     within the limit, as long as noInterrupts() is held for the entire read.
 */

// Indices into the ch[] array — match wiring labels.
enum HX711Channel { CH_TL = 0, CH_TR = 1, CH_BL = 2, CH_BR = 3 };

struct HX711Reading {
    int32_t ch[4];  // tare-corrected, signed 24-bit values in 32-bit containers
    bool valid;     // false if any DOUT line failed to assert LOW within timeout
};

class HX711Parallel {
public:
    HX711Parallel();

    /** Configure GPIO directions and settle for 1 second. */
    void begin();

    /**
     * Perform a tare (zero) by averaging `samples` readings.
     * Call once after begin() when the plate is unloaded.
     */
    void tare(uint8_t samples = HX711_TARE_SAMPLES);

    /**
     * Read all four channels simultaneously.
     * MUST be called from a task context, NOT from an ISR.
     * Blocks briefly waiting for all DOUT lines to go LOW (typ. < 1 ms).
     * Then holds noInterrupts() for the ~50 µs pulse cycle.
     */
    HX711Reading read();

    /**
     * Convert a raw tare-corrected count to kilograms using the per-channel
     * scale factor (grams / LSB).  Returns 0 if channel index is out of range.
     */
    float toKg(int32_t raw, uint8_t channel) const;

    /**
     * Set the calibration scale for one channel.
     * @param channel  0–3 (TL, TR, BL, BR)
     * @param gramsPerLSB  e.g. measured_mass_g / raw_reading_at_known_load
     */
    void setCalibration(uint8_t channel, float gramsPerLSB);

private:
    int32_t _tare[4];    // tare offsets in raw counts
    float   _scale[4];   // grams per LSB (default 1.0)

    // Read a single raw 24-bit value from one channel index (slow, for tare only).
    int32_t readOneRaw(uint8_t ch);

    static inline int32_t signExtend24(uint32_t v) {
        return (v & 0x800000u) ? (int32_t)(v | 0xFF000000u) : (int32_t)v;
    }
};
