#pragma once
#include <Arduino.h>

/**
 * Minimal HX711 24-bit ADC driver for a single load cell channel.
 *
 * The HX711 uses a proprietary serial protocol:
 *   - Pull CLK low and wait for DOUT to go low (ready signal)
 *   - Clock out 24 bits MSB-first by toggling CLK high/low
 *   - Send 1-3 additional CLK pulses to set the next channel/gain
 *
 * This driver uses Channel A at 128x gain (25 CLK pulses total).
 */
class HX711 {
public:
  /**
   * @param doutPin  GPIO pin connected to HX711 DOUT
   * @param clkPin   GPIO pin connected to HX711 CLK (PD_SCK)
   */
  HX711(uint8_t doutPin, uint8_t clkPin);

  /** Configure GPIO pins and wait for the first reading to be available. */
  void begin();

  /**
   * Returns true if the HX711 has a new reading ready.
   * DOUT goes low when data is available.
   */
  bool isReady() const;

  /**
   * Block until a new reading is ready, then return the raw 24-bit signed value.
   * Applies tare offset.
   */
  long read();

  /**
   * Non-blocking read. Returns last value if no new data is available.
   * More suitable for timed loops.
   */
  long readIfReady(bool &newData);

  /**
   * Tare: capture the current zero reading.
   * Call once after power-on when the plate is unloaded.
   */
  void tare(uint8_t times = 10);

  /** Return the raw (pre-tare) value for diagnostic purposes. */
  long readRaw();

private:
  uint8_t _dout;
  uint8_t _clk;
  long    _offset = 0;

  long _readOnce();
};

/**
 * Array of 4 HX711 sensors for the 4-corner force plate.
 *
 * Corner layout (viewed from above):
 *   f0 = front-left   f1 = front-right
 *   f2 = back-left    f3 = back-right
 */
class HX711Array {
public:
  HX711Array(
    uint8_t dout0, uint8_t clk0,
    uint8_t dout1, uint8_t clk1,
    uint8_t dout2, uint8_t clk2,
    uint8_t dout3, uint8_t clk3
  );

  /** Initialize all 4 sensors and tare them. */
  void begin();

  /**
   * Read all 4 sensors.
   * Blocks until all sensors have fresh data.
   * @param f Output array of 4 values [f0, f1, f2, f3]
   */
  void readAll(long f[4]);

  /**
   * Tare all 4 sensors simultaneously.
   */
  void tare();

private:
  HX711 _sensors[4];
};
