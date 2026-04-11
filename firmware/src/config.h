#pragma once

// ---------------------------------------------------------------------------
// HX711 pin assignments — 4 load cell corners
//
// Corner layout (viewed from above):
//   f0 = front-left    f1 = front-right
//   f2 = back-left     f3 = back-right
// ---------------------------------------------------------------------------

#define HX711_DOUT_0  16    // Front-left  DATA
#define HX711_CLK_0    4    // Front-left  CLK

#define HX711_DOUT_1  17    // Front-right DATA
#define HX711_CLK_1    5    // Front-right CLK

#define HX711_DOUT_2  25    // Back-left   DATA
#define HX711_CLK_2   18    // Back-left   CLK

#define HX711_DOUT_3  26    // Back-right  DATA
#define HX711_CLK_3   19    // Back-right  CLK

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

// HX711 RATE pin tied HIGH → 80 SPS hardware rate.
// We target 40 Hz in firmware to allow for processing headroom.
#define SAMPLE_RATE_HZ   40
#define SAMPLE_PERIOD_US (1000000 / SAMPLE_RATE_HZ)   // 25 000 µs

// ---------------------------------------------------------------------------
// Serial
// ---------------------------------------------------------------------------
#define SERIAL_BAUD  115200

// ---------------------------------------------------------------------------
// Load cell connectivity
// ---------------------------------------------------------------------------
#define NUM_CELLS                  4
#define LOADCELLS_CHANNEL_COUNT    4

// ---------------------------------------------------------------------------
// Calibration (NVS persistent storage)
// ---------------------------------------------------------------------------
#define CAL_NVS_NAMESPACE   "cal"
#define CAL_NVS_KEY         "data3"   // bumped from "data2" to invalidate stale zero-offset blob
#define CAL_NVS_MODE_KEY    "mode"
#define CAL_VALID_MARKER    0xCA
#define CAL_OFFSET_MIN      -8000000L
#define CAL_OFFSET_MAX       8000000L
#define CAL_SCALE_MIN        0.001f
#define CAL_SCALE_MAX        100000.0f
#define CAL_TARE_SAMPLES     20

// ---------------------------------------------------------------------------
// Bluetooth reliability
// ---------------------------------------------------------------------------
#define BT_WRITE_FAIL_THRESHOLD  10
#define BT_LINK_TIMEOUT_MS       5000

// ---------------------------------------------------------------------------
// Force plate geometry
// ---------------------------------------------------------------------------
// Straight-line distance between left and right RSL301 cell mounting points (mm)
#define PLATE_WIDTH_MM   339.411f
// Straight-line distance between front and back RSL301 cell mounting points (mm)
#define PLATE_HEIGHT_MM  339.411f
