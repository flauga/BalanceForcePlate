#include "hx711.h"

// ---------------------------------------------------------------------------
// HX711 (single channel)
// ---------------------------------------------------------------------------

HX711::HX711(uint8_t doutPin, uint8_t clkPin)
  : _dout(doutPin), _clk(clkPin) {}

void HX711::begin() {
  pinMode(_dout, INPUT);
  pinMode(_clk,  OUTPUT);
  digitalWrite(_clk, LOW);

  // Wait for the first conversion to complete
  while (!isReady()) {
    delay(1);
  }
}

bool HX711::isReady() const {
  return digitalRead(_dout) == LOW;
}

long HX711::_readOnce() {
  // Wait for DOUT to go low (ready)
  while (!isReady()) { /* spin */ }

  long value = 0;

  // Clock in 24 bits, MSB first
  for (int i = 0; i < 24; i++) {
    digitalWrite(_clk, HIGH);
    delayMicroseconds(1);
    value = (value << 1) | digitalRead(_dout);
    digitalWrite(_clk, LOW);
    delayMicroseconds(1);
  }

  // 25th pulse selects Channel A / Gain 128 for next conversion
  digitalWrite(_clk, HIGH);
  delayMicroseconds(1);
  digitalWrite(_clk, LOW);
  delayMicroseconds(1);

  // Sign-extend 24-bit to 32-bit (two's complement)
  if (value & 0x800000) {
    value |= (long)0xFF000000;
  }

  return value;
}

long HX711::readRaw() {
  return _readOnce();
}

long HX711::read() {
  return _readOnce() - _offset;
}

long HX711::readIfReady(bool &newData) {
  if (!isReady()) {
    newData = false;
    return 0;
  }
  newData = true;
  return _readOnce() - _offset;
}

void HX711::tare(uint8_t times) {
  long sum = 0;
  for (uint8_t i = 0; i < times; i++) {
    sum += _readOnce();
  }
  _offset = sum / times;
}

// ---------------------------------------------------------------------------
// HX711Array (4 sensors)
// ---------------------------------------------------------------------------

HX711Array::HX711Array(
  uint8_t dout0, uint8_t clk0,
  uint8_t dout1, uint8_t clk1,
  uint8_t dout2, uint8_t clk2,
  uint8_t dout3, uint8_t clk3
) : _sensors{ {dout0, clk0}, {dout1, clk1}, {dout2, clk2}, {dout3, clk3} }
{}

void HX711Array::begin() {
  for (int i = 0; i < 4; i++) {
    _sensors[i].begin();
  }
  tare();
}

void HX711Array::readAll(long f[4]) {
  for (int i = 0; i < 4; i++) {
    f[i] = _sensors[i].read();
  }
}

void HX711Array::tare() {
  for (int i = 0; i < 4; i++) {
    _sensors[i].tare(10);
  }
}
