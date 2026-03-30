#pragma once

// ---- SPI Pin Configuration (VSPI) ----
#define BMI323_CS_PIN    5
#define BMI323_SCK_PIN   18
#define BMI323_MOSI_PIN  23
#define BMI323_MISO_PIN  19

// ---- SPI Settings ----
#define BMI323_SPI_SPEED 8000000  // 8 MHz

// ---- Sampling ----
#define SAMPLE_RATE_HZ   100
#define SAMPLE_PERIOD_US  (1000000 / SAMPLE_RATE_HZ)

// ---- Serial ----
#define SERIAL_BAUD_RATE  460800

// ---- WiFi TCP streaming ----
// The ESP32 listens on this port for one TCP client at a time.
// Connect from the laptop with: pnpm --filter local-server dev -- --wifi imu-balance.local
#define WIFI_TCP_PORT    8888
#define WIFI_HOSTNAME    "imu-balance"   // reachable as imu-balance.local via mDNS

// ---- BMI323 Ranges ----
#define ACCEL_RANGE_G     4.0f    // +/- 4g
#define GYRO_RANGE_DPS    2000.0f // +/- 2000 deg/s

// ---- BMI323 Scale Factors ----
#define ACCEL_SCALE  (ACCEL_RANGE_G / 32768.0f)
#define GYRO_SCALE   (GYRO_RANGE_DPS / 32768.0f)
